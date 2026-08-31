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
import { stableJson } from './fish-catalog-audit.js';

const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_PNG_DIMENSION = 4_096;
const MAX_PNG_PIXELS = 16_777_216;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = buildCrcTable();

export interface FishImageAsset {
  officialFishImageKey: number;
  path: string;
  sha256: string;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface FishImageAssetIndex {
  schemaVersion: 1;
  mode: 'IMMUTABLE_FISH_IMAGE_ASSETS';
  sourceManifestSha256: string;
  validation: {
    format: 'PNG';
    crcChecked: true;
    maxBytes: number;
    maxDimension: number;
    maxPixels: number;
  };
  counts: {
    assets: number;
  };
  totalAssetBytes: number;
  assets: FishImageAsset[];
}

export interface FishImageImportReport {
  schemaVersion: 1;
  mode: 'FISH_IMAGE_RELEASE_IMPORT_REPORT';
  sourceManifestSha256: string;
  sourceFingerprint: string;
  assetIndexSha256: string;
  counts: {
    sourceFiles: number;
    matched: number;
    excluded: number;
    invalid: number;
  };
  excludedKeys: number[];
  missingExpectedKeys: number[];
  invalidFiles: Array<{ path: string; reason: string }>;
}

export interface BuildFishImageReleaseInput {
  sourceDirectory: string;
  releasesDirectory: string;
  expectedKeys: readonly number[];
  sourceManifestSha256: string;
}

export interface BuildFishImageReleaseResult {
  matched: number;
  excluded: number;
  excludedKeys: number[];
  invalid: number;
  invalidFiles: Array<{ path: string; reason: string }>;
  missingExpectedKeys: number[];
  releasePath: string;
  assetIndexSha256: string;
  totalReleaseSizeBytes: number;
  idempotency: 'CREATED' | 'REUSED_IDENTICAL';
  sourceUnchanged: true;
  blockers: string[];
}

interface SourceFileInspection {
  name: string;
  key: number | null;
  sha256: string;
  sizeBytes: number;
  png: { width: number; height: number } | null;
  invalidReason: string | null;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

function crc32(bytes: Buffer, start: number, end: number): number {
  let value = 0xffffffff;

  for (let index = start; index < end; index += 1) {
    value = CRC_TABLE[(value ^ (bytes[index] ?? 0)) & 0xff] ^ (value >>> 8);
  }

  return (value ^ 0xffffffff) >>> 0;
}

function hash(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseCanonicalKey(name: string): number | null {
  const match = name.match(/^([1-9]\d*)\.png$/u);
  if (match === null) return null;
  const key = Number(match[1]);
  return Number.isSafeInteger(key) ? key : null;
}

export function inspectPng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
    throw new Error(`PNG size must be between 1 and ${String(MAX_PNG_BYTES)} bytes`);
  }
  if (bytes.length < 45 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('PNG signature is invalid');
  }

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let width = 0;
  let height = 0;
  let ihdrCount = 0;
  let idatCount = 0;
  let iendCount = 0;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcStart = dataStart + length;
    const end = crcStart + 4;

    if (end > bytes.length) throw new Error('PNG chunk exceeds the file boundary');
    const type = bytes.toString('ascii', typeStart, dataStart);
    if (!/^[A-Za-z]{4}$/u.test(type) || /[a-z]/u.test(type[2] ?? '')) {
      throw new Error('PNG chunk type is invalid');
    }
    if (crc32(bytes, typeStart, crcStart) !== bytes.readUInt32BE(crcStart)) {
      throw new Error(`PNG ${type} CRC is invalid`);
    }

    chunkIndex += 1;
    if (chunkIndex === 1 && type !== 'IHDR') throw new Error('PNG IHDR must be first');

