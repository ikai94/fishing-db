import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildForumFishCorpus, stableJson } from './fish-catalog-audit.js';
import {
  buildFishCatalogApplyDryRun,
  type FishCatalogDryRunInput,
} from './dry-run-fish-catalog-reconciliation.js';

function fixture(): FishCatalogDryRunInput {
  const forumFish = buildForumFishCorpus([
    { topicId: '1', subforumId: '70', topicTitle: 'Клюворыл' },
    { topicId: '2', subforumId: '70', topicTitle: 'Новая рыба' },
  ]);
  return {
    liveFingerprint: 'a'.repeat(64),
    fishManifestHash: 'b'.repeat(64),
    workbookManifestHash: 'c'.repeat(64),
    forumManifestHash: 'd'.repeat(64),
    listFishManifestHash: 'e'.repeat(64),
    fishManifest: {
      schemaVersion: 2,
      mode: 'APPLY_READY',
      sourceCatalogFingerprint: 'a'.repeat(64),
      entries: [
        {
          category: 'EXACT_CANONICAL',
          currentFishId: 'fish-1',
          currentName: 'Клюворыл',
          currentIsActive: true,
          topicId: '1',
          canonicalName: 'Клюворыл',
          preservesFishId: true,
          decision: 'KEEP',
          reason: 'test',
        },
        {
          category: 'REPOINT_DEACTIVATE',
          currentFishId: 'fish-legacy',
          currentName: 'Клюварыл',
          currentIsActive: true,
          topicId: '1',
          canonicalName: 'Клюворыл',
          preservesFishId: true,
          decision: 'REPOINT+DEACTIVATE',
          targetIsActive: false,
          repointTargetFishId: 'fish-1',
          reason: 'test',
        },
        {
          category: 'MISSING_CREATE',
          currentFishId: null,
          currentName: null,
          currentIsActive: null,
          topicId: '2',
          canonicalName: 'Новая рыба',
          preservesFishId: false,
          decision: 'CREATE',
          reason: 'test',
        },
      ],
    },
    workbookManifest: {
      schemaVersion: 2,
      mode: 'APPLY_READY',
      projectedMemberships: 1,
      rows: [
        {
          baseName: 'База',
          sourceSheet: 'База',
          sourceCell: 'A1',
          rawName: 'Клюворыл',
          lookupName: 'Клюворыл',
          annotationStripped: false,
          category: 'CANONICAL_EXACT',
          topicId: '1',
          canonicalName: 'Клюворыл',
        },
        {
          baseName: 'База',
          sourceSheet: 'База',
          sourceCell: 'A2',
          rawName: 'Губка',
          lookupName: 'Губка',
          annotationStripped: false,
          category: 'DO_NOT_MAP',
          topicId: null,
          canonicalName: null,
        },
      ],
    },
    forumFish,
    liveFish: [
      { id: 'fish-1', name: 'Клюворыл', nameNormalized: 'клюворыл', isActive: true },
      {
        id: 'fish-legacy',
        name: 'Клюварыл',
        nameNormalized: 'клюварыл',
        isActive: true,
      },
    ],
    liveBases: [{ id: 'base-1', name: 'База' }],
    liveMemberships: [{ fishingBaseId: 'base-1', fishId: 'fish-legacy' }],
    liveReports: [{ id: 'report-1', fishId: 'fish-legacy' }],
  };
}

void describe('Fish catalog apply dry-run', () => {
  void it('projects explicit repoints, terminal exclusions and an idempotent poststate', () => {
    const result = buildFishCatalogApplyDryRun(fixture());

    assert.deepEqual(result.guards.blockers, []);
    assert.equal(result.fish.creates, 1);
    assert.equal(result.fish.deactivations, 1);
    assert.equal(result.fish.repoints, 1);
    assert.deepEqual(result.baseFish, { before: 1, keep: 0, add: 1, remove: 1, after: 1 });
    assert.equal(result.catchReports.repointed, 1);
    assert.equal(result.guards.doNotMapRows, 1);
    assert.equal(result.guards.doNotMapMembershipsCreated, 0);
    assert.equal(result.guards.idempotencySecondPassWrites, 0);
  });

  void it('is deterministic and blocks a stale catalog fingerprint', () => {
    const input = fixture();
    assert.equal(
      stableJson(buildFishCatalogApplyDryRun(input)),
      stableJson(buildFishCatalogApplyDryRun(input)),
    );

    input.liveFingerprint = 'f'.repeat(64);
    const stale = buildFishCatalogApplyDryRun(input);
    assert.equal(stale.guards.liveCatalogFingerprintMatches, false);
    assert.match(stale.guards.blockers.join('\n'), /differs from reviewed source/u);
  });

  void it('recognizes the materialized poststate as a zero-write second pass', () => {
    const input = fixture();
    const approvedProjection = buildFishCatalogApplyDryRun(input);
    input.liveFingerprint = 'f'.repeat(64);
    input.liveFish = [
      { id: 'fish-1', name: 'Клюворыл', nameNormalized: 'клюворыл', isActive: true },
      {
        id: 'fish-legacy',
        name: 'Клюварыл',
        nameNormalized: 'клюварыл',
        isActive: false,
      },
      { id: 'fish-2', name: 'Новая рыба', nameNormalized: 'новая рыба', isActive: true },
    ];
    input.liveMemberships = [{ fishingBaseId: 'base-1', fishId: 'fish-1' }];
    input.liveReports = [{ id: 'report-1', fishId: 'fish-1' }];

    const poststate = buildFishCatalogApplyDryRun(input);

    assert.deepEqual(poststate.guards.blockers, []);
    assert.equal(poststate.guards.recognizedPoststate, true);
    assert.equal(poststate.fish.renames, 0);
    assert.equal(poststate.fish.creates, 0);
    assert.equal(poststate.fish.deactivations, 0);
    assert.equal(poststate.fish.repoints, 0);
    assert.equal(poststate.baseFish.add, 0);
    assert.equal(poststate.baseFish.remove, 0);
    assert.equal(poststate.catchReports.repointed, 0);
    assert.equal(
      poststate.guards.poststateFingerprint,
      approvedProjection.guards.poststateFingerprint,
    );
  });
});
