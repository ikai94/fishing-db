import type { FishReconciliationEntry } from '../prisma/fish-catalog-audit.js';
import {
  resolveForumCandidate,
  type ForumCandidateStatus,
  type ResolvedForumCandidate,
} from './catalog-resolver.js';
import {
  fingerprintCatalogSnapshot,
  type CatalogSnapshot,
  type CatalogSnapshotData,
} from './catalog-source.js';
import type { CandidateIdentityManifest } from './candidate-identity-manifest.js';
import type { ParsedForumCandidate } from './candidate-types.js';
import type { StagingCandidate } from './staging.js';
import type { VerifiedForumStagingBundle } from './staging-reader.js';

export interface FishReconciliationManifest {
  schemaVersion: number;
  mode: string;
  sourceCatalogFingerprint: string;
  entries: FishReconciliationEntry[];
}

export interface ForumFishCatalogRecoveryInput {
  scopeKey: string;
  pinnedIdentities: CandidateIdentityManifest;
  currentIdentities: CandidateIdentityManifest;
  parsedCandidates: readonly ParsedForumCandidate[];
  previousStaging: VerifiedForumStagingBundle;
  previousCatalogSnapshot: CatalogSnapshot;
  currentCatalogSnapshot: CatalogSnapshot;
  fishReconciliation: FishReconciliationManifest;
}

interface CandidateStatusCounts {
  USABLE_COMPLETE: number;
  USABLE_PARTIAL: number;
  UNRESOLVED: number;
}

interface MembershipStatusCounts {
  RESOLVED: number;
  MISSING: number;
  UNRESOLVED: number;
}

export interface ForumFishCatalogRecoverySummary {
  scopeKey: string;
  candidates: {
    total: number;
    previous: CandidateStatusCounts;
    recovered: CandidateStatusCounts;
    newlyComplete: number;
    previousCompleteRegressions: 0;
  };
  identity: {
    posts: number;
    candidates: number;
    strictManifestEquality: true;
    identityDrift: 0;
    appendedCandidates: 0;
    missingImportKeys: 0;
    addedImportKeys: 0;
    contributorKeyChanges: 0;
  };
  lineage: {
    fallbackCandidates: number;
    fallbackPreviouslyUnresolvedFish: 0;
    exactTargetConflicts: 0;
    byPreviousStatus: Record<string, number>;
    byDecision: Record<string, number>;
    byCategory: Record<string, number>;
  };
  baseFish: MembershipStatusCounts;
  fuzzyMatchingUsed: false;
}

export interface ForumFishCatalogRecoveryResult {
  candidates: ResolvedForumCandidate[];
  newlyImportableImportKeys: string[];
  summary: ForumFishCatalogRecoverySummary;
}

export class ForumFishCatalogRecoveryError extends Error {
  readonly code = 'FORUM_FISH_CATALOG_RECOVERY_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'ForumFishCatalogRecoveryError';
  }
}

function blocked(message: string): never {
  throw new ForumFishCatalogRecoveryError(message);
}

function snapshotData(snapshot: CatalogSnapshot): CatalogSnapshotData {
  return {
    version: snapshot.version,
    fishingBases: snapshot.fishingBases,
    locations: snapshot.locations,
    fish: snapshot.fish,
    baits: snapshot.baits,
    memberships: snapshot.memberships,
  };
}

function assertSnapshotFingerprint(snapshot: CatalogSnapshot, label: string): void {
  if (fingerprintCatalogSnapshot(snapshotData(snapshot)) !== snapshot.fingerprint) {
    blocked(`${label} catalog snapshot fingerprint is invalid`);
  }
}

function candidateCount(manifest: CandidateIdentityManifest): number {
  return manifest.posts.reduce((total, post) => total + post.candidates.length, 0);
}

export function assertCandidateIdentityManifestExactlyEqual(
  pinned: CandidateIdentityManifest,
  current: CandidateIdentityManifest,
): void {
  if (JSON.stringify(pinned) !== JSON.stringify(current)) {
    blocked('Candidate identity manifest differs from the frozen manifest');
  }
}

function uniqueByImportKey<Value extends { importKey: string }>(
  values: readonly Value[],
  label: string,
): Map<string, Value> {
  const result = new Map<string, Value>();
  for (const value of values) {
    if (result.has(value.importKey)) blocked(`${label} has duplicate importKey ${value.importKey}`);
    result.set(value.importKey, value);
  }
  return result;
}

function statusCounts(
  candidates: readonly { status: ForumCandidateStatus }[],
): CandidateStatusCounts {
  const counts: CandidateStatusCounts = {
    USABLE_COMPLETE: 0,
    USABLE_PARTIAL: 0,
    UNRESOLVED: 0,
  };
  for (const candidate of candidates) counts[candidate.status] += 1;
  return counts;
}

