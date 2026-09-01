import { normalizeCatalogName } from '../catalog/catalog-normalization.js';

export type BaitImageMappingType = 'BAIT' | 'LURE';

export interface BaitImageMappingEntry {
  baitName: string;
  baitType: BaitImageMappingType;
  sourceFile: string;
}

export interface BaitImageMappingManifest {
  schemaVersion: 1;
  mode: 'EXPLICIT_BAIT_IMAGE_MAPPING';
  counts: {
    baits: number;
    sourceFiles: number;
    unusedSourceFiles: number;
  };
  entries: BaitImageMappingEntry[];
  unusedSourceFiles: string[];
}

export interface CanonicalBaitImageTarget {
  name: string;
  type: BaitImageMappingType;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function isSafePngFileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/u.test(value);
}

function readCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function validateBaitImageMappingManifest(
  value: unknown,
  canonicalBaits: readonly CanonicalBaitImageTarget[],
): BaitImageMappingManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['schemaVersion', 'mode', 'counts', 'entries', 'unusedSourceFiles']) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'EXPLICIT_BAIT_IMAGE_MAPPING' ||
    !isRecord(value.counts) ||
    !hasExactKeys(value.counts, ['baits', 'sourceFiles', 'unusedSourceFiles']) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.unusedSourceFiles)
  ) {
    throw new Error('Bait image mapping manifest shape is invalid');
  }

  const counts = {
    baits: readCount(value.counts.baits, 'counts.baits'),
    sourceFiles: readCount(value.counts.sourceFiles, 'counts.sourceFiles'),
    unusedSourceFiles: readCount(value.counts.unusedSourceFiles, 'counts.unusedSourceFiles'),
  };
  const entries = value.entries.map((entry, index): BaitImageMappingEntry => {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, ['baitName', 'baitType', 'sourceFile']) ||
      typeof entry.baitName !== 'string' ||
      entry.baitName.trim() === '' ||
      (entry.baitType !== 'BAIT' && entry.baitType !== 'LURE') ||
      typeof entry.sourceFile !== 'string' ||
      !isSafePngFileName(entry.sourceFile)
    ) {
      throw new Error(`Bait image mapping entry ${String(index)} is invalid`);
    }
    return {
      baitName: entry.baitName,
      baitType: entry.baitType,
      sourceFile: entry.sourceFile,
    };
  });
  const unusedSourceFiles = value.unusedSourceFiles.map((fileName, index) => {
    if (typeof fileName !== 'string' || !isSafePngFileName(fileName)) {
      throw new Error(`Unused Bait image filename ${String(index)} is invalid`);
    }
    return fileName;
  });

  if (entries.length !== canonicalBaits.length || counts.baits !== entries.length) {
    throw new Error('Bait image mapping must contain exactly one entry per canonical Bait');
  }
  const normalizedTargets = new Set<string>();
  for (const [index, canonical] of canonicalBaits.entries()) {
    const entry = entries[index];
    if (
      entry === undefined ||
      entry.baitName !== canonical.name ||
      entry.baitType !== canonical.type
    ) {
      throw new Error(`Bait image mapping entry ${String(index)} does not match canonical order`);
    }
    const normalized = normalizeCatalogName(entry.baitName).nameNormalized;
    if (normalizedTargets.has(normalized)) {
      throw new Error(`Duplicate Bait image target: ${entry.baitName}`);
    }
    normalizedTargets.add(normalized);
  }

  const mappedSourceFiles = new Set(entries.map((entry) => entry.sourceFile));
  const unusedSet = new Set(unusedSourceFiles);
  if (
    mappedSourceFiles.size !== counts.sourceFiles ||
    unusedSet.size !== unusedSourceFiles.length ||
    counts.unusedSourceFiles !== unusedSourceFiles.length ||
    unusedSourceFiles.some((fileName) => mappedSourceFiles.has(fileName))
  ) {
    throw new Error('Bait image mapping source-file counts are inconsistent');
  }
  const sortedUnused = [...unusedSourceFiles].sort();
  if (sortedUnused.some((fileName, index) => fileName !== unusedSourceFiles[index])) {
    throw new Error('Unused Bait image filenames must be sorted');
  }

  return {
    schemaVersion: 1,
    mode: 'EXPLICIT_BAIT_IMAGE_MAPPING',
    counts,
    entries,
    unusedSourceFiles,
  };
}
