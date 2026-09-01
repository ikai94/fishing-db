import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { normalizeCatalogName } from '../catalog/catalog-normalization.js';
import type { BaitImageMappingManifest, BaitImageMappingType } from './bait-image-mapping.js';
import { stableJson } from './fish-catalog-audit.js';
import { inspectPng } from './fish-image-release.js';

const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_PNG_DIMENSION = 4_096;
const MAX_PNG_PIXELS = 16_777_216;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface BaitImageMappingIndexEntry {
  baitName: string;
  baitNameNormalized: string;
  baitType: BaitImageMappingType;
  assetSha256: string;
}

export interface BaitImageAsset {
  sourceFile: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface BaitImageAssetIndex {
  schemaVersion: 1;
  mode: 'IMMUTABLE_BAIT_IMAGE_ASSETS';
  sourceManifestSha256: string;
  validation: {
    format: 'PNG';
    crcChecked: true;
    maxBytes: number;
    maxDimension: number;
    maxPixels: number;
  };
  counts: {
    mappedBaits: number;
    assets: number;
  };
  totalAssetBytes: number;
  mappings: BaitImageMappingIndexEntry[];
  assets: BaitImageAsset[];
}

export interface BaitImageImportReport {
  schemaVersion: 1;
  mode: 'BAIT_IMAGE_RELEASE_IMPORT_REPORT';
  sourceManifestSha256: string;
  sourceFingerprint: string;
  assetIndexSha256: string;
  counts: {
    sourceFiles: number;
    mappedBaits: number;
    assets: number;
    unused: number;
    invalid: number;
  };
  unusedSourceFiles: string[];
  missingSourceFiles: string[];
  unexpectedSourceFiles: string[];
  invalidFiles: Array<{ path: string; reason: string }>;
}

export interface BuildBaitImageReleaseInput {
  sourceDirectory: string;
  releasesDirectory: string;
  manifest: BaitImageMappingManifest;
  sourceManifestSha256: string;
}

export interface BuildBaitImageReleaseResult {
  mappedBaits: number;
  assets: number;
  unused: number;
  unusedSourceFiles: string[];
  missingSourceFiles: string[];
  unexpectedSourceFiles: string[];
  invalidFiles: Array<{ path: string; reason: string }>;
  releasePath: string;
  assetIndexSha256: string;
  totalReleaseSizeBytes: number;
  idempotency: 'CREATED' | 'REUSED_IDENTICAL';
  sourceUnchanged: true;
}

interface SourceInspection {
  name: string;
  sha256: string;
  sizeBytes: number;
  png: { width: number; height: number } | null;
  invalidReason: string | null;
}

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  const parsed = readNonNegativeInteger(value, label);
  if (parsed < 1) throw new Error(`${label} is invalid`);
  return parsed;
}

function readSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function decodeBaitImageAssetIndex(value: unknown): BaitImageAssetIndex {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'mode',
      'sourceManifestSha256',
      'validation',
      'counts',
      'totalAssetBytes',
      'mappings',
      'assets',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'IMMUTABLE_BAIT_IMAGE_ASSETS' ||
    !isRecord(value.validation) ||
    !exactKeys(value.validation, [
      'format',
      'crcChecked',
      'maxBytes',
      'maxDimension',
      'maxPixels',
    ]) ||
    value.validation.format !== 'PNG' ||
    value.validation.crcChecked !== true ||
    value.validation.maxBytes !== MAX_PNG_BYTES ||
    value.validation.maxDimension !== MAX_PNG_DIMENSION ||
    value.validation.maxPixels !== MAX_PNG_PIXELS ||
    !isRecord(value.counts) ||
    !exactKeys(value.counts, ['mappedBaits', 'assets']) ||
    !Array.isArray(value.mappings) ||
    !Array.isArray(value.assets)
  ) {
    throw new Error('Bait image asset index shape is invalid');
  }

  const sourceManifestSha256 = readSha256(
    value.sourceManifestSha256,
    'Bait image source manifest SHA-256',
  );
  const counts = {
    mappedBaits: readNonNegativeInteger(value.counts.mappedBaits, 'mapped Bait count'),
    assets: readNonNegativeInteger(value.counts.assets, 'Bait image asset count'),
  };
  const totalAssetBytes = readPositiveInteger(value.totalAssetBytes, 'Bait image total bytes');
  const mappings = value.mappings.map((mapping, index): BaitImageMappingIndexEntry => {
    if (
      !isRecord(mapping) ||
      !exactKeys(mapping, ['baitName', 'baitNameNormalized', 'baitType', 'assetSha256']) ||
      typeof mapping.baitName !== 'string' ||
      typeof mapping.baitNameNormalized !== 'string' ||
      normalizeCatalogName(mapping.baitName).nameNormalized !== mapping.baitNameNormalized ||
      (mapping.baitType !== 'BAIT' && mapping.baitType !== 'LURE')
    ) {
      throw new Error(`Bait image index mapping ${String(index)} is invalid`);
    }
    return {
      baitName: mapping.baitName,
      baitNameNormalized: mapping.baitNameNormalized,
      baitType: mapping.baitType,
      assetSha256: readSha256(mapping.assetSha256, 'Bait mapping asset SHA-256'),
    };
  });
  const assets = value.assets.map((asset, index): BaitImageAsset => {
    if (
      !isRecord(asset) ||
      !exactKeys(asset, ['sourceFile', 'path', 'sha256', 'sizeBytes', 'width', 'height']) ||
      typeof asset.sourceFile !== 'string' ||
      typeof asset.path !== 'string'
    ) {
      throw new Error(`Bait image index asset ${String(index)} is invalid`);
    }
    const sha256 = readSha256(asset.sha256, 'Bait asset SHA-256');
    if (asset.path !== `assets/${sha256}.png`) {
      throw new Error(`Bait image index asset ${String(index)} path is invalid`);
    }
    return {
      sourceFile: asset.sourceFile,
      path: asset.path,
      sha256,
      sizeBytes: readPositiveInteger(asset.sizeBytes, 'Bait asset size'),
      width: readPositiveInteger(asset.width, 'Bait asset width'),
      height: readPositiveInteger(asset.height, 'Bait asset height'),
    };
  });
  if (counts.mappedBaits !== mappings.length || counts.assets !== assets.length) {
    throw new Error('Bait image asset index counts are inconsistent');
  }
  return {
    schemaVersion: 1,
    mode: 'IMMUTABLE_BAIT_IMAGE_ASSETS',
    sourceManifestSha256,
    validation: {
      format: 'PNG',
      crcChecked: true,
      maxBytes: MAX_PNG_BYTES,
      maxDimension: MAX_PNG_DIMENSION,
      maxPixels: MAX_PNG_PIXELS,
    },
    counts,
    totalAssetBytes,
    mappings,
    assets,
  };
}

