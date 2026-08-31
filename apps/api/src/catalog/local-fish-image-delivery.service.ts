import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { inspectPng, type FishImageAssetIndex } from '../prisma/fish-image-release.js';
import {
  FishImageDelivery,
  type FishImageSource,
  type PublicFishImage,
  type PublicFishImageAsset,
} from './fish-image-delivery.js';

export const APPROVED_FISH_IMAGE_ASSET_INDEX_SHA256 =
  '6eae2d768a1fbb88de3970b7b42c593602d3bd1fcdec340cb4909710b1d6d1cf';
export const APPROVED_FISH_IMAGE_SOURCE_MANIFEST_SHA256 =
  '21a362ba353eec616b53e7054000fda0ab0adde8ffa32f8603338c46627454ad';

const INDEX_FILE_NAME = 'fish-image-assets.json';
const REPORT_FILE_NAME = 'import-report.json';
const PUBLIC_PATH_PREFIX = '/api/v1/fish-images/';
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const FILE_NAME_PATTERN = /^([1-9]\d*)-([a-f0-9]{64})\.png$/u;

interface RuntimeAsset {
  fileName: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
}

interface ImportReportShape {
  schemaVersion: number;
  mode: string;
  sourceManifestSha256: string;
  sourceFingerprint: string;
  assetIndexSha256: string;
  counts: {
    sourceFiles: number;
    matched: number;
    excluded: number;
    invalid: number;
  };
  excludedKeys: unknown[];
  missingExpectedKeys: unknown[];
  invalidFiles: unknown[];
}

export interface LocalFishImageDeliveryOptions {
  storageRoot: string;
  approvedAssetIndexSha256?: string;
  approvedSourceManifestSha256?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertSha256(value: string, label: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

async function assertDirectory(path: string, label: string, immutable: boolean): Promise<string> {
  const item = await lstat(path);
  if (!item.isDirectory() || item.isSymbolicLink())
    throw new Error(`${label} is not a real directory`);
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

function decodeAssetIndex(value: unknown): FishImageAssetIndex {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'mode',
      'sourceManifestSha256',
      'validation',
      'counts',
      'totalAssetBytes',
      'assets',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'IMMUTABLE_FISH_IMAGE_ASSETS' ||
    typeof value.sourceManifestSha256 !== 'string' ||
    !isRecord(value.validation) ||
    !isRecord(value.counts) ||
    !exactKeys(value.validation, [
      'format',
      'crcChecked',
      'maxBytes',
      'maxDimension',
      'maxPixels',
    ]) ||
    value.validation.format !== 'PNG' ||
    value.validation.crcChecked !== true ||
    value.validation.maxBytes !== 8 * 1024 * 1024 ||
    value.validation.maxDimension !== 4_096 ||
    value.validation.maxPixels !== 16_777_216 ||
    !exactKeys(value.counts, ['assets']) ||
    typeof value.counts.assets !== 'number' ||
    !Number.isSafeInteger(value.counts.assets) ||
    typeof value.totalAssetBytes !== 'number' ||
    !Number.isSafeInteger(value.totalAssetBytes) ||
    value.totalAssetBytes < 1 ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('Fish image asset index shape is invalid');
  }
  return value as unknown as FishImageAssetIndex;
}

function decodeImportReport(value: unknown): ImportReportShape {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'mode',
      'sourceManifestSha256',
      'sourceFingerprint',
      'assetIndexSha256',
      'counts',
      'excludedKeys',
      'missingExpectedKeys',
      'invalidFiles',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'FISH_IMAGE_RELEASE_IMPORT_REPORT' ||
    typeof value.sourceManifestSha256 !== 'string' ||
    typeof value.sourceFingerprint !== 'string' ||
    !SHA256_PATTERN.test(value.sourceFingerprint) ||
    typeof value.assetIndexSha256 !== 'string' ||
    !isRecord(value.counts) ||
    !exactKeys(value.counts, ['sourceFiles', 'matched', 'excluded', 'invalid']) ||
    !Array.isArray(value.excludedKeys) ||
    !Array.isArray(value.missingExpectedKeys) ||
    !Array.isArray(value.invalidFiles)
  ) {
    throw new Error('Fish image import report shape is invalid');
  }
  const counts = value.counts;
  if (
    typeof counts.sourceFiles !== 'number' ||
    !Number.isSafeInteger(counts.sourceFiles) ||
    typeof counts.matched !== 'number' ||
    !Number.isSafeInteger(counts.matched) ||
    typeof counts.excluded !== 'number' ||
    !Number.isSafeInteger(counts.excluded) ||
    typeof counts.invalid !== 'number' ||
    !Number.isSafeInteger(counts.invalid) ||
    counts.sourceFiles < 0 ||
    counts.matched < 0 ||
    counts.excluded < 0 ||
    counts.invalid < 0
  ) {
    throw new Error('Fish image import report counts are invalid');
  }
  return value as unknown as ImportReportShape;
}

export class LocalFishImageDelivery extends FishImageDelivery {
  readonly mappedImageCount: number;
  private readonly assetsByKey: ReadonlyMap<number, RuntimeAsset>;
  private readonly assetsByFileName: ReadonlyMap<string, RuntimeAsset>;

