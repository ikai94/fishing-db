import type {
  BaseFishWeightApplyReadyEntry,
  BaseFishWeightApplyReadyManifest,
} from './base-fish-weight-apply-ready.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface BaseFishMaxWeightPatchEntry {
  baseName: string;
  canonicalFish: string;
  forumTopicId: string;
  previousMaxWeightGrams: number | null;
  maxWeightGrams: number;
}

export interface BaseFishMaxWeightPatch {
  schemaVersion: 1;
  mode: 'APPLY_READY';
  version: string;
  target: 'FishingBaseFish.maxWeightGrams';
  source: {
    authority: 'CURRENT_APPROVED_DATABASE_STATE';
    baseManifestSha256: string;
  };
  policy: {
    changesOnlyMaxWeightGrams: true;
    requiresExistingMembership: true;
    catchReportsRead: false;
  };
  counts: {
    entries: number;
    overrides: number;
    supplementalTargets: number;
  };
  entries: BaseFishMaxWeightPatchEntry[];
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonObject, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > POSTGRES_INTEGER_MAX
  ) {
    throw new Error(`${label} must be a positive PostgreSQL integer`);
  }
  return value as number;
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  return value === null ? null : positiveInteger(value, label);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function targetKey(baseName: string, forumTopicId: string): string {
  return `${baseName}\0${forumTopicId}`;
}

function compareEntries(
  left: BaseFishMaxWeightPatchEntry,
  right: BaseFishMaxWeightPatchEntry,
): number {
  return left.baseName < right.baseName
    ? -1
    : left.baseName > right.baseName
      ? 1
      : left.forumTopicId < right.forumTopicId
        ? -1
        : left.forumTopicId > right.forumTopicId
          ? 1
          : 0;
}

export function decodeBaseFishMaxWeightPatch(value: unknown): BaseFishMaxWeightPatch {
  if (
    !isObject(value) ||
    !hasExactKeys(value, [
      'schemaVersion',
      'mode',
      'version',
      'target',
      'source',
      'policy',
      'counts',
      'entries',
    ]) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'APPLY_READY' ||
    value.target !== 'FishingBaseFish.maxWeightGrams' ||
    typeof value.version !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-v\d+$/u.test(value.version) ||
    !isObject(value.source) ||
    !hasExactKeys(value.source, ['authority', 'baseManifestSha256']) ||
    value.source.authority !== 'CURRENT_APPROVED_DATABASE_STATE' ||
    typeof value.source.baseManifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.source.baseManifestSha256) ||
    !isObject(value.policy) ||
    !hasExactKeys(value.policy, [
      'changesOnlyMaxWeightGrams',
      'requiresExistingMembership',
      'catchReportsRead',
    ]) ||
    value.policy.changesOnlyMaxWeightGrams !== true ||
    value.policy.requiresExistingMembership !== true ||
    value.policy.catchReportsRead !== false ||
    !isObject(value.counts) ||
    !hasExactKeys(value.counts, ['entries', 'overrides', 'supplementalTargets']) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error('BaseFish max-weight catalog patch has an invalid envelope');
  }

  const entries = value.entries.map((entry, index): BaseFishMaxWeightPatchEntry => {
    if (
      !isObject(entry) ||
      !hasExactKeys(entry, [
        'baseName',
        'canonicalFish',
        'forumTopicId',
        'previousMaxWeightGrams',
        'maxWeightGrams',
      ])
    ) {
      throw new Error(`BaseFish max-weight catalog patch entry ${String(index)} has invalid keys`);
    }
    return {
      baseName: nonEmptyString(entry.baseName, `entries[${String(index)}].baseName`),
      canonicalFish: nonEmptyString(entry.canonicalFish, `entries[${String(index)}].canonicalFish`),
      forumTopicId: nonEmptyString(entry.forumTopicId, `entries[${String(index)}].forumTopicId`),
      previousMaxWeightGrams: nullablePositiveInteger(
        entry.previousMaxWeightGrams,
        `entries[${String(index)}].previousMaxWeightGrams`,
      ),
      maxWeightGrams: positiveInteger(
        entry.maxWeightGrams,
        `entries[${String(index)}].maxWeightGrams`,
      ),
    };
  });
  const counts = {
    entries: positiveInteger(value.counts.entries, 'counts.entries'),
    overrides: positiveInteger(value.counts.overrides, 'counts.overrides'),
    supplementalTargets: positiveInteger(
      value.counts.supplementalTargets,
      'counts.supplementalTargets',
    ),
  };
  return {
    schemaVersion: 1,
    mode: 'APPLY_READY',
    version: value.version,
    target: 'FishingBaseFish.maxWeightGrams',
    source: {
      authority: 'CURRENT_APPROVED_DATABASE_STATE',
      baseManifestSha256: value.source.baseManifestSha256,
    },
    policy: {
      changesOnlyMaxWeightGrams: true,
      requiresExistingMembership: true,
      catchReportsRead: false,
    },
    counts,
    entries,
  };
}

