import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  decodeBaitImageAssetIndex,
  decodeBaitImageImportReport,
} from '../prisma/bait-image-release.js';
import { inspectPng } from '../prisma/fish-image-release.js';
import {
  BaitImageDelivery,
  type BaitImageSource,
  type PublicBaitImage,
  type PublicBaitImageAsset,
} from './bait-image-delivery.js';

export const APPROVED_BAIT_IMAGE_ASSET_INDEX_SHA256 =
  'a1c960b76cc4cc6c874879d05192a754d8bd41e8878a270560e5026d04c3dc7e';
export const APPROVED_BAIT_IMAGE_SOURCE_MANIFEST_SHA256 =
  '7517350fab047b24ec24b64b8142799ac5aefac9de4d16d2db9bb8c09894f313';

const INDEX_FILE_NAME = 'bait-image-assets.json';
const REPORT_FILE_NAME = 'import-report.json';
const PUBLIC_PATH_PREFIX = '/api/v1/bait-images/';
const FILE_NAME_PATTERN = /^([a-f0-9]{64})\.png$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

interface RuntimeAsset {
  fileName: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface LocalBaitImageDeliveryOptions {
  storageRoot: string;
  approvedAssetIndexSha256?: string;
  approvedSourceManifestSha256?: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

async function assertDirectory(path: string, label: string, immutable: boolean): Promise<string> {
  const item = await lstat(path);
  if (!item.isDirectory() || item.isSymbolicLink()) {
    throw new Error(`${label} is not a real directory`);
  }
  if (immutable && process.platform !== 'win32' && (item.mode & 0o222) !== 0) {
    throw new Error(`${label} must not be writable`);
  }
  return realpath(path);
}

async function assertImmutableFile(path: string, label: string): Promise<void> {
  const item = await lstat(path);
  if (!item.isFile() || item.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  if (process.platform !== 'win32' && (item.mode & 0o222) !== 0) {
    throw new Error(`${label} must not be writable`);
  }
}

export class LocalBaitImageDelivery extends BaitImageDelivery {
  readonly mappedImageCount: number;
  private readonly assetsByBaitName: ReadonlyMap<string, RuntimeAsset>;
  private readonly assetsByFileName: ReadonlyMap<string, RuntimeAsset>;

  private constructor(
    mappings: ReadonlyMap<string, RuntimeAsset>,
    assets: readonly RuntimeAsset[],
  ) {
    super();
    this.assetsByBaitName = mappings;
    this.assetsByFileName = new Map(assets.map((asset) => [asset.fileName, asset]));
    this.mappedImageCount = mappings.size;
  }

  static async load(options: LocalBaitImageDeliveryOptions): Promise<LocalBaitImageDelivery> {
    const approvedAssetIndexSha256 =
      options.approvedAssetIndexSha256 ?? APPROVED_BAIT_IMAGE_ASSET_INDEX_SHA256;
    const approvedSourceManifestSha256 =
      options.approvedSourceManifestSha256 ?? APPROVED_BAIT_IMAGE_SOURCE_MANIFEST_SHA256;
    assertSha256(approvedAssetIndexSha256, 'approved Bait image asset-index hash');
    assertSha256(approvedSourceManifestSha256, 'approved Bait image source-manifest hash');

    const storageRoot = resolve(options.storageRoot);
    const releasesRoot = join(storageRoot, 'releases');
    const releasePath = join(releasesRoot, approvedAssetIndexSha256);
    const assetsPath = join(releasePath, 'assets');
    const [realStorageRoot, realReleasesRoot, realReleasePath, realAssetsPath] = await Promise.all([
      assertDirectory(storageRoot, 'Bait image storage root', false),
      assertDirectory(releasesRoot, 'Bait image releases root', false),
      assertDirectory(releasePath, 'Bait image release', true),
      assertDirectory(assetsPath, 'Bait image assets directory', true),
    ]);
    if (
      realReleasesRoot !== join(realStorageRoot, 'releases') ||
      realReleasePath !== join(realReleasesRoot, approvedAssetIndexSha256) ||
      realAssetsPath !== join(realReleasePath, 'assets')
    ) {
      throw new Error('Bait image release path escapes the configured storage root');
    }

    const indexPath = join(realReleasePath, INDEX_FILE_NAME);
    const reportPath = join(realReleasePath, REPORT_FILE_NAME);
    await Promise.all([
      assertImmutableFile(indexPath, 'Bait image asset index'),
      assertImmutableFile(reportPath, 'Bait image import report'),
    ]);
    const [indexContent, reportContent] = await Promise.all([
      readFile(indexPath, 'utf8'),
      readFile(reportPath, 'utf8'),
    ]);
    if (sha256(indexContent) !== approvedAssetIndexSha256) {
      throw new Error('Bait image asset-index SHA-256 does not match the approved release');
    }
    const index = decodeBaitImageAssetIndex(JSON.parse(indexContent) as unknown);
    const report = decodeBaitImageImportReport(JSON.parse(reportContent) as unknown);
    if (
      index.sourceManifestSha256 !== approvedSourceManifestSha256 ||
      report.sourceManifestSha256 !== approvedSourceManifestSha256 ||
      report.assetIndexSha256 !== approvedAssetIndexSha256
    ) {
      throw new Error('Bait image release provenance does not match the approved hashes');
    }
    if (
      report.counts.mappedBaits !== index.counts.mappedBaits ||
      report.counts.assets !== index.counts.assets ||
      report.counts.unused !== report.unusedSourceFiles.length ||
      report.counts.sourceFiles !== report.counts.assets + report.counts.unused ||
      report.counts.invalid !== 0 ||
      report.invalidFiles.length !== 0 ||
      report.missingSourceFiles.length !== 0 ||
      report.unexpectedSourceFiles.length !== 0
    ) {
      throw new Error('Bait image release counts are inconsistent');
    }

    const actualFileNames = (await readdir(realAssetsPath)).sort();
    const assets: RuntimeAsset[] = [];
    const assetBySha = new Map<string, RuntimeAsset>();
    let totalAssetBytes = 0;
    for (const entry of index.assets) {
      const fileName = `${entry.sha256}.png`;
      if (assetBySha.has(entry.sha256)) throw new Error('Bait image asset SHA-256 is duplicated');
      const path = join(realAssetsPath, fileName);
      await assertImmutableFile(path, `Bait image asset ${fileName}`);
      const bytes = await readFile(path);
      const dimensions = inspectPng(bytes);
      if (
        bytes.length !== entry.sizeBytes ||
        sha256(bytes) !== entry.sha256 ||
        dimensions.width !== entry.width ||
        dimensions.height !== entry.height
      ) {
        throw new Error(`Bait image asset ${fileName} is missing or corrupt`);
      }
      const asset = {
        fileName,
        path,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        width: entry.width,
        height: entry.height,
      };
      assets.push(asset);
      assetBySha.set(entry.sha256, asset);
      totalAssetBytes += bytes.length;
    }
    if (
      totalAssetBytes !== index.totalAssetBytes ||
      actualFileNames.length !== assets.length ||
      actualFileNames.some((fileName) => !assetBySha.has(fileName.replace(/\.png$/u, '')))
    ) {
      throw new Error('Bait image release files do not match the asset index exactly');
    }

    const mappings = new Map<string, RuntimeAsset>();
    for (const mapping of index.mappings) {
      const asset = assetBySha.get(mapping.assetSha256);
      if (asset === undefined || mappings.has(mapping.baitNameNormalized)) {
        throw new Error('Bait image release mapping is missing or duplicated');
      }
      mappings.set(mapping.baitNameNormalized, asset);
    }
    return new LocalBaitImageDelivery(mappings, assets);
  }

  resolvePublicImage(source: BaitImageSource): PublicBaitImage | null {
    const asset = this.assetsByBaitName.get(source.nameNormalized);
    return asset === undefined ? null : { url: `${PUBLIC_PATH_PREFIX}${asset.fileName}` };
  }

  async readPublicAsset(fileName: string): Promise<PublicBaitImageAsset | null> {
    if (!FILE_NAME_PATTERN.test(fileName)) return null;
    const asset = this.assetsByFileName.get(fileName);
    if (asset === undefined) return null;
    try {
      const item = await lstat(asset.path);
      if (
        !item.isFile() ||
        item.isSymbolicLink() ||
        item.size !== asset.sizeBytes ||
        (process.platform !== 'win32' && (item.mode & 0o222) !== 0)
      ) {
        return null;
      }
      const bytes = await readFile(asset.path);
      const dimensions = inspectPng(bytes);
      if (
        sha256(bytes) !== asset.sha256 ||
        dimensions.width !== asset.width ||
        dimensions.height !== asset.height
      ) {
        return null;
      }
      return { bytes, sha256: asset.sha256, sizeBytes: asset.sizeBytes };
    } catch {
      return null;
    }
  }
}
