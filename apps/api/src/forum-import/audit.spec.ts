import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TechnicalForumPost } from './candidate-types.js';
import {
  buildForumImportAudit,
  buildForumReviewBundle,
  type ForumImportAuditInput,
} from './audit.js';
import type { ResolvedForumCandidate } from './catalog-resolver.js';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';
import { sha256Text } from './staging.js';

function post(postId: string, topicId: string): TechnicalForumPost {
  return {
    subforumId: '70',
    topicId,
    postId,
    memberId: 'PRIVATE MEMBER ID',
    topicTitle: 'PRIVATE TOPIC TITLE',
    bodyText: 'PRIVATE FORUM BODY',
  };
}

function candidate(
  postId: string,
  topicId: string,
  candidateOrdinal: number,
  overrides: Partial<ResolvedForumCandidate> = {},
): ResolvedForumCandidate {
  return {
    contributorKey: deriveExternalContributorKey('40'),
    importKey: deriveExternalImportKey(postId, candidateOrdinal),
    candidateOrdinal,
    fishNameRaw: 'Ёрш',
    weightGrams: 600,
    fishingBaseRaw: 'Волга',
    locationRaw: 'Омут',
    baitRaw: 'Червь',
    fishingMethod: 'BAIT_FISHING',
    holeDepthCm: 1_222,
    spotPositionRaw: 'ката',
    fishingNote: null,
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: null,
    resolution: {
      fish: { status: 'RESOLVED', reason: null, id: 'fish-id', name: 'Ёрш' },
      fishingBase: {
        status: 'RESOLVED',
        reason: null,
        id: 'base-id',
        name: 'Волга',
      },
      location: {
        status: 'RESOLVED',
        reason: null,
        id: 'location-id',
        name: 'Омут',
        number: 1,
      },
      bait: {
        status: 'RESOLVED',
        reason: null,
        id: 'bait-id',
        name: 'Черь',
        type: 'BAIT',
      },
      fishingBaseFish: { status: 'RESOLVED', reason: null },
    },
    status: 'USABLE_COMPLETE',
    issues: [],
    technical: {
      subforumId: '70',
      topicId,
      postId,
      sourceRange: { startOffset: 0, endOffset: 5, startLine: 1, endLine: 1 },
      sourceText: 'PRIVATE CANDIDATE SOURCE',
      supplementarySourceRanges: [],
    },
    ...overrides,
  };
}

function auditInput(
  posts: TechnicalForumPost[],
  candidates: ResolvedForumCandidate[],
): ForumImportAuditInput {
  return {
    scope: {
      mode: 'SUBFORUM',
      parentForumId: '69',
      requestedTopicId: null,
      requestedSubforumId: '70',
      eligibleSubforumIds: ['71', '70', '70'],
      scannedSubforumIds: ['70'],
      limitPosts: 100,
      truncated: true,
    },
    counters: {
      forumPagesDiscovered: 3,
      forumPagesScanned: 2,
      topicPagesDiscovered: 5,
      topicPagesScanned: 4,
      topicsDiscovered: 4,
      topicsScanned: 3,
      identityDrift: 1,
      scopeDriftDetected: 0,
      outOfScopeLinksRejected: 7,
      httpRetries: 2,
      http429Responses: 1,
      httpChallenges: 0,
      httpCacheHits: 8,
      httpCacheMisses: 3,
    },
    posts,
    candidates,
    catalogSnapshotFingerprint: 'a'.repeat(64),
    files: {
      'candidates.jsonl': '{"candidate":true}\n',
      'candidates.csv': 'header\r\n',
    },
  };
}

