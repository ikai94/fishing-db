import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  BaseFishWeightApplyReadyEntry,
  BaseFishWeightApplyReadyManifest,
} from './base-fish-weight-apply-ready.js';
import {
  buildBaseFishWeightMaterializationPlan,
  type BaseFishWeightProtectedState,
  type LiveBaseFishWeightMembership,
} from './base-fish-weight-materialization.js';
import {
  ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256,
  parseBaseFishWeightMaterializationCommand,
} from './materialize-base-fish-weights.js';

function entry(
  baseName: string,
  canonicalFish: string,
  forumTopicId: string,
  minWeightGrams: number | null,
  maxWeightGrams: number | null,
): BaseFishWeightApplyReadyEntry {
  return {
    baseName,
    canonicalFish,
    forumTopicId,
    minWeightGrams,
    maxWeightGrams,
    resolution: 'SOURCE',
    sourceRows: [],
  };
}

function manifest(entries: BaseFishWeightApplyReadyEntry[]): BaseFishWeightApplyReadyManifest {
  const bothKnown = entries.filter(
    (candidate) => candidate.minWeightGrams !== null && candidate.maxWeightGrams !== null,
  ).length;
  const minOnly = entries.filter(
    (candidate) => candidate.minWeightGrams !== null && candidate.maxWeightGrams === null,
  ).length;
  const maxOnly = entries.filter(
    (candidate) => candidate.minWeightGrams === null && candidate.maxWeightGrams !== null,
  ).length;
  const neither = entries.filter(
    (candidate) => candidate.minWeightGrams === null && candidate.maxWeightGrams === null,
  ).length;
  return {
    schemaVersion: 1,
    mode: 'APPLY_READY',
    sources: {
      workbookFileName: 'test.xlsx',
      workbookSha256: 'workbook',
      reconciliationSha256: 'reconciliation',
      forum69Sha256: 'forum69',
      weightAuditSha256: 'audit',
      reviewedDecisionsSha256: 'decisions',
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
    counts: {
      targets: entries.length,
      bothKnown,
      minOnly,
      maxOnly,
      neither,
      sourceResolved: entries.length,
      reviewedDecisionResolved: 0,
    },
    unresolvedBlockers: [],
    entries,
  };
}

const protectedState: BaseFishWeightProtectedState = {
  basesCount: 3,
  fishCount: 4,
  membershipsCount: 4,
  basesFingerprint: 'bases',
  fishFingerprint: 'fish',
  membershipIdentitiesFingerprint: 'memberships',
};

function live(
  index: number,
  baseName: string,
  fishName: string,
  forumTopicId: string | null,
  minWeightGrams: number | null = null,
  maxWeightGrams: number | null = null,
): LiveBaseFishWeightMembership {
  return {
    fishingBaseId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    baseName,
    fishId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    fishName,
    forumTopicId,
    minWeightGrams,
    maxWeightGrams,
  };
}

void describe('BaseFish weight materialization', () => {
  void it('requires dry-run or fingerprint-guarded apply CLI modes', () => {
    assert.deepEqual(parseBaseFishWeightMaterializationCommand(['--dry-run']), {
      mode: 'DRY_RUN',
    });
    assert.deepEqual(
      parseBaseFishWeightMaterializationCommand([
        '--apply',
        `--expected-plan-fingerprint=${'a'.repeat(64)}`,
      ]),
      { mode: 'APPLY', expectedPlanFingerprint: 'a'.repeat(64) },
    );
    for (const arguments_ of [
      [],
      ['--apply'],
      ['--apply', '--expected-plan-fingerprint=not-a-hash'],
      ['--dry-run', '--apply'],
    ]) {
      assert.throws(() => parseBaseFishWeightMaterializationCommand(arguments_), /usage/u);
    }
    assert.equal(
      ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256,
      'c36b13cb186632a5017f9d63e7f3a1b082539d7323c4b423f267f42598ad161a',
    );
  });

  void it('matches only existing Base+forum69 memberships and plans nullable field updates', () => {
    const entries = [
      entry('База A', 'Рыба 1', '1', 10, 100),
      entry('База B', 'Рыба 2', '2', null, 200),
      entry('База C', 'Рыба 3', '3', null, null),
    ];
    const memberships = [
      live(1, 'База A', 'Рыба 1', '1'),
      live(2, 'База B', 'Рыба 2', '2'),
      live(3, 'База C', 'Рыба 3', '3'),
      live(4, 'Пользовательская база', 'Рыба 4', null),
    ];
    const plan = buildBaseFishWeightMaterializationPlan({
      manifest: manifest(entries),
      manifestSha256: 'manifest',
      liveMemberships: memberships,
      protectedState,
      expectedTargetCount: 3,
    });

    assert.deepEqual(plan.counts, {
      targets: 3,
      matchedTargets: 3,
      unmatchedTargets: 0,
      liveMemberships: 4,
      untargetedLiveMemberships: 1,
      plannedMembershipUpdates: 2,
      plannedFieldChanges: 3,
      minWeightFieldChanges: 1,
      maxWeightFieldChanges: 2,
      finalBounds: { bothKnown: 1, minOnly: 0, maxOnly: 1, neither: 1 },
    });
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.preservation.catchReportsRead, false);
    assert.equal(plan.preservation.catchReportsChanged, false);
    assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/u);

    const reordered = buildBaseFishWeightMaterializationPlan({
      manifest: manifest([...entries].reverse()),
      manifestSha256: 'manifest',
      liveMemberships: [...memberships].reverse(),
      protectedState,
      expectedTargetCount: 3,
    });
    assert.equal(reordered.planFingerprint, plan.planFingerprint);
  });

  void it('is idempotent and blocks unmatched or canonically inconsistent targets', () => {
    const desired = manifest([entry('База A', 'Рыба 1', '1', 10, 100)]);
    const idempotent = buildBaseFishWeightMaterializationPlan({
      manifest: desired,
      manifestSha256: 'manifest',
      liveMemberships: [live(1, 'База A', 'Рыба 1', '1', 10, 100)],
      protectedState: { ...protectedState, membershipsCount: 1 },
      expectedTargetCount: 1,
    });
    assert.equal(idempotent.counts.plannedFieldChanges, 0);
    assert.deepEqual(idempotent.blockers, []);

    const blocked = buildBaseFishWeightMaterializationPlan({
      manifest: manifest([
        entry('База A', 'Другое имя', '1', 10, 100),
        entry('Нет такой базы', 'Рыба 2', '2', null, 200),
      ]),
      manifestSha256: 'manifest',
      liveMemberships: [live(1, 'База A', 'Рыба 1', '1')],
      protectedState: { ...protectedState, membershipsCount: 1 },
      expectedTargetCount: 2,
    });
    assert.equal(blocked.counts.matchedTargets, 1);
    assert.equal(blocked.counts.unmatchedTargets, 1);
    assert.match(blocked.blockers.join('\n'), /live Fish is "Рыба 1"/u);
    assert.match(blocked.blockers.join('\n'), /has no existing membership/u);
  });
});