export function decodeBaitImageImportReport(value: unknown): BaitImageImportReport {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'mode',
      'sourceManifestSha256',
      'sourceFingerprint',
      'assetIndexSha256',
      'counts',
      'unusedSourceFiles',
      'missingSourceFiles',
      'unexpectedSourceFiles',
      'invalidFiles',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'BAIT_IMAGE_RELEASE_IMPORT_REPORT' ||
    !isRecord(value.counts) ||
    !exactKeys(value.counts, ['sourceFiles', 'mappedBaits', 'assets', 'unused', 'invalid']) ||
    !Array.isArray(value.unusedSourceFiles) ||
    !Array.isArray(value.missingSourceFiles) ||
    !Array.isArray(value.unexpectedSourceFiles) ||
    !Array.isArray(value.invalidFiles)
  ) {
    throw new Error('Bait image import report shape is invalid');
  }
  const readStrings = (items: unknown[], label: string): string[] =>
    items.map((item) => {
      if (typeof item !== 'string') throw new Error(`${label} is invalid`);
      return item;
    });
  const invalidFiles = value.invalidFiles.map((item) => {
    if (
      !isRecord(item) ||
      !exactKeys(item, ['path', 'reason']) ||
      typeof item.path !== 'string' ||
      typeof item.reason !== 'string'
    ) {
      throw new Error('Bait image invalid-file report is invalid');
    }
    return { path: item.path, reason: item.reason };
  });
  return {
    schemaVersion: 1,
    mode: 'BAIT_IMAGE_RELEASE_IMPORT_REPORT',
    sourceManifestSha256: readSha256(
      value.sourceManifestSha256,
      'Bait report source manifest SHA-256',
    ),
    sourceFingerprint: readSha256(value.sourceFingerprint, 'Bait source fingerprint'),
    assetIndexSha256: readSha256(value.assetIndexSha256, 'Bait asset index SHA-256'),
    counts: {
      sourceFiles: readNonNegativeInteger(value.counts.sourceFiles, 'source-file count'),
      mappedBaits: readNonNegativeInteger(value.counts.mappedBaits, 'mapped Bait count'),
      assets: readNonNegativeInteger(value.counts.assets, 'asset count'),
      unused: readNonNegativeInteger(value.counts.unused, 'unused-file count'),
      invalid: readNonNegativeInteger(value.counts.invalid, 'invalid-file count'),
    },
    unusedSourceFiles: readStrings(value.unusedSourceFiles, 'unused source files'),
    missingSourceFiles: readStrings(value.missingSourceFiles, 'missing source files'),
    unexpectedSourceFiles: readStrings(value.unexpectedSourceFiles, 'unexpected source files'),
    invalidFiles,
  };
}

