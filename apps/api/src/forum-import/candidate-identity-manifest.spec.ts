import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TechnicalForumPost } from './candidate-types.js';
import {
  assertCandidateIdentityStable,
  buildPreImportCandidateIdentityRebase,
  buildCandidateIdentityManifest,
  CandidateIdentityDriftError,
  CandidateIdentityRebaseError,
} from './candidate-identity-manifest.js';
import { parseForumPost } from './forum-post-parser.js';

const POST: TechnicalForumPost = {
  subforumId: '70',
  topicId: '700',
  postId: '9000',
  memberId: '42',
  topicTitle: 'Белорыбица',
  bodyText: 'Белорыбица 1,2 кг. Поймана на Амур: Протока, Мотыль. 12,22 уда',
};

void describe('candidate identity manifest', () => {
  void it('pins posts with and without candidates in deterministic order', () => {
    const empty = { ...POST, postId: '8999', bodyText: 'Всем удачи!' };
    const manifest = buildCandidateIdentityManifest(
      'subforum-70',
      [POST, empty],
      parseForumPost(POST),
    );

    assert.deepEqual(
      manifest.posts.map((post) => [post.postId, post.candidates.length]),
      [
        ['8999', 0],
        ['9000', 1],
      ],
    );
  });

  void it('accepts the same boundaries and rejects parser/order drift', () => {
    const pinned = buildCandidateIdentityManifest('subforum-70', [POST], parseForumPost(POST));
    assert.doesNotThrow(() => assertCandidateIdentityStable(pinned, pinned));

    const changedPost = { ...POST, bodyText: `${POST.bodyText}\n${POST.bodyText}` };
    const current = buildCandidateIdentityManifest(
      'subforum-70',
      [changedPost],
      parseForumPost(changedPost),
    );
    assert.throws(
      () => assertCandidateIdentityStable(pinned, current),
      (error: unknown) =>
        error instanceof CandidateIdentityDriftError && error.changedPostIds[0] === '9000',
    );
  });

  void it('keeps identity stable when only parsed fields improve inside pinned boundaries', () => {
    const parsed = parseForumPost(POST);
    const pinned = buildCandidateIdentityManifest('subforum-70', [POST], parsed);
    const refined = parsed.map((candidate) => ({
      ...candidate,
      holeDepthCm: 3_363,
      spotPositionRaw: 'еда-алк',
      userNoteRaw: 'донка',
    }));
    const current = buildCandidateIdentityManifest('subforum-70', [POST], refined);

    assert.doesNotThrow(() => assertCandidateIdentityStable(pinned, current));
    assert.deepEqual(current, pinned);
  });

  void it('allows append-only new posts but rejects removal of a pinned post', () => {
    const pinned = buildCandidateIdentityManifest('subforum-70', [POST], parseForumPost(POST));
    const added = { ...POST, postId: '9001' };
    const current = buildCandidateIdentityManifest(
      'subforum-70',
      [POST, added],
      [...parseForumPost(POST), ...parseForumPost(added)],
    );

    assert.doesNotThrow(() => assertCandidateIdentityStable(pinned, current));
    assert.throws(
      () => assertCandidateIdentityStable(current, pinned),
      (error: unknown) =>
        error instanceof CandidateIdentityDriftError && error.changedPostIds[0] === '9001',
    );
  });

  void it('allows only higher-ordinal candidates to be appended within a pinned source post', () => {
    const source = {
      ...POST,
      bodyText: `${POST.bodyText}\n\nБелорыбица 800 г.\nПоймана на Амур: Протока, Мотыль.`,
    };
    const parsed = parseForumPost(source);
    const current = buildCandidateIdentityManifest('subforum-70', [source], parsed);
    const pinned = structuredClone(current);
    const pinnedPost = pinned.posts[0];
    assert.ok(pinnedPost);
    pinnedPost.candidates = pinnedPost.candidates.slice(0, 1);

    const stability = assertCandidateIdentityStable(pinned, current);
    assert.deepEqual(stability, { appendedCandidateCount: 1, appendedPostIds: ['9000'] });

    const renumbered = structuredClone(current);
    const appended = renumbered.posts[0]?.candidates[1];
    assert.ok(appended);
    appended.candidateOrdinal = 1;
    assert.throws(
      () => assertCandidateIdentityStable(pinned, renumbered),
      CandidateIdentityDriftError,
    );
  });

  void it('builds an explicit deterministic rebase only for parser boundaries before import', () => {
    const pinned = buildCandidateIdentityManifest('subforum-70', [POST], parseForumPost(POST));
    const current = structuredClone(pinned);
    const boundary = current.posts[0]?.candidates[0];
    assert.ok(boundary);
    boundary.endOffset -= 1;
    boundary.sourceTextSha256 = 'refined-boundary';

    assert.throws(
      () => assertCandidateIdentityStable(pinned, current),
      CandidateIdentityDriftError,
    );
    const rebase = buildPreImportCandidateIdentityRebase(
      pinned,
      current,
      0,
      'IMPORT_KEY_PREFIX_COUNT',
    );

    assert.equal(rebase.reason, 'EXPLICIT_PRE_IMPORT_REBASE');
    assert.equal(rebase.importedCatchReports, 0);
    assert.equal(rebase.importSafetyCheck, 'IMPORT_KEY_PREFIX_COUNT');
    assert.equal(rebase.previousCandidateCount, 1);
    assert.equal(rebase.currentCandidateCount, 1);
    assert.deepEqual(
      rebase.changedPosts.map((post) => post.postId),
      ['9000'],
    );
    assert.equal(rebase.previousManifestSha256.length, 64);
    assert.equal(rebase.currentManifestSha256.length, 64);
  });

  void it('forbids a rebase after import or when pinned source content changed', () => {
    const pinned = buildCandidateIdentityManifest('subforum-70', [POST], parseForumPost(POST));
    const boundaryDrift = structuredClone(pinned);
    const boundary = boundaryDrift.posts[0]?.candidates[0];
    assert.ok(boundary);
    boundary.startOffset += 1;

    assert.throws(
      () =>
        buildPreImportCandidateIdentityRebase(pinned, boundaryDrift, 1, 'IMPORT_KEY_PREFIX_COUNT'),
      CandidateIdentityRebaseError,
    );

    const sourceDrift = structuredClone(boundaryDrift);
    const changedPost = sourceDrift.posts[0];
    assert.ok(changedPost);
    changedPost.bodySha256 = 'changed-source';
    assert.throws(
      () =>
        buildPreImportCandidateIdentityRebase(pinned, sourceDrift, 0, 'IMPORT_KEY_PREFIX_COUNT'),
      CandidateIdentityRebaseError,
    );
  });
});