    if (type === 'IHDR') {
      ihdrCount += 1;
      if (ihdrCount !== 1 || length !== 13) throw new Error('PNG IHDR is invalid');
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const compression = bytes[dataStart + 10];
      const filter = bytes[dataStart + 11];
      const interlace = bytes[dataStart + 12];
      const legalDepths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_PNG_DIMENSION ||
        height > MAX_PNG_DIMENSION ||
        width * height > MAX_PNG_PIXELS
      ) {
        throw new Error('PNG dimensions exceed the accepted bounds');
      }
      if (
        colorType === undefined ||
        bitDepth === undefined ||
        !legalDepths[colorType]?.includes(bitDepth) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1)
      ) {
        throw new Error('PNG IHDR fields are invalid');
      }
    } else if (type === 'IDAT') {
      idatCount += 1;
    } else if (type === 'IEND') {
      iendCount += 1;
      if (length !== 0 || end !== bytes.length) throw new Error('PNG IEND is invalid');
      break;
    }

    offset = end;
  }

  if (ihdrCount !== 1 || idatCount === 0 || iendCount !== 1) {
    throw new Error('PNG required chunks are incomplete');
  }

  return { width, height };
}

async function inspectSourceDirectory(sourceDirectory: string): Promise<{
  files: SourceFileInspection[];
  fingerprint: string;
}> {
  const entries = (await readdir(sourceDirectory, { withFileTypes: true })).sort((left, right) =>
    compareText(left.name, right.name),
  );
  const files: SourceFileInspection[] = [];

  for (const entry of entries) {
    const path = join(sourceDirectory, entry.name);
    const fileStat = await lstat(path);
    const key = parseCanonicalKey(entry.name);

    if (!entry.isFile() || !fileStat.isFile()) {
      files.push({
        name: entry.name,
        key,
        sha256: '',
        sizeBytes: 0,
        png: null,
        invalidReason: 'not a regular file',
      });
      continue;
    }

    const bytes = await readFile(path);
    let png: { width: number; height: number } | null = null;
    let invalidReason: string | null = key === null ? 'filename is not <positive-key>.png' : null;
    try {
      png = inspectPng(bytes);
    } catch (error: unknown) {
      invalidReason = error instanceof Error ? error.message : String(error);
    }
    files.push({
      name: entry.name,
      key,
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
    stat(join(releasePath, 'fish-image-assets.json')),
    stat(join(releasePath, 'import-report.json')),
    ...assetNames.map((name) => stat(join(assetsPath, name))),
  ]);
  return sizes.reduce((total, item) => total + item.size, 0);
}

async function verifyExistingRelease(
  releasePath: string,
  indexContent: string,
  reportContent: string,
  assets: readonly FishImageAsset[],
): Promise<void> {
  if ((await readFile(join(releasePath, 'fish-image-assets.json'), 'utf8')) !== indexContent) {
    throw new Error('existing release asset index differs');
  }
  if ((await readFile(join(releasePath, 'import-report.json'), 'utf8')) !== reportContent) {
    throw new Error('existing release import report differs');
  }
  const expectedNames = assets.map((asset) => basename(asset.path)).sort(compareText);
  const actualNames = (await readdir(join(releasePath, 'assets'))).sort(compareText);
  if (stableJson(actualNames) !== stableJson(expectedNames)) {
    throw new Error('existing release asset filenames differ');
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
      throw new Error(`existing release asset ${asset.path} differs`);
    }
  }
}

async function makeImmutable(
  stagingPath: string,
  assets: readonly FishImageAsset[],
): Promise<void> {
  await Promise.all([
    chmod(join(stagingPath, 'fish-image-assets.json'), 0o444),
    chmod(join(stagingPath, 'import-report.json'), 0o444),
    ...assets.map((asset) => chmod(join(stagingPath, asset.path), 0o444)),
  ]);
  await chmod(join(stagingPath, 'assets'), 0o555);
  await chmod(stagingPath, 0o555);
}