async function inspectSourceDirectory(sourceDirectory: string): Promise<{
  files: SourceInspection[];
  fingerprint: string;
}> {
  const entries = (await readdir(sourceDirectory, { withFileTypes: true })).sort((left, right) =>
    compareText(left.name, right.name),
  );
  const files: SourceInspection[] = [];
  for (const entry of entries) {
    const path = join(sourceDirectory, entry.name);
    const item = await lstat(path);
    if (!entry.isFile() || !item.isFile() || item.isSymbolicLink()) {
      files.push({
        name: entry.name,
        sha256: '',
        sizeBytes: 0,
        png: null,
        invalidReason: 'not a regular file',
      });
      continue;
    }
    const bytes = await readFile(path);
    let png: SourceInspection['png'] = null;
    let invalidReason: string | null = null;
    try {
      png = inspectPng(bytes);
    } catch (error: unknown) {
      invalidReason = error instanceof Error ? error.message : String(error);
    }
    files.push({
      name: entry.name,
      sha256: hash(bytes),
      sizeBytes: bytes.length,
      png,
      invalidReason,
    });
  }
  return {
    files,
    fingerprint: hash(
      stableJson(
        files.map((file) => ({
          name: file.name,
          sha256: file.sha256,
          sizeBytes: file.sizeBytes,
        })),
      ),
    ),
  };
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function releaseSize(releasePath: string): Promise<number> {
  const assetsPath = join(releasePath, 'assets');
  const assetNames = await readdir(assetsPath);
  const sizes = await Promise.all([
    stat(join(releasePath, 'bait-image-assets.json')),
    stat(join(releasePath, 'import-report.json')),
    ...assetNames.map((name) => stat(join(assetsPath, name))),
  ]);
  return sizes.reduce((total, item) => total + item.size, 0);
}

async function verifyExistingRelease(
  releasePath: string,
  indexContent: string,
  reportContent: string,
  assets: readonly BaitImageAsset[],
): Promise<void> {
  if ((await readFile(join(releasePath, 'bait-image-assets.json'), 'utf8')) !== indexContent) {
    throw new Error('existing Bait release asset index differs');
  }
  if ((await readFile(join(releasePath, 'import-report.json'), 'utf8')) !== reportContent) {
    throw new Error('existing Bait release import report differs');
  }
  const expectedNames = assets.map((asset) => basename(asset.path)).sort(compareText);
  const actualNames = (await readdir(join(releasePath, 'assets'))).sort(compareText);
  if (stableJson(actualNames) !== stableJson(expectedNames)) {
    throw new Error('existing Bait release asset filenames differ');
  }
  for (const asset of assets) {
    const bytes = await readFile(join(releasePath, asset.path));
    const dimensions = inspectPng(bytes);
    if (
      hash(bytes) !== asset.sha256 ||
      bytes.length !== asset.sizeBytes ||
      dimensions.width !== asset.width ||
      dimensions.height !== asset.height
    ) {
      throw new Error(`existing Bait release asset ${asset.path} differs`);
    }
  }
}

async function makeImmutable(
  stagingPath: string,
  assets: readonly BaitImageAsset[],
): Promise<void> {
  await Promise.all([
    chmod(join(stagingPath, 'bait-image-assets.json'), 0o444),
    chmod(join(stagingPath, 'import-report.json'), 0o444),
    ...assets.map((asset) => chmod(join(stagingPath, asset.path), 0o444)),
  ]);
  await chmod(join(stagingPath, 'assets'), 0o555);
  await chmod(stagingPath, 0o555);
}

export async function buildBaitImageRelease(
  input: BuildBaitImageReleaseInput,
): Promise<BuildBaitImageReleaseResult> {
  if (!SHA256_PATTERN.test(input.sourceManifestSha256)) {
    throw new Error('Bait image source manifest SHA-256 must be lowercase hexadecimal');
  }
  const sourceDirectory = resolve(input.sourceDirectory);
  const releasesDirectory = resolve(input.releasesDirectory);
  const before = await inspectSourceDirectory(sourceDirectory);
  const byName = new Map(before.files.map((file) => [file.name, file]));
  const mappedSourceFiles = [...new Set(input.manifest.entries.map((entry) => entry.sourceFile))];
  const expectedSourceFiles = new Set([...mappedSourceFiles, ...input.manifest.unusedSourceFiles]);
  const missingSourceFiles = [...expectedSourceFiles]
    .filter((name) => !byName.has(name))
    .sort(compareText);
  const unexpectedSourceFiles = before.files
    .map((file) => file.name)
    .filter((name) => !expectedSourceFiles.has(name))
    .sort(compareText);
  const invalidFiles = before.files
    .filter((file) => file.invalidReason !== null)
    .map((file) => ({ path: file.name, reason: file.invalidReason ?? 'invalid file' }));
  if (
    missingSourceFiles.length > 0 ||
    unexpectedSourceFiles.length > 0 ||
    invalidFiles.length > 0
  ) {
    throw new Error(
      `Bait image release refused: missing=${missingSourceFiles.join(',')}; unexpected=${unexpectedSourceFiles.join(',')}; invalid=${invalidFiles.map((file) => file.path).join(',')}`,
    );
  }

  const assets = mappedSourceFiles.sort(compareText).map((sourceFile): BaitImageAsset => {
    const source = byName.get(sourceFile);
    if (source === undefined || source.png === null) throw new Error(`${sourceFile} vanished`);
    return {
      sourceFile,
      path: `assets/${source.sha256}.png`,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      width: source.png.width,
      height: source.png.height,
    };
  });
  if (new Set(assets.map((asset) => asset.sha256)).size !== assets.length) {
    throw new Error('Bait image release refuses duplicate source image content');
  }
  const assetBySource = new Map(assets.map((asset) => [asset.sourceFile, asset]));
  const mappings = input.manifest.entries.map((entry): BaitImageMappingIndexEntry => {
    const asset = assetBySource.get(entry.sourceFile);
    if (asset === undefined) throw new Error(`${entry.sourceFile} is not a mapped asset`);
    return {
      baitName: entry.baitName,
      baitNameNormalized: normalizeCatalogName(entry.baitName).nameNormalized,
      baitType: entry.baitType,
      assetSha256: asset.sha256,
    };
  });
  const index: BaitImageAssetIndex = {
    schemaVersion: 1,
    mode: 'IMMUTABLE_BAIT_IMAGE_ASSETS',
    sourceManifestSha256: input.sourceManifestSha256,
    validation: {
      format: 'PNG',
      crcChecked: true,
      maxBytes: MAX_PNG_BYTES,
      maxDimension: MAX_PNG_DIMENSION,
      maxPixels: MAX_PNG_PIXELS,
    },
    counts: { mappedBaits: mappings.length, assets: assets.length },
    totalAssetBytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
    mappings,
    assets,
  };
  const indexContent = stableJson(index);
  const assetIndexSha256 = hash(indexContent);
  const report: BaitImageImportReport = {
    schemaVersion: 1,
    mode: 'BAIT_IMAGE_RELEASE_IMPORT_REPORT',
    sourceManifestSha256: input.sourceManifestSha256,
    sourceFingerprint: before.fingerprint,
    assetIndexSha256,
    counts: {
      sourceFiles: before.files.length,
      mappedBaits: mappings.length,
      assets: assets.length,
      unused: input.manifest.unusedSourceFiles.length,
      invalid: invalidFiles.length,
    },
    unusedSourceFiles: [...input.manifest.unusedSourceFiles],
    missingSourceFiles,
    unexpectedSourceFiles,
    invalidFiles,
  };
  const reportContent = stableJson(report);
  const releasePath = join(releasesDirectory, assetIndexSha256);

  await mkdir(releasesDirectory, { recursive: true });
  const stagingPath = await mkdtemp(join(releasesDirectory, '.staging-'));
  let stagingExists = true;
  let stagingImmutable = false;
  try {
    await mkdir(join(stagingPath, 'assets'));
    for (const asset of assets) {
      const destination = join(stagingPath, asset.path);
      await copyFile(join(sourceDirectory, asset.sourceFile), destination);
      if (hash(await readFile(destination)) !== asset.sha256) {
        throw new Error(`copied Bait asset ${asset.sourceFile} changed`);
      }
    }
    await writeFile(join(stagingPath, 'bait-image-assets.json'), indexContent, { flag: 'wx' });
    await writeFile(join(stagingPath, 'import-report.json'), reportContent, { flag: 'wx' });
    const after = await inspectSourceDirectory(sourceDirectory);
    if (after.fingerprint !== before.fingerprint) {
      throw new Error('Bait image source directory changed during build');
    }

    let idempotency: BuildBaitImageReleaseResult['idempotency'];
    if (await directoryExists(releasePath)) {
      await verifyExistingRelease(releasePath, indexContent, reportContent, assets);
      await rm(stagingPath, { recursive: true });
      stagingExists = false;
      idempotency = 'REUSED_IDENTICAL';
    } else {
      await makeImmutable(stagingPath, assets);
      stagingImmutable = true;
      try {
        await rename(stagingPath, releasePath);
        stagingExists = false;
        idempotency = 'CREATED';
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
        await verifyExistingRelease(releasePath, indexContent, reportContent, assets);
        await chmod(stagingPath, 0o755);
        await chmod(join(stagingPath, 'assets'), 0o755);
        stagingImmutable = false;
        await rm(stagingPath, { recursive: true });
        stagingExists = false;
        idempotency = 'REUSED_IDENTICAL';
      }
    }

    return {
      mappedBaits: mappings.length,
      assets: assets.length,
      unused: input.manifest.unusedSourceFiles.length,
      unusedSourceFiles: [...input.manifest.unusedSourceFiles],
      missingSourceFiles,
      unexpectedSourceFiles,
      invalidFiles,
      releasePath,
      assetIndexSha256,
      totalReleaseSizeBytes: await releaseSize(releasePath),
      idempotency,
      sourceUnchanged: true,
    };
  } finally {
    if (stagingExists) {
      if (stagingImmutable) {
        await chmod(stagingPath, 0o755);
        await chmod(join(stagingPath, 'assets'), 0o755);
      }
      await rm(stagingPath, { recursive: true, force: true });
    }
  }
}