function membershipCounts(candidates: readonly ResolvedForumCandidate[]): MembershipStatusCounts {
  const counts: MembershipStatusCounts = { RESOLVED: 0, MISSING: 0, UNRESOLVED: 0 };
  for (const candidate of candidates) {
    counts[candidate.resolution.fishingBaseFish.status] += 1;
  }
  return counts;
}

function increment(counts: Record<string, number>, value: string): void {
  counts[value] = (counts[value] ?? 0) + 1;
}

function sortedCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function targetFishId(entry: FishReconciliationEntry): string {
  if (entry.decision === 'REPOINT+DEACTIVATE') {
    if (entry.repointTargetFishId === undefined) {
      return blocked(
        `Reconciliation entry for Fish ${entry.currentFishId ?? 'null'} has no target`,
      );
    }
    return entry.repointTargetFishId;
  }
  if (entry.currentFishId === null) {
    return blocked('A previously resolved Fish points to a CREATE reconciliation entry');
  }
  return entry.currentFishId;
}

function assertPreviousCandidateIdentity(
  parsed: ParsedForumCandidate,
  previous: StagingCandidate,
): void {
  if (parsed.importKey !== previous.importKey) {
    blocked(`Candidate importKey changed from ${previous.importKey} to ${parsed.importKey}`);
  }
  if (parsed.contributorKey !== previous.contributorKey) {
    blocked(`Candidate contributorKey changed for ${parsed.importKey}`);
  }
}

