import { sha256, stableJson } from './fish-catalog-audit.js';
import type {
  BaseFishWeightAudit,
  BaseFishWeightAuditRow,
  WeightRowStatus,
} from './base-fish-weight-audit.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type BaseFishWeightClassification =
  'suspicious-low' | 'ordinary' | 'mutant' | 'suspicious-high' | 'unclassified';

export interface BaseFishWeightDecisionSourceRow {
  sourceSheet: string;
  fishCell: string;
  minCell: string;
  maxCell: string;
  rawMin: string | null;
  rawMax: string | null;
}

export interface BaseFishWeightReviewedDecision {
  baseName: string;
  canonicalFish: string;
  forumTopicId: string;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  sourceRows: BaseFishWeightDecisionSourceRow[];
  rationale: string;
}

export interface BaseFishWeightReviewedDecisions {
  schemaVersion: 1;
  mode: 'REVIEWED';
  sources: BaseFishWeightAudit['sources'];
  policy: {
    missingBoundsAreValidNullableData: true;
    automaticSwapsOrFixes: false;
    conflictsRequireExplicitDecision: true;
  };
  decisions: BaseFishWeightReviewedDecision[];
}

export interface BaseFishWeightApplyReadySourceRow extends BaseFishWeightDecisionSourceRow {
  rawFishName: string;
  reconciliationCategory: BaseFishWeightAuditRow['reconciliationCategory'];
  rowStatus: WeightRowStatus;
}

export interface BaseFishWeightApplyReadyEntry {
  baseName: string;
  canonicalFish: string;
  forumTopicId: string;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  resolution: 'SOURCE' | 'REVIEWED_DECISION';
  sourceRows: BaseFishWeightApplyReadySourceRow[];
}

export interface BaseFishWeightApplyReadyManifest {
  schemaVersion: 1;
  mode: 'APPLY_READY';
  sources: BaseFishWeightAudit['sources'] & {
    weightAuditSha256: string;
    reviewedDecisionsSha256: string;
  };
  policy: {
    identitySource: 'accepted Excel reconciliation -> forum69 topicId';
    excelNamesMayRenameCanonicalFish: false;
    missingBoundsAreValidNullableData: true;
    catchReportsRead: false;
    exactIntegerArithmetic: true;
    classification: {
      suspiciousLow: 'minWeightGrams != null && weightGrams < minWeightGrams';
      ordinary: 'both bounds known && minWeightGrams <= weightGrams <= maxWeightGrams';
      mutant: 'maxWeightGrams != null && maxWeightGrams < weightGrams && weightGrams * 20 <= maxWeightGrams * 21';
      suspiciousHigh: 'maxWeightGrams != null && weightGrams * 20 > maxWeightGrams * 21';
      unclassified: 'otherwise';
    };
  };
  counts: {
    targets: number;
    bothKnown: number;
    minOnly: number;
    maxOnly: number;
    neither: number;
    sourceResolved: number;
    reviewedDecisionResolved: number;
  };
  unresolvedBlockers: [];
  entries: BaseFishWeightApplyReadyEntry[];
}

