import { createHash } from 'node:crypto';
import { stableJson } from './fish-catalog-audit.js';

export interface FishCatalogCleanupManifest {
  schemaVersion: 1;
  mode: 'DELETE_FISH_WITHOUT_CATCH_REPORTS';
  fish: string[];
}

export interface FishCatalogCleanupLiveRow {
  id: string;
  name: string;
  catchReports: number;
  baseFishLinks: number;
}

export interface FishCatalogCleanupPlanEntry extends FishCatalogCleanupLiveRow {
  outcome: 'DELETE' | 'BLOCKED_CATCH_REPORTS';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateFishCatalogCleanupManifest(value: unknown): FishCatalogCleanupManifest {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 3 ||
    value.schemaVersion !== 1 ||
    value.mode !== 'DELETE_FISH_WITHOUT_CATCH_REPORTS' ||
    !Array.isArray(value.fish) ||
    value.fish.length === 0 ||
    value.fish.some(
      (name) => typeof name !== 'string' || name.length === 0 || name.trim() !== name,
    ) ||
    new Set(value.fish).size !== value.fish.length
  ) {
    throw new Error('Fish catalog cleanup manifest is invalid');
  }
  const fishNames = value.fish as string[];
  const sorted = [...fishNames].sort();
  if (stableJson(sorted) !== stableJson(fishNames)) {
    throw new Error('Fish catalog cleanup names are not sorted');
  }
  return value as unknown as FishCatalogCleanupManifest;
}

export function buildFishCatalogCleanupPlan(input: {
  manifestSha256: string;
  manifest: FishCatalogCleanupManifest;
  liveRows: readonly FishCatalogCleanupLiveRow[];
}) {
  const targetNames = new Set(input.manifest.fish);
  const blockers: string[] = [];
  const liveByName = new Map<string, FishCatalogCleanupLiveRow>();
  for (const row of input.liveRows) {
    if (!targetNames.has(row.name)) blockers.push(`unexpected Fish in cleanup state: ${row.name}`);
    if (liveByName.has(row.name)) blockers.push(`duplicate live Fish name: ${row.name}`);
    if (
      !Number.isSafeInteger(row.catchReports) ||
      row.catchReports < 0 ||
      !Number.isSafeInteger(row.baseFishLinks) ||
      row.baseFishLinks < 0
    ) {
      blockers.push(`invalid dependency counts for Fish: ${row.name}`);
    }
    liveByName.set(row.name, row);
  }

  const entries: FishCatalogCleanupPlanEntry[] = input.manifest.fish.flatMap((name) => {
    const row = liveByName.get(name);
    if (row === undefined) return [];
    return [{ ...row, outcome: row.catchReports === 0 ? 'DELETE' : 'BLOCKED_CATCH_REPORTS' }];
  });
  const alreadyAbsent = input.manifest.fish.filter((name) => !liveByName.has(name));
  const planFingerprint = createHash('sha256')
    .update(
      stableJson({
        schemaVersion: 1,
        mode: 'DELETE_FISH_WITHOUT_CATCH_REPORTS',
        manifestSha256: input.manifestSha256,
        entries,
        alreadyAbsent,
      }),
    )
    .digest('hex');

  return {
    schemaVersion: 1 as const,
    mode: 'DELETE_FISH_WITHOUT_CATCH_REPORTS' as const,
    planFingerprint,
    counts: {
      requested: input.manifest.fish.length,
      deleteFish: entries.filter((entry) => entry.outcome === 'DELETE').length,
      deleteBaseFishLinks: entries
        .filter((entry) => entry.outcome === 'DELETE')
        .reduce((total, entry) => total + entry.baseFishLinks, 0),
      blockedFish: entries.filter((entry) => entry.outcome === 'BLOCKED_CATCH_REPORTS').length,
      blockedCatchReports: entries
        .filter((entry) => entry.outcome === 'BLOCKED_CATCH_REPORTS')
        .reduce((total, entry) => total + entry.catchReports, 0),
      alreadyAbsent: alreadyAbsent.length,
    },
    blockers: [...new Set(blockers)].sort(),
    entries,
    alreadyAbsent,
  };
}