export async function buildFishImageRelease(
  input: BuildFishImageReleaseInput,
): Promise<BuildFishImageReleaseResult> {
  const sourceDirectory = resolve(input.sourceDirectory);
  const releasesDirectory = resolve(input.releasesDirectory);
  const expectedKeys = [...input.expectedKeys].sort((left, right) => left - right);
  const expected = new Set(expectedKeys);
  if (
    expected.size !== expectedKeys.length ||
    expectedKeys.some((key) => !Number.isSafeInteger(key) || key <= 0)
  ) {
    throw new Error('expected Fish image keys must be unique positive safe integers');
  }
  if (!/^[a-f0-9]{64}$/u.test(input.sourceManifestSha256)) {
    throw new Error('source manifest SHA-256 must be lowercase hexadecimal');
  }

  const before = await inspectSourceDirectory(sourceDirectory);
  const byKey = new Map<number, SourceFileInspection>();
  const invalidFiles = before.files
    .filter((file) => file.invalidReason !== null)
    .map((file) => ({ path: file.name, reason: file.invalidReason ?? 'invalid file' }));
  for (const file of before.files) {
    if (file.key !== null) byKey.set(file.key, file);
  }
  const missingExpectedKeys = expectedKeys.filter((key) => {
    const file = byKey.get(key);
    return file === undefined || file.invalidReason !== null || file.png === null;
  });
  const excludedKeys = [...byKey.keys()].filter((key) => !expected.has(key)).sort((a, b) => a - b);
  const blockers = [
    ...(missingExpectedKeys.length === 0
      ? []
      : [`missing or invalid expected keys: ${missingExpectedKeys.join(', ')}`]),
  ];
  if (blockers.length > 0) throw new Error(`Fish image release refused: ${blockers.join('; ')}`);

  const assets: FishImageAsset[] = expectedKeys.map((key) => {
    const source = byKey.get(key);
    if (source === undefined || source.png === null)
      throw new Error(`expected key ${String(key)} vanished`);
    return {
      officialFishImageKey: key,
      path: `assets/${String(key)}-${source.sha256}.png`,
      sha256: source.sha256,
      sizeBytes: source.sizeBytes,
      width: source.png.width,
      height: source.png.height,
    };
  });
  const index: FishImageAssetIndex = {
    schemaVersion: 1,
    mode: 'IMMUTABLE_FISH_IMAGE_ASSETS',
    sourceManifestSha256: input.sourceManifestSha256,
    validation: {
      format: 'PNG',
      crcChecked: true,
      maxBytes: MAX_PNG_BYTES,
      maxDimension: MAX_PNG_DIMENSION,
      maxPixels: MAX_PNG_PIXELS,
    },
    counts: { assets: assets.length },
    totalAssetBytes: assets.reduce((total, asset) => total + asset.sizeBytes, 0),
    assets,
  };
  const indexContent = stableJson(index);
  const assetIndexSha256 = hash(indexContent);
  const report: FishImageImportReport = {
    schemaVersion: 1,
    mode: 'FISH_IMAGE_RELEASE_IMPORT_REPORT',
    sourceManifestSha256: input.sourceManifestSha256,
    sourceFingerprint: before.fingerprint,
    assetIndexSha256,
    counts: {
      sourceFiles: before.files.length,
      matched: assets.length,
      excluded: excludedKeys.length,
      invalid: invalidFiles.length,
    },
    excludedKeys,
    missingExpectedKeys,
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
      const sourcePath = join(sourceDirectory, `${String(asset.officialFishImageKey)}.png`);
      const destinationPath = join(stagingPath, asset.path);
      await copyFile(sourcePath, destinationPath);
      const copied = await readFile(destinationPath);
      if (hash(copied) !== asset.sha256) throw new Error(`copied asset ${asset.path} changed`);
    }
    await writeFile(join(stagingPath, 'fish-image-assets.json'), indexContent, { flag: 'wx' });
    await writeFile(join(stagingPath, 'import-report.json'), reportContent, { flag: 'wx' });

    const after = await inspectSourceDirectory(sourceDirectory);
    if (after.fingerprint !== before.fingerprint)
      throw new Error('source directory changed during build');

    let idempotency: BuildFishImageReleaseResult['idempotency'];
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
      matched: assets.length,
      excluded: excludedKeys.length,
      excludedKeys,
      invalid: invalidFiles.length,
      invalidFiles,
      missingExpectedKeys,
      releasePath,
      assetIndexSha256,
      totalReleaseSizeBytes: await releaseSize(releasePath),
      idempotency,
      sourceUnchanged: true,
      blockers,
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