void describe('forum import audit and review outputs', () => {
  void it('counts candidates separately from post rollups and NO_CATCH_DATA', () => {
    const complete = candidate('100', '10', 1);
    const partial = candidate('100', '10', 2, {
      status: 'USABLE_PARTIAL',
      weightGrams: null,
      fishingMethod: 'SPINNING',
      holeDepthCm: null,
      spotPositionRaw: null,
      userNoteRaw: 'дальний заброс',
      issues: [{ code: 'MISSING_WEIGHT_GRAMS', field: 'weightGrams' }],
      resolution: {
        ...complete.resolution,
        bait: {
          status: 'RESOLVED',
          reason: null,
          id: 'lure-id',
          name: 'Блесна',
          type: 'LURE',
        },
      },
    });
    const unresolved = candidate('200', '20', 1, {
      contributorKey: deriveExternalContributorKey('41'),
      importKey: complete.importKey,
      status: 'UNRESOLVED',
      resolution: {
        ...complete.resolution,
        fish: { status: 'UNRESOLVED', reason: 'INACTIVE', id: 'fish-id', name: 'Ёрш' },
        fishingBaseFish: { status: 'MISSING', reason: 'MISSING_MEMBERSHIP' },
      },
      issues: [{ code: 'UNRESOLVED_FISH', field: 'fish' }],
    });
    const posts = [post('300', '30'), post('100', '10'), post('200', '20')];

    const audit = buildForumImportAudit(auditInput(posts, [unresolved, partial, complete]));

    assert.equal(audit.pagesDiscovered, 8);
    assert.equal(audit.pagesScanned, 6);
    assert.equal(audit.eligibleSubforumsDiscovered, 2);
    assert.deepEqual(audit.scope.eligibleSubforumIds, ['70', '71']);
    assert.equal(audit.postsScanned, 3);
    assert.equal(audit.candidatesExtracted, 3);
    assert.deepEqual(audit.candidateStatusCounts, {
      USABLE_COMPLETE: 1,
      USABLE_PARTIAL: 1,
      UNRESOLVED: 1,
    });
    assert.deepEqual(audit.postStatusCounts, {
      USABLE_COMPLETE: 0,
      USABLE_PARTIAL: 1,
      UNRESOLVED: 1,
      NO_CATCH_DATA: 1,
    });
    assert.equal(audit.catalogResolutionCounts.fish.UNRESOLVED, 1);
    assert.equal(audit.catalogResolutionCounts.fishingBaseFish.MISSING, 1);
    assert.deepEqual(audit.fishingMethodCounts, {
      BAIT_FISHING: 2,
      SPINNING: 1,
      UNRESOLVED: 0,
    });
    assert.equal(audit.withHoleDepthCm, 2);
    assert.equal(audit.withSpotPositionRaw, 2);
    assert.equal(audit.withUserNoteRaw, 1);
    assert.equal(audit.multiCandidatePosts, 1);
    assert.equal(audit.duplicateImportKeys, 1);
    assert.equal(audit.externalContributorCount, 2);
    assert.deepEqual(audit.http, {
      retries: 2,
      responses429: 1,
      challenges: 0,
      cacheHits: 8,
      cacheMisses: 3,
    });
    assert.deepEqual(audit.files, [
      { path: 'candidates.csv', sha256: sha256Text('header\r\n') },
      { path: 'candidates.jsonl', sha256: sha256Text('{"candidate":true}\n') },
    ]);
  });

  void it('does not copy post bodies, member IDs, titles, or candidate source text into audit', () => {
    const serialized = JSON.stringify(
      buildForumImportAudit(auditInput([post('100', '10')], [candidate('100', '10', 1)])),
    );

    for (const forbidden of [
      'PRIVATE MEMBER ID',
      'PRIVATE TOPIC TITLE',
      'PRIVATE FORUM BODY',
      'PRIVATE CANDIDATE SOURCE',
      'memberId',
      'bodyText',
      'sourceText',
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  void it('builds deterministic review sets for all unresolved and multi-candidate posts', () => {
    const complete = candidate('100', '10', 1);
    const second = candidate('100', '10', 2);
    const unresolved = candidate('200', '20', 1, {
      status: 'UNRESOLVED',
      issues: [{ code: 'UNRESOLVED_FISH', field: 'fish' }],
    });
    const posts = [post('300', '30'), post('200', '20'), post('100', '10')];

    const left = buildForumReviewBundle(posts, [unresolved, second, complete], {
      usable: 1,
      noCatchData: 1,
    });
    const right = buildForumReviewBundle([...posts].reverse(), [complete, second, unresolved], {
      usable: 1,
      noCatchData: 1,
    });

    assert.deepEqual(left, right);
    assert.equal(left.unresolved.length, 1);
    assert.equal(left.unresolved[0]?.importKey, unresolved.importKey);
    assert.deepEqual(left.multiCandidatePosts, [
      { subforumId: '70', topicId: '10', postId: '100' },
    ]);
    assert.equal(left.usableSample.length, 1);
    assert.deepEqual(left.noCatchDataSample, [{ subforumId: '70', topicId: '30', postId: '300' }]);
    assert.equal(JSON.stringify(left).includes('PRIVATE'), false);
  });
});
