import type {
  BaseFishWeightApplyReadyEntry,
  BaseFishWeightApplyReadyManifest,
} from './base-fish-weight-apply-ready.js';
import { sha256, stableJson } from './fish-catalog-audit.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface LiveBaseFishWeightMembership {
  fishingBaseId: string;
  baseName: string;
  fishId: string;
  fishName: string;
  forumTopicId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

export interface BaseFishWeightProtectedState {
  basesCount: number;
  fishCount: number;
  membershipsCount: number;
  basesFingerprint: string;
  fishFingerprint: string;
  membershipIdentitiesFingerprint: string;
}

export interface BaseFishWeightFieldChange {
  fishingBaseId: string;
  fishId: string;
  baseName: string;
  canonicalFish: string;
  forumTopicId: string;
  before: {
    minWeightGrams: number | null;
    maxWeightGrams: number | null;
  };
  after: {
    minWeightGrams: number | null;
    maxWeightGrams: number | null;
  };
  changedFields: Array<'minWeightGrams' | 'maxWeightGrams'>;
}

export interface BaseFishWeightMaterializationPlan {
  schemaVersion: 1;
  mode: 'BASE_FISH_WEIGHT_MATERIALIZATION';
  manifestSha256: string;
  planFingerprint: string;
  counts: {
    targets: number;
    matchedTargets: number;
    unmatchedTargets: number;
    liveMemberships: number;
    untargetedLiveMemberships: number;
    plannedMembershipUpdates: number;
    plannedFieldChanges: number;
    minWeightFieldChanges: number;
    maxWeightFieldChanges: number;
    finalBounds: {
      bothKnown: number;
      minOnly: number;
      maxOnly: number;
      neither: number;
    };
  };
  preservation: BaseFishWeightProtectedState & {
    basesUnchanged: true;
    fishUnchanged: true;
    membershipIdentitiesUnchanged: true;
    catchReportsRead: false;
    catchReportsChanged: false;
  };
  blockers: string[];
  changes: BaseFishWeightFieldChange[];
}

