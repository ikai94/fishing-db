import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { normalizeAuditName, type ForumFishIdentity } from './fish-catalog-audit.js';
import {
  buildFishImageMaterializationPlan,
  type FishImageMaterializationInput,
  type FishImageReconciliationManifest,
  type LiveFishImageMetadataRow,
} from './fish-image-metadata-materialization.js';
import {
  validateFishImageMetadataManifest,
  type FishImageMetadataManifest,
  type OfficialFishEvidence,
} from './fish-image-metadata.js';

function forumFish(topicId: string, canonicalName: string): ForumFishIdentity {
  return {
    sourceIdentity: `rus-fishsoft:forum69:topic:${topicId}`,
    topicId,
    subforumId: '70',
    sourceTitle: canonicalName,
    canonicalName,
    canonicalNameNormalized: normalizeAuditName(canonicalName),
    aliases: [],
    mixedScriptTokens: [],
  };
}

function official(name: string, imageKey: number): OfficialFishEvidence {
  return {
    listTitle: name,
    detailTitle: name,
    detailPath: `/fish-${String(imageKey)}.html`,
    imageKey,
    middleImagePath: `/assets/images/fish/middle/${String(imageKey)}.png`,
    bigImagePath: `/assets/images/fish/big/${String(imageKey)}.png`,
  };
}

function smallInput(): FishImageMaterializationInput {
  const forum = [forumFish('1', 'Сом'), forumFish('2', 'Карп')];
  const imageManifest = {
    entries: [
      {
        forumTopicId: '1',
        canonicalName: 'Сом',
        status: 'EXACT',
        matchRule: 'CANONICAL_EXACT',
        matchedName: 'Сом',
        official: official('Сом', 101),
        candidates: [],
      },
      {
        forumTopicId: '2',
        canonicalName: 'Карп',
        status: 'MISSING',
        matchRule: 'NO_OFFICIAL_CANDIDATE',
        matchedName: null,
        official: null,
        candidates: [],
      },
    ],
  } as unknown as FishImageMetadataManifest;
  const reconciliationManifest: FishImageReconciliationManifest = {
    schemaVersion: 1,
    mode: 'APPLY_READY',
    entries: [
      {
        category: 'EXACT_CANONICAL',
        currentFishId: 'fish-1',
        currentName: 'Сом',
        currentIsActive: true,
        topicId: '1',
        canonicalName: 'Сом',
        preservesFishId: true,
        decision: 'KEEP',
        reason: 'test',
      },
      {
        category: 'MISSING_CREATE',
        currentFishId: null,
        currentName: null,
        currentIsActive: null,
        topicId: '2',
        canonicalName: 'Карп',
        preservesFishId: false,
        decision: 'CREATE',
        reason: 'test',
      },
      {
        category: 'LOCAL_EXTRA',
        currentFishId: 'fish-extra',
        currentName: 'Учебная рыба',
        currentIsActive: true,
        topicId: null,
        canonicalName: null,
        preservesFishId: true,
        decision: 'KEEP_EXTRA',
        reason: 'test',
      },
    ],
  };
  const liveFish: LiveFishImageMetadataRow[] = [
    {
      id: 'fish-1',
      name: 'Сом',
      nameNormalized: 'сом',
      isActive: true,
      forumTopicId: null,
      officialFishImageKey: null,
    },
    {
      id: 'fish-2',
      name: 'Карп',
      nameNormalized: 'карп',
      isActive: true,
      forumTopicId: null,
      officialFishImageKey: null,
    },
    {
      id: 'fish-extra',
      name: 'Учебная рыба',
      nameNormalized: 'учебная рыба',
      isActive: true,
      forumTopicId: null,
      officialFishImageKey: null,
    },
  ];
  return {
    sources: {
      fishImageManifestSha256: 'image-hash',
      fishReconciliationManifestSha256: 'reconciliation-hash',
      forumManifestSha256: 'forum-hash',
    },
    imageManifest,
    reconciliationManifest,
    forumFish: forum,
    liveFish,
    protectedState: {
      fishFingerprint: 'fish-fingerprint',
      fishingBaseFishFingerprint: 'membership-fingerprint',
      catchReportsFingerprint: 'report-fingerprint',
      fishingBaseFishCount: 4,
      catchReportsCount: 8,
    },
    expectedCounts: {
      fish: 3,
      owners: 2,
      withOfficialFishImageKey: 1,
      canonicalWithoutOfficialFishImageKey: 1,
      nonOwners: 1,
    },
  };
}

