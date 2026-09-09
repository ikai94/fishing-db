import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { BaseFishWeightApplyReadyManifest } from './base-fish-weight-apply-ready.js';
import {
  applyBaseFishMaxWeightPatch,
  decodeBaseFishMaxWeightPatch,
} from './base-fish-max-weight-patch.js';
import { buildBaseFishWeightMaterializationPlan } from './base-fish-weight-materialization.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import {
  ACCEPTED_BASE_FISH_MAX_WEIGHT_PATCH_SHA256,
  ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256,
} from './materialize-base-fish-weights.js';

const catalogData = new URL('../../prisma/catalog-data/', import.meta.url);

function readJson(fileName: string): { content: string; value: unknown } {
  const content = readFileSync(new URL(fileName, catalogData), 'utf8');
  return { content, value: JSON.parse(content) as unknown };
}

void describe('approved BaseFish max-weight catalog patch', () => {
  void it('reproduces all 3,606 approved targets and is idempotent against that poststate', () => {
    const baseFile = readJson('fishing-base-fish-weights.json');
    const patchFile = readJson('base-fish-max-weight-patch-20260909.json');
    const base = baseFile.value as BaseFishWeightApplyReadyManifest;
    const patch = decodeBaseFishMaxWeightPatch(patchFile.value);

    assert.equal(sha256(baseFile.content), ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256);
    assert.equal(sha256(patchFile.content), ACCEPTED_BASE_FISH_MAX_WEIGHT_PATCH_SHA256);
    assert.equal(patchFile.content, stableJson(patch));
    assert.deepEqual(patch.counts, {
      entries: 161,
      overrides: 151,
      supplementalTargets: 10,
    });

    const effective = applyBaseFishMaxWeightPatch(
      base,
      patch,
      ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256,
    );
    assert.deepEqual(effective.counts, {
      targets: 3_606,
      bothKnown: 3_570,
      minOnly: 0,
      maxOnly: 35,
      neither: 1,
      sourceResolved: 3_592,
      reviewedDecisionResolved: 14,
    });

    const desiredByKey = new Map(
      patch.entries.map((entry) => [`${entry.baseName}\0${entry.forumTopicId}`, entry]),
    );
    assert.equal(
      effective.entries.filter((entry) =>
        desiredByKey.has(`${entry.baseName}\0${entry.forumTopicId}`),
      ).length,
      161,
    );
    for (const entry of effective.entries) {
      const desired = desiredByKey.get(`${entry.baseName}\0${entry.forumTopicId}`);
      if (desired !== undefined) assert.equal(entry.maxWeightGrams, desired.maxWeightGrams);
    }

    const liveMemberships = effective.entries.map((entry, index) => ({
      fishingBaseId: `base-${String(index)}`,
      baseName: entry.baseName,
      fishId: `fish-${String(index)}`,
      fishName: entry.canonicalFish,
      forumTopicId: entry.forumTopicId,
      minWeightGrams: entry.minWeightGrams,
      maxWeightGrams: entry.maxWeightGrams,
    }));
    const plan = buildBaseFishWeightMaterializationPlan({
      manifest: effective,
      manifestSha256: sha256(stableJson(effective)),
      liveMemberships,
      protectedState: {
        basesCount: 78,
        fishCount: 1_486,
        membershipsCount: 3_606,
        basesFingerprint: 'bases',
        fishFingerprint: 'fish',
        membershipIdentitiesFingerprint: 'memberships',
      },
      expectedTargetCount: 3_606,
    });
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.counts.plannedFieldChanges, 0);
    assert.equal(plan.counts.untargetedLiveMemberships, 0);
  });

  void it('rejects stale base provenance and changed previous values', () => {
    const baseFile = readJson('fishing-base-fish-weights.json');
    const patchFile = readJson('base-fish-max-weight-patch-20260909.json');
    const base = baseFile.value as BaseFishWeightApplyReadyManifest;
    const patch = decodeBaseFishMaxWeightPatch(patchFile.value);

    assert.throws(
      () => applyBaseFishMaxWeightPatch(base, patch, '0'.repeat(64)),
      /different base manifest/u,
    );
    const first = patch.entries[0];
    assert.ok(first !== undefined);
    const staleBase: BaseFishWeightApplyReadyManifest = {
      ...base,
      entries: base.entries.map((entry) =>
        entry.baseName === first.baseName && entry.forumTopicId === first.forumTopicId
          ? { ...entry, maxWeightGrams: first.maxWeightGrams + 1 }
          : entry,
      ),
    };
    assert.throws(
      () =>
        applyBaseFishMaxWeightPatch(staleBase, patch, ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256),
      /previous value changed/u,
    );
  });
});