export interface BaseFishWeightMaterializationInput {
  manifest: BaseFishWeightApplyReadyManifest;
  manifestSha256: string;
  liveMemberships: readonly LiveBaseFishWeightMembership[];
  protectedState: BaseFishWeightProtectedState;
  expectedTargetCount?: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function targetKey(baseName: string, forumTopicId: string): string {
  return `${baseName}\0${forumTopicId}`;
}

function validateBound(value: number | null, label: string, blockers: string[]): void {
  if (value !== null && (!Number.isInteger(value) || value <= 0 || value > POSTGRES_INTEGER_MAX)) {
    blockers.push(`${label} is not a positive PostgreSQL integer or null`);
  }
}

function validateManifestEntry(entry: BaseFishWeightApplyReadyEntry, blockers: string[]): void {
  const label = `${entry.baseName} / ${entry.canonicalFish}`;
  validateBound(entry.minWeightGrams, `${label} minWeightGrams`, blockers);
  validateBound(entry.maxWeightGrams, `${label} maxWeightGrams`, blockers);
  if (
    entry.minWeightGrams !== null &&
    entry.maxWeightGrams !== null &&
    entry.minWeightGrams > entry.maxWeightGrams
  ) {
    blockers.push(`${label} minWeightGrams exceeds maxWeightGrams`);
  }
}

function finalBoundCounts(entries: readonly BaseFishWeightApplyReadyEntry[]): {
  bothKnown: number;
  minOnly: number;
  maxOnly: number;
  neither: number;
} {
  return {
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
  };
}

export function buildBaseFishWeightMaterializationPlan(
  input: BaseFishWeightMaterializationInput,
): BaseFishWeightMaterializationPlan {
  const blockers: string[] = [];
  const entries = [...input.manifest.entries].sort(
    (left, right) =>
      compareText(left.baseName, right.baseName) ||
      compareText(left.forumTopicId, right.forumTopicId),
  );
  const liveMemberships = [...input.liveMemberships].sort(
    (left, right) =>
      compareText(left.fishingBaseId, right.fishingBaseId) ||
      compareText(left.fishId, right.fishId),
  );

  if (input.manifest.mode !== 'APPLY_READY') blockers.push('manifest mode is not APPLY_READY');
  if (input.manifest.schemaVersion !== 1) blockers.push('manifest schemaVersion is not 1');
  if (input.manifest.unresolvedBlockers.length > 0) {
    blockers.push('manifest contains unresolved blockers');
  }
  if (entries.length !== input.manifest.counts.targets) {
    blockers.push(
      `manifest has ${String(entries.length)} entries; counts.targets is ${String(input.manifest.counts.targets)}`,
    );
  }
  if (input.expectedTargetCount !== undefined && entries.length !== input.expectedTargetCount) {
    blockers.push(
      `manifest has ${String(entries.length)} entries; expected ${String(input.expectedTargetCount)}`,
    );
  }

  const expectedBounds = finalBoundCounts(entries);
  for (const key of ['bothKnown', 'minOnly', 'maxOnly', 'neither'] as const) {
    if (expectedBounds[key] !== input.manifest.counts[key]) {
      blockers.push(
        `manifest ${key} count is ${String(input.manifest.counts[key])}; entries produce ${String(expectedBounds[key])}`,
      );
    }
  }

  const manifestByKey = new Map<string, BaseFishWeightApplyReadyEntry>();
  for (const entry of entries) {
    validateManifestEntry(entry, blockers);
    const key = targetKey(entry.baseName, entry.forumTopicId);
    if (manifestByKey.has(key)) blockers.push(`manifest target is duplicated: ${key}`);
    manifestByKey.set(key, entry);
  }

  const liveByKey = new Map<string, LiveBaseFishWeightMembership[]>();
  for (const membership of liveMemberships) {
    validateBound(
      membership.minWeightGrams,
      `live membership ${membership.fishingBaseId}/${membership.fishId} minWeightGrams`,
      blockers,
    );
    validateBound(
      membership.maxWeightGrams,
      `live membership ${membership.fishingBaseId}/${membership.fishId} maxWeightGrams`,
      blockers,
    );
    if (
      membership.minWeightGrams !== null &&
      membership.maxWeightGrams !== null &&
      membership.minWeightGrams > membership.maxWeightGrams
    ) {
      blockers.push(
        `live membership ${membership.fishingBaseId}/${membership.fishId} has reversed bounds`,
      );
    }
    if (membership.forumTopicId === null) continue;
    const key = targetKey(membership.baseName, membership.forumTopicId);
    const group = liveByKey.get(key) ?? [];
    group.push(membership);
    liveByKey.set(key, group);
  }

  const changes: BaseFishWeightFieldChange[] = [];
  let matchedTargets = 0;
  for (const entry of entries) {
    const key = targetKey(entry.baseName, entry.forumTopicId);
    const matches = liveByKey.get(key) ?? [];
    if (matches.length === 0) {
      blockers.push(
        `manifest target has no existing membership: ${entry.baseName} / ${entry.canonicalFish}`,
      );
      continue;
    }
    if (matches.length > 1) {
      blockers.push(
        `manifest target matches multiple memberships: ${entry.baseName} / ${entry.canonicalFish}`,
      );
      continue;
    }
    const membership = matches[0];
    if (membership === undefined) continue;
    matchedTargets += 1;
    if (membership.fishName !== entry.canonicalFish) {
      blockers.push(
        `forum69 topic ${entry.forumTopicId} live Fish is "${membership.fishName}"; manifest requires "${entry.canonicalFish}"`,
      );
    }
    const changedFields: BaseFishWeightFieldChange['changedFields'] = [];
    if (membership.minWeightGrams !== entry.minWeightGrams) changedFields.push('minWeightGrams');
    if (membership.maxWeightGrams !== entry.maxWeightGrams) changedFields.push('maxWeightGrams');
    if (changedFields.length > 0) {
      changes.push({
        fishingBaseId: membership.fishingBaseId,
        fishId: membership.fishId,
        baseName: entry.baseName,
        canonicalFish: entry.canonicalFish,
        forumTopicId: entry.forumTopicId,
        before: {
          minWeightGrams: membership.minWeightGrams,
          maxWeightGrams: membership.maxWeightGrams,
        },
        after: {
          minWeightGrams: entry.minWeightGrams,
          maxWeightGrams: entry.maxWeightGrams,
        },
        changedFields,
      });
    }
  }

  changes.sort(
    (left, right) =>
      compareText(left.fishingBaseId, right.fishingBaseId) ||
      compareText(left.fishId, right.fishId),
  );
  const untargetedLiveMemberships = liveMemberships.filter((membership) => {
    if (membership.forumTopicId === null) return true;
    return !manifestByKey.has(targetKey(membership.baseName, membership.forumTopicId));
  }).length;
  const counts: BaseFishWeightMaterializationPlan['counts'] = {
    targets: entries.length,
    matchedTargets,
    unmatchedTargets: entries.length - matchedTargets,
    liveMemberships: liveMemberships.length,
    untargetedLiveMemberships,
    plannedMembershipUpdates: changes.length,
    plannedFieldChanges: changes.reduce((total, change) => total + change.changedFields.length, 0),
    minWeightFieldChanges: changes.filter((change) =>
      change.changedFields.includes('minWeightGrams'),
    ).length,
    maxWeightFieldChanges: changes.filter((change) =>
      change.changedFields.includes('maxWeightGrams'),
    ).length,
    finalBounds: expectedBounds,
  };

  if (counts.matchedTargets + counts.unmatchedTargets !== counts.targets) {
    blockers.push('matched and unmatched target counts do not equal manifest targets');
  }
  const weightsBefore = liveMemberships.map((membership) => ({
    fishingBaseId: membership.fishingBaseId,
    fishId: membership.fishId,
    minWeightGrams: membership.minWeightGrams,
    maxWeightGrams: membership.maxWeightGrams,
  }));
  const uniqueBlockers = [...new Set(blockers)].sort(compareText);
  const planFingerprint = sha256(
    stableJson({
      schemaVersion: 1,
      mode: 'BASE_FISH_WEIGHT_MATERIALIZATION',
      manifestSha256: input.manifestSha256,
      protectedState: input.protectedState,
      weightsBefore,
      counts,
      blockers: uniqueBlockers,
      changes,
    }),
  );

  return {
    schemaVersion: 1,
    mode: 'BASE_FISH_WEIGHT_MATERIALIZATION',
    manifestSha256: input.manifestSha256,
    planFingerprint,
    counts,
    preservation: {
      ...input.protectedState,
      basesUnchanged: true,
      fishUnchanged: true,
      membershipIdentitiesUnchanged: true,
      catchReportsRead: false,
      catchReportsChanged: false,
    },
    blockers: uniqueBlockers,
    changes,
  };
}