export function applyBaseFishMaxWeightPatch(
  manifest: BaseFishWeightApplyReadyManifest,
  patch: BaseFishMaxWeightPatch,
  baseManifestSha256: string,
): BaseFishWeightApplyReadyManifest {
  if (patch.source.baseManifestSha256 !== baseManifestSha256) {
    throw new Error('BaseFish max-weight catalog patch targets a different base manifest');
  }
  if (patch.entries.length !== patch.counts.entries) {
    throw new Error('BaseFish max-weight catalog patch entry count does not match counts.entries');
  }
  const entries = manifest.entries.map((entry) => ({ ...entry }));
  const byKey = new Map(
    entries.map((entry, index) => [targetKey(entry.baseName, entry.forumTopicId), index]),
  );
  const seen = new Set<string>();
  let overrides = 0;
  let supplementalTargets = 0;
  let previous: BaseFishMaxWeightPatchEntry | undefined;

  for (const patchEntry of patch.entries) {
    if (previous !== undefined && compareEntries(previous, patchEntry) >= 0) {
      throw new Error('BaseFish max-weight catalog patch entries are not uniquely sorted');
    }
    previous = patchEntry;
    const key = targetKey(patchEntry.baseName, patchEntry.forumTopicId);
    if (seen.has(key))
      throw new Error(`BaseFish max-weight catalog patch target is duplicated: ${key}`);
    seen.add(key);
    const index = byKey.get(key);

    if (index === undefined) {
      if (patchEntry.previousMaxWeightGrams !== null) {
        throw new Error(`Supplemental BaseFish target has a non-null previous max: ${key}`);
      }
      const supplemental: BaseFishWeightApplyReadyEntry = {
        baseName: patchEntry.baseName,
        canonicalFish: patchEntry.canonicalFish,
        forumTopicId: patchEntry.forumTopicId,
        minWeightGrams: null,
        maxWeightGrams: patchEntry.maxWeightGrams,
        resolution: 'REVIEWED_DECISION',
        sourceRows: [],
      };
      byKey.set(key, entries.length);
      entries.push(supplemental);
      supplementalTargets += 1;
      continue;
    }

    const entry = entries[index];
    if (entry === undefined) throw new Error(`Missing BaseFish target after indexing: ${key}`);
    if (entry.canonicalFish !== patchEntry.canonicalFish) {
      throw new Error(`BaseFish max-weight catalog patch Fish identity changed: ${key}`);
    }
    if (
      entry.maxWeightGrams !== patchEntry.previousMaxWeightGrams &&
      entry.maxWeightGrams !== patchEntry.maxWeightGrams
    ) {
      throw new Error(`BaseFish max-weight catalog patch previous value changed: ${key}`);
    }
    if (entry.minWeightGrams !== null && entry.minWeightGrams > patchEntry.maxWeightGrams) {
      throw new Error(`BaseFish max-weight catalog patch reverses bounds: ${key}`);
    }
    entries[index] = { ...entry, maxWeightGrams: patchEntry.maxWeightGrams };
    overrides += 1;
  }

  if (
    overrides !== patch.counts.overrides ||
    supplementalTargets !== patch.counts.supplementalTargets
  ) {
    throw new Error(
      'BaseFish max-weight catalog patch target counts do not match the base manifest',
    );
  }

  entries.sort((left, right) =>
    left.baseName < right.baseName
      ? -1
      : left.baseName > right.baseName
        ? 1
        : left.forumTopicId < right.forumTopicId
          ? -1
          : left.forumTopicId > right.forumTopicId
            ? 1
            : 0,
  );
  const counts = {
    targets: entries.length,
    bothKnown: entries.filter(
      (entry) => entry.minWeightGrams !== null && entry.maxWeightGrams !== null,
    ).length,
    minOnly: entries.filter(
      (entry) => entry.minWeightGrams !== null && entry.maxWeightGrams === null,
    ).length,
    maxOnly: entries.filter(
      (entry) => entry.minWeightGrams === null && entry.maxWeightGrams !== null,
    ).length,
    neither: entries.filter(
      (entry) => entry.minWeightGrams === null && entry.maxWeightGrams === null,
    ).length,
    sourceResolved: entries.filter((entry) => entry.resolution === 'SOURCE').length,
    reviewedDecisionResolved: entries.filter((entry) => entry.resolution === 'REVIEWED_DECISION')
      .length,
  };
  return { ...manifest, counts, entries };
}