export function recoverForumFishCatalogCandidates(
  input: ForumFishCatalogRecoveryInput,
): ForumFishCatalogRecoveryResult {
  assertCandidateIdentityManifestExactlyEqual(input.pinnedIdentities, input.currentIdentities);
  assertSnapshotFingerprint(input.previousCatalogSnapshot, 'Previous');
  assertSnapshotFingerprint(input.currentCatalogSnapshot, 'Current');

  if (
    input.pinnedIdentities.scopeKey !== input.scopeKey ||
    input.currentIdentities.scopeKey !== input.scopeKey
  ) {
    blocked('Candidate identity manifest belongs to a different forum scope');
  }
  if (
    input.fishReconciliation.schemaVersion !== 2 ||
    input.fishReconciliation.mode !== 'APPLY_READY'
  ) {
    blocked('Fish reconciliation manifest is not apply-ready schema version 2');
  }
  if (input.fishReconciliation.entries.some((entry) => entry.decision === 'MANUAL')) {
    blocked('Fish reconciliation manifest still contains MANUAL decisions');
  }
  const sourceFingerprint = input.fishReconciliation.sourceCatalogFingerprint;
  if (
    input.previousStaging.manifest.catalogSnapshotFingerprint !== sourceFingerprint ||
    input.previousCatalogSnapshot.fingerprint !== sourceFingerprint
  ) {
    blocked('Frozen staging/catalog fingerprint does not match the accepted reconciliation source');
  }

  const pinnedCandidateCount = candidateCount(input.pinnedIdentities);
  if (
    input.previousStaging.manifest.candidatesCount !== pinnedCandidateCount ||
    input.previousStaging.candidates.length !== pinnedCandidateCount ||
    input.parsedCandidates.length !== pinnedCandidateCount
  ) {
    blocked('Frozen staging, identity manifest, and reparsed candidate counts differ');
  }

  const previousByImportKey = uniqueByImportKey(input.previousStaging.candidates, 'Frozen staging');
  const parsedByImportKey = uniqueByImportKey(input.parsedCandidates, 'Reparsed candidates');
  for (const importKey of previousByImportKey.keys()) {
    if (!parsedByImportKey.has(importKey)) blocked(`Frozen importKey is missing: ${importKey}`);
  }
  for (const importKey of parsedByImportKey.keys()) {
    if (!previousByImportKey.has(importKey)) blocked(`Unexpected reparsed importKey: ${importKey}`);
  }

  const reconciliationByCurrentFishId = new Map<string, FishReconciliationEntry>();
  for (const entry of input.fishReconciliation.entries) {
    if (entry.currentFishId === null) continue;
    if (reconciliationByCurrentFishId.has(entry.currentFishId)) {
      blocked(`Duplicate reconciliation lineage for Fish ${entry.currentFishId}`);
    }
    reconciliationByCurrentFishId.set(entry.currentFishId, entry);
  }
  const currentFishById = new Map(
    input.currentCatalogSnapshot.fish.map((fish) => [fish.id, fish] as const),
  );

  const byPreviousStatus: Record<string, number> = {};
  const byDecision: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let fallbackCandidates = 0;

  const recovered = input.parsedCandidates.map((parsed): ResolvedForumCandidate => {
    const previous = previousByImportKey.get(parsed.importKey);
    if (previous === undefined) return blocked(`Frozen candidate is missing: ${parsed.importKey}`);
    assertPreviousCandidateIdentity(parsed, previous);

    const exact = resolveForumCandidate(parsed, input.currentCatalogSnapshot);
    const previousFish = previous.resolution.fish;
    if (previousFish.status !== 'RESOLVED') {
      return exact;
    }
    if (previousFish.id === null || previousFish.name === null) {
      return blocked(`Previously resolved Fish identity is incomplete for ${parsed.importKey}`);
    }

    const reconciliation = reconciliationByCurrentFishId.get(previousFish.id);
    if (reconciliation === undefined) {
      return blocked(`Previously resolved Fish ${previousFish.id} has no reconciliation lineage`);
    }
    if (reconciliation.currentName !== previousFish.name) {
      return blocked(
        `Frozen Fish name differs from reconciliation lineage for ${parsed.importKey}`,
      );
    }
    const targetId = targetFishId(reconciliation);
    const target = currentFishById.get(targetId);
    if (target === undefined || !target.isActive) {
      return blocked(`Reconciliation target Fish ${targetId} is absent or inactive`);
    }
    const expectedTargetName = reconciliation.canonicalName ?? reconciliation.currentName;
    if (expectedTargetName === null || target.name !== expectedTargetName) {
      return blocked(`Reconciliation target Fish ${targetId} has an unexpected canonical name`);
    }

    if (exact.resolution.fish.status === 'RESOLVED') {
      if (exact.resolution.fish.id !== targetId) {
        return blocked(
          `Exact Fish resolution conflicts with frozen lineage for ${parsed.importKey}`,
        );
      }
      return exact;
    }

    const lineageResolved = resolveForumCandidate(
      { ...parsed, fishNameRaw: target.name },
      input.currentCatalogSnapshot,
    );
    if (
      lineageResolved.resolution.fish.status !== 'RESOLVED' ||
      lineageResolved.resolution.fish.id !== targetId
    ) {
      return blocked(
        `Reconciliation lineage target cannot resolve exactly for ${parsed.importKey}`,
      );
    }

    fallbackCandidates += 1;
    increment(byPreviousStatus, previous.status);
    increment(byDecision, reconciliation.decision);
    increment(byCategory, reconciliation.category);
    return { ...lineageResolved, fishNameRaw: parsed.fishNameRaw };
  });

  const recoveredByImportKey = uniqueByImportKey(recovered, 'Recovered candidates');
  const previousCompleteRegressions = input.previousStaging.candidates.filter(
    (previous) =>
      previous.status === 'USABLE_COMPLETE' &&
      recoveredByImportKey.get(previous.importKey)?.status !== 'USABLE_COMPLETE',
  );
  if (previousCompleteRegressions.length > 0) {
    blocked(
      `${String(previousCompleteRegressions.length)} previously COMPLETE candidate(s) regressed`,
    );
  }

  const newlyImportableImportKeys = recovered
    .filter((candidate) => {
      const previous = previousByImportKey.get(candidate.importKey);
      return previous?.status !== 'USABLE_COMPLETE' && candidate.status === 'USABLE_COMPLETE';
    })
    .map((candidate) => candidate.importKey)
    .sort();

  return {
    candidates: recovered,
    newlyImportableImportKeys,
    summary: {
      scopeKey: input.scopeKey,
      candidates: {
        total: recovered.length,
        previous: statusCounts(input.previousStaging.candidates),
        recovered: statusCounts(recovered),
        newlyComplete: newlyImportableImportKeys.length,
        previousCompleteRegressions: 0,
      },
      identity: {
        posts: input.pinnedIdentities.posts.length,
        candidates: pinnedCandidateCount,
        strictManifestEquality: true,
        identityDrift: 0,
        appendedCandidates: 0,
        missingImportKeys: 0,
        addedImportKeys: 0,
        contributorKeyChanges: 0,
      },
      lineage: {
        fallbackCandidates,
        fallbackPreviouslyUnresolvedFish: 0,
        exactTargetConflicts: 0,
        byPreviousStatus: sortedCounts(byPreviousStatus),
        byDecision: sortedCounts(byDecision),
        byCategory: sortedCounts(byCategory),
      },
      baseFish: membershipCounts(recovered),
      fuzzyMatchingUsed: false,
    },
  };
}