  private constructor(assets: readonly RuntimeAsset[]) {
    super();
    this.assetsByKey = new Map(
      assets.map((asset) => [Number(FILE_NAME_PATTERN.exec(asset.fileName)?.[1]), asset]),
    );
    this.assetsByFileName = new Map(assets.map((asset) => [asset.fileName, asset]));
    this.mappedImageCount = assets.length;
  }

  static async load(options: LocalFishImageDeliveryOptions): Promise<LocalFishImageDelivery> {
    const approvedAssetIndexSha256 =
      options.approvedAssetIndexSha256 ?? APPROVED_FISH_IMAGE_ASSET_INDEX_SHA256;
    const approvedSourceManifestSha256 =
      options.approvedSourceManifestSha256 ?? APPROVED_FISH_IMAGE_SOURCE_MANIFEST_SHA256;
    assertSha256(approvedAssetIndexSha256, 'approved Fish image asset-index hash');
    assertSha256(approvedSourceManifestSha256, 'approved Fish image source-manifest hash');
    const storageRoot = resolve(options.storageRoot);
    const releasesRoot = join(storageRoot, 'releases');
    const releasePath = join(releasesRoot, approvedAssetIndexSha256);
    const assetsPath = join(releasePath, 'assets');

    const [realStorageRoot, realReleasesRoot, realReleasePath, realAssetsPath] = await Promise.all([
      assertDirectory(storageRoot, 'Fish image storage root', false),
      assertDirectory(releasesRoot, 'Fish image releases root', false),
      assertDirectory(releasePath, 'Fish image release', true),
      assertDirectory(assetsPath, 'Fish image assets directory', true),
    ]);
    if (
      realReleasesRoot !== join(realStorageRoot, 'releases') ||
      realReleasePath !== join(realReleasesRoot, approvedAssetIndexSha256) ||
      realAssetsPath !== join(realReleasePath, 'assets')
    ) {
      throw new Error('Fish image release path escapes the configured storage root');
    }

    const indexPath = join(realReleasePath, INDEX_FILE_NAME);
    const reportPath = join(realReleasePath, REPORT_FILE_NAME);
    await Promise.all([
      assertImmutableFile(indexPath, 'Fish image asset index'),
      assertImmutableFile(reportPath, 'Fish image import report'),
    ]);
    const [indexContent, reportContent] = await Promise.all([
      readFile(indexPath, 'utf8'),
      readFile(reportPath, 'utf8'),
    ]);
    if (sha256(indexContent) !== approvedAssetIndexSha256) {
      throw new Error('Fish image asset-index SHA-256 does not match the approved release');
    }
    const index = decodeAssetIndex(JSON.parse(indexContent) as unknown);
    const report = decodeImportReport(JSON.parse(reportContent) as unknown);
    if (
      index.sourceManifestSha256 !== approvedSourceManifestSha256 ||
      report.sourceManifestSha256 !== approvedSourceManifestSha256 ||
      report.assetIndexSha256 !== approvedAssetIndexSha256
    ) {
      throw new Error('Fish image release provenance does not match the approved hashes');
    }
    if (
      index.counts.assets !== index.assets.length ||
      report.counts.matched !== index.assets.length ||
      report.counts.invalid !== 0 ||
      report.invalidFiles.length !== 0 ||
      report.missingExpectedKeys.length !== 0 ||
      report.counts.excluded !== report.excludedKeys.length ||
      report.excludedKeys.some(
        (key) => typeof key !== 'number' || !Number.isSafeInteger(key) || key <= 0,
      ) ||
      new Set(report.excludedKeys).size !== report.excludedKeys.length ||
      report.counts.sourceFiles !== report.counts.matched + report.counts.excluded
    ) {
      throw new Error('Fish image release counts are inconsistent');
    }

    const actualFileNames = (await readdir(realAssetsPath)).sort();
    const assets: RuntimeAsset[] = [];
    const keys = new Set<number>();
    const fileNames = new Set<string>();
    let totalAssetBytes = 0;

    let previousKey = 0;
    for (const entry of index.assets) {
      if (
        !isRecord(entry) ||
        !exactKeys(entry, [
          'officialFishImageKey',
          'path',
          'sha256',
          'sizeBytes',
          'width',
          'height',
        ]) ||
        !Number.isSafeInteger(entry.officialFishImageKey) ||
        entry.officialFishImageKey <= 0 ||
        typeof entry.path !== 'string' ||
        typeof entry.sha256 !== 'string' ||
        !SHA256_PATTERN.test(entry.sha256) ||
        !Number.isSafeInteger(entry.sizeBytes) ||
        entry.sizeBytes <= 0 ||
        !Number.isSafeInteger(entry.width) ||
        entry.width <= 0 ||
        !Number.isSafeInteger(entry.height) ||
        entry.height <= 0
      ) {
        throw new Error('Fish image asset metadata is invalid');
      }
      const fileName = `${String(entry.officialFishImageKey)}-${entry.sha256}.png`;
      if (
        entry.path !== `assets/${fileName}` ||
        keys.has(entry.officialFishImageKey) ||
        entry.officialFishImageKey <= previousKey
      ) {
        throw new Error('Fish image asset key/path mapping is invalid or duplicated');
      }
      previousKey = entry.officialFishImageKey;
      keys.add(entry.officialFishImageKey);
      fileNames.add(fileName);
      const path = join(realAssetsPath, fileName);
      await assertImmutableFile(path, `Fish image asset ${fileName}`);
      const bytes = await readFile(path);
      const dimensions = inspectPng(bytes);
      if (
        bytes.length !== entry.sizeBytes ||
        sha256(bytes) !== entry.sha256 ||
        dimensions.width !== entry.width ||
        dimensions.height !== entry.height
      ) {
        throw new Error(`Fish image asset ${fileName} is missing or corrupt`);
      }
      totalAssetBytes += bytes.length;
      assets.push({
        fileName,
        path,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes,
        width: entry.width,
        height: entry.height,
      });
    }

    if (
      index.totalAssetBytes !== totalAssetBytes ||
      actualFileNames.length !== fileNames.size ||
      actualFileNames.some((fileName) => !fileNames.has(fileName))
    ) {
      throw new Error('Fish image release files do not match the asset index exactly');
    }

    return new LocalFishImageDelivery(assets);
  }

  resolvePublicImage(source: FishImageSource): PublicFishImage | null {
    if (source.officialFishImageKey === null) return null;
    const asset = this.assetsByKey.get(source.officialFishImageKey);
    return asset === undefined ? null : { url: `${PUBLIC_PATH_PREFIX}${asset.fileName}` };
  }

  async readPublicAsset(fileName: string): Promise<PublicFishImageAsset | null> {
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
      )
        return null;
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