export interface BaseFishWeightApplyReadyInput {
  audit: BaseFishWeightAudit;
  reviewedDecisions: BaseFishWeightReviewedDecisions;
  reviewedDecisionsSha256: string;
  expectedTargetCount?: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function targetKey(baseName: string, forumTopicId: string): string {
  return `${baseName}\0${forumTopicId}`;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${label} must be a positive PostgreSQL integer`);
  }
}

export function classifyBaseFishWeight(
  weightGrams: number,
  minWeightGrams: number | null,
  maxWeightGrams: number | null,
): BaseFishWeightClassification {
  assertPositiveInteger(weightGrams, 'weightGrams');
  if (minWeightGrams !== null) assertPositiveInteger(minWeightGrams, 'minWeightGrams');
  if (maxWeightGrams !== null) assertPositiveInteger(maxWeightGrams, 'maxWeightGrams');
  if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
    throw new Error('minWeightGrams must not exceed maxWeightGrams');
  }

  if (minWeightGrams !== null && weightGrams < minWeightGrams) return 'suspicious-low';
  if (maxWeightGrams !== null && weightGrams > maxWeightGrams) {
    return BigInt(weightGrams) * 20n <= BigInt(maxWeightGrams) * 21n ? 'mutant' : 'suspicious-high';
  }
  if (minWeightGrams !== null && maxWeightGrams !== null) return 'ordinary';
  return 'unclassified';
}

function decisionEvidence(row: BaseFishWeightAuditRow): BaseFishWeightDecisionSourceRow {
  return {
    sourceSheet: row.sourceSheet,
    fishCell: row.fishCell,
    minCell: row.min.cell,
    maxCell: row.max.cell,
    rawMin: row.min.rawValue,
    rawMax: row.max.rawValue,
  };
}

function manifestEvidence(row: BaseFishWeightAuditRow): BaseFishWeightApplyReadySourceRow {
  return {
    ...decisionEvidence(row),
    rawFishName: row.rawFishName,
    reconciliationCategory: row.reconciliationCategory,
    rowStatus: row.status,
  };
}

function sortEvidence<T extends { sourceSheet: string; fishCell: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (left, right) =>
      compareText(left.sourceSheet, right.sourceSheet) ||
      Number(left.fishCell.match(/\d+$/u)?.[0] ?? 0) -
        Number(right.fishCell.match(/\d+$/u)?.[0] ?? 0) ||
      compareText(left.fishCell, right.fishCell),
  );
}

function needsReviewedDecision(rows: readonly BaseFishWeightAuditRow[]): boolean {
  return rows.some(
    (row) =>
      row.status === 'INVALID' || row.status === 'SWAPPED' || row.targetGroupStatus === 'CONFLICT',
  );
}

function sourceBounds(row: BaseFishWeightAuditRow): {
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
} {
  return {
    minWeightGrams: row.min.status === 'VALID' ? row.min.valueGrams : null,
    maxWeightGrams: row.max.status === 'VALID' ? row.max.valueGrams : null,
  };
}

function validateBounds(
  minWeightGrams: number | null,
  maxWeightGrams: number | null,
  label: string,
  blockers: string[],
): void {
  try {
    if (minWeightGrams !== null) assertPositiveInteger(minWeightGrams, `${label} minWeightGrams`);
    if (maxWeightGrams !== null) assertPositiveInteger(maxWeightGrams, `${label} maxWeightGrams`);
    if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
      blockers.push(`${label} minWeightGrams exceeds maxWeightGrams`);
    }
  } catch (error: unknown) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
}

function knownManualAuditBlockers(audit: BaseFishWeightAudit): Set<string> {
  const blockers = new Set<string>();
  if (audit.weightStatusCounts.SWAPPED > 0) {
    blockers.add(
      `${String(audit.weightStatusCounts.SWAPPED)} SWAPPED source rows require reviewed decisions`,
    );
  }
  if (audit.weightStatusCounts.INVALID > 0) {
    blockers.add(
      `${String(audit.weightStatusCounts.INVALID)} INVALID source rows require reviewed decisions`,
    );
  }
  if (audit.conflictingGroups > 0) {
    blockers.add(
      `${String(audit.conflictingGroups)} conflicting Base+Fish groups require reviewed decisions`,
    );
  }
  return blockers;
}

export function buildBaseFishWeightApplyReadyManifest(
  input: BaseFishWeightApplyReadyInput,
): BaseFishWeightApplyReadyManifest {
  const blockers: string[] = [];
  const { audit, reviewedDecisions } = input;

  if (audit.mode !== 'AUDIT_ONLY') blockers.push('weight audit mode is not AUDIT_ONLY');
  if (reviewedDecisions.schemaVersion !== 1) {
    blockers.push('reviewed decisions schemaVersion is not 1');
  }
  if (reviewedDecisions.mode !== 'REVIEWED') {
    blockers.push('reviewed decisions mode is not REVIEWED');
  }
  if (!reviewedDecisions.policy.missingBoundsAreValidNullableData) {
    blockers.push('reviewed decisions do not accept nullable missing bounds');
  }
  if (reviewedDecisions.policy.automaticSwapsOrFixes) {
    blockers.push('reviewed decisions enable automatic swaps or fixes');
  }
  if (!reviewedDecisions.policy.conflictsRequireExplicitDecision) {
    blockers.push('reviewed decisions do not require explicit conflict decisions');
  }
  if (stableJson(reviewedDecisions.sources) !== stableJson(audit.sources)) {
    blockers.push('reviewed decisions source hashes differ from the weight audit');
  }

  const allowedManualBlockers = knownManualAuditBlockers(audit);
  for (const blocker of audit.blockersBeforeApplyReady) {
    if (!allowedManualBlockers.has(blocker)) blockers.push(`unresolved audit blocker: ${blocker}`);
  }

  const groups = new Map<string, BaseFishWeightAuditRow[]>();
  for (const row of audit.rows) {
    if (row.forumTopicId === null) continue;
    const key = targetKey(row.baseName, row.forumTopicId);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const decisions = new Map<string, BaseFishWeightReviewedDecision>();
  for (const decision of reviewedDecisions.decisions) {
    const key = targetKey(decision.baseName, decision.forumTopicId);
    if (decisions.has(key)) blockers.push(`reviewed decision is duplicated: ${key}`);
    decisions.set(key, decision);
  }

  const usedDecisions = new Set<string>();
  const entries: BaseFishWeightApplyReadyEntry[] = [];
  const sortedGroups = [...groups.entries()].sort(([left], [right]) => compareText(left, right));

  for (const [key, unsortedRows] of sortedGroups) {
    const rows = sortEvidence(unsortedRows);
    const first = rows[0];
    if (first === undefined || first.forumTopicId === null || first.canonicalFish === null) {
      blockers.push(`target ${key} has no canonical forum69 identity`);
      continue;
    }
    if (
      rows.some(
        (row) =>
          row.forumTopicId !== first.forumTopicId || row.canonicalFish !== first.canonicalFish,
      )
    ) {
      blockers.push(`target ${key} has inconsistent canonical identities`);
      continue;
    }

    const decision = decisions.get(key);
    const requiresDecision = needsReviewedDecision(rows);
    if (requiresDecision && decision === undefined) {
      blockers.push(
        `target ${first.baseName} / ${first.canonicalFish} requires a reviewed decision`,
      );
      continue;
    }
    if (!requiresDecision && decision !== undefined) {
      blockers.push(
        `target ${first.baseName} / ${first.canonicalFish} has an unnecessary reviewed decision`,
      );
      continue;
    }

    let minWeightGrams: number | null;
    let maxWeightGrams: number | null;
    let resolution: BaseFishWeightApplyReadyEntry['resolution'];
    if (decision === undefined) {
      ({ minWeightGrams, maxWeightGrams } = sourceBounds(first));
      resolution = 'SOURCE';
    } else {
      usedDecisions.add(key);
      if (decision.canonicalFish !== first.canonicalFish) {
        blockers.push(`reviewed decision canonical Fish differs for ${key}`);
      }
      const expectedEvidence = sortEvidence(rows.map(decisionEvidence));
      const actualEvidence = sortEvidence(decision.sourceRows);
      if (stableJson(actualEvidence) !== stableJson(expectedEvidence)) {
        blockers.push(`reviewed decision source evidence differs for ${key}`);
      }
      minWeightGrams = decision.minWeightGrams;
      maxWeightGrams = decision.maxWeightGrams;
      resolution = 'REVIEWED_DECISION';
    }

    validateBounds(minWeightGrams, maxWeightGrams, `target ${key}`, blockers);
    entries.push({
      baseName: first.baseName,
      canonicalFish: first.canonicalFish,
      forumTopicId: first.forumTopicId,
      minWeightGrams,
      maxWeightGrams,
      resolution,
      sourceRows: rows.map(manifestEvidence),
    });
  }

  for (const [key, decision] of decisions) {
    if (!groups.has(key)) blockers.push(`reviewed decision has no target: ${key}`);
    else if (!usedDecisions.has(key)) {
      blockers.push(
        `reviewed decision was not applied: ${decision.baseName} / ${decision.canonicalFish}`,
      );
    }
  }

  if (entries.length !== audit.uniqueTargetMemberships) {
    blockers.push(
      `final target count is ${String(entries.length)}; audit has ${String(audit.uniqueTargetMemberships)}`,
    );
  }
  if (input.expectedTargetCount !== undefined && entries.length !== input.expectedTargetCount) {
    blockers.push(
      `final target count is ${String(entries.length)}; expected ${String(input.expectedTargetCount)}`,
    );
  }

  if (blockers.length > 0) {
    throw new Error(
      `BaseFish weights are not APPLY_READY:\n${[...new Set(blockers)].sort(compareText).join('\n')}`,
    );
  }

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

  return {
    schemaVersion: 1,
    mode: 'APPLY_READY',
    sources: {
      ...audit.sources,
      weightAuditSha256: sha256(stableJson(audit)),
      reviewedDecisionsSha256: input.reviewedDecisionsSha256,
    },
    policy: {
      identitySource: 'accepted Excel reconciliation -> forum69 topicId',
      excelNamesMayRenameCanonicalFish: false,
      missingBoundsAreValidNullableData: true,
      catchReportsRead: false,
      exactIntegerArithmetic: true,
      classification: {
        suspiciousLow: 'minWeightGrams != null && weightGrams < minWeightGrams',
        ordinary: 'both bounds known && minWeightGrams <= weightGrams <= maxWeightGrams',
        mutant:
          'maxWeightGrams != null && maxWeightGrams < weightGrams && weightGrams * 20 <= maxWeightGrams * 21',
        suspiciousHigh: 'maxWeightGrams != null && weightGrams * 20 > maxWeightGrams * 21',
        unclassified: 'otherwise',
      },
    },
    counts,
    unresolvedBlockers: [],
    entries,
  };
}

export function baseFishWeightApplyReadySha256(manifest: BaseFishWeightApplyReadyManifest): string {
  return sha256(stableJson(manifest));
}