void describe('Fish image metadata materialization plan', () => {
  void it('plans only nullable metadata writes and is idempotent after the target is present', () => {
    const input = smallInput();
    const plan = buildFishImageMaterializationPlan(input);

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.counts, {
      fish: 3,
      owners: 2,
      withForumTopicId: { before: 0, after: 2 },
      withOfficialFishImageKey: { before: 0, after: 1 },
      canonicalWithoutOfficialFishImageKey: 1,
      nonOwnerFishWithNullMetadata: 1,
      writes: 2,
    });
    assert.deepEqual(
      plan.changes.map((change) => ({ fishId: change.fishId, after: change.after })),
      [
        {
          fishId: 'fish-1',
          after: { forumTopicId: '1', officialFishImageKey: 101 },
        },
        {
          fishId: 'fish-2',
          after: { forumTopicId: '2', officialFishImageKey: null },
        },
      ],
    );
    assert.equal(plan.preservation.fishIdsNamesIsActiveUnchanged, true);
    assert.equal(plan.preservation.fishingBaseFishUnchanged, true);
    assert.equal(plan.preservation.catchReportsUnchanged, true);
    assert.match(plan.planFingerprint, /^[a-f0-9]{64}$/u);

    const appliedFish = input.liveFish.map((fish) => {
      const change = plan.changes.find((candidate) => candidate.fishId === fish.id);
      return change === undefined ? fish : { ...fish, ...change.after };
    });
    const secondPass = buildFishImageMaterializationPlan({ ...input, liveFish: appliedFish });
    assert.deepEqual(secondPass.blockers, []);
    assert.equal(secondPass.counts.writes, 0);
    assert.deepEqual(secondPass.changes, []);
  });

  void it('blocks reassignment and metadata on non-owner Fish', () => {
    const input = smallInput();
    input.liveFish[0] = {
      ...input.liveFish[0],
      forumTopicId: 'different-topic',
      officialFishImageKey: 999,
    };
    input.liveFish[2] = { ...input.liveFish[2], forumTopicId: 'extra-topic' };

    const plan = buildFishImageMaterializationPlan(input);
    assert.ok(plan.blockers.some((blocker) => /different forum topic ID/u.test(blocker)));
    assert.ok(plan.blockers.some((blocker) => /non-owner Fish/u.test(blocker)));
  });

  void it('projects the accepted tracked manifests to the exact approved poststate', () => {
    const catalogData = new URL('../../prisma/catalog-data/', import.meta.url);
    const forumManifest = JSON.parse(
      readFileSync(new URL('forum69-fish.json', catalogData), 'utf8'),
    ) as { fish: ForumFishIdentity[] };
    const reconciliationManifest = JSON.parse(
      readFileSync(new URL('fish-reconciliation.json', catalogData), 'utf8'),
    ) as FishImageReconciliationManifest;
    const imageManifest = validateFishImageMetadataManifest(
      JSON.parse(readFileSync(new URL('fish-image-metadata.json', catalogData), 'utf8')) as unknown,
      forumManifest.fish,
    );
    const liveById = new Map<string, LiveFishImageMetadataRow>();

    for (const entry of reconciliationManifest.entries) {
      if (entry.topicId === null || entry.category === 'REPOINT_DEACTIVATE') continue;
      assert.ok(entry.canonicalName);
      const id = entry.currentFishId ?? `created:forum69:${entry.topicId}`;
      liveById.set(id, {
        id,
        name: entry.canonicalName,
        nameNormalized: normalizeAuditName(entry.canonicalName),
        isActive: entry.targetIsActive ?? entry.currentIsActive ?? true,
        forumTopicId: null,
        officialFishImageKey: null,
      });
    }
    for (const entry of reconciliationManifest.entries) {
      if (entry.currentFishId === null || liveById.has(entry.currentFishId)) continue;
      assert.ok(entry.currentName);
      liveById.set(entry.currentFishId, {
        id: entry.currentFishId,
        name: entry.currentName,
        nameNormalized: normalizeAuditName(entry.currentName),
        isActive: entry.targetIsActive ?? entry.currentIsActive ?? true,
        forumTopicId: null,
        officialFishImageKey: null,
      });
    }

    const plan = buildFishImageMaterializationPlan({
      sources: {
        fishImageManifestSha256: 'image-hash',
        fishReconciliationManifestSha256: 'reconciliation-hash',
        forumManifestSha256: 'forum-hash',
      },
      imageManifest,
      reconciliationManifest,
      forumFish: forumManifest.fish,
      liveFish: [...liveById.values()],
      protectedState: {
        fishFingerprint: 'fish-fingerprint',
        fishingBaseFishFingerprint: 'membership-fingerprint',
        catchReportsFingerprint: 'report-fingerprint',
        fishingBaseFishCount: 3_596,
        catchReportsCount: 31_337,
      },
    });

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.counts, {
      fish: 1_486,
      owners: 1_479,
      withForumTopicId: { before: 0, after: 1_479 },
      withOfficialFishImageKey: { before: 0, after: 1_463 },
      canonicalWithoutOfficialFishImageKey: 16,
      nonOwnerFishWithNullMetadata: 7,
      writes: 1_479,
    });
  });
});
