import type { ParsedForumCandidate, TechnicalForumPost } from './candidate-types.js';
import { sha256Hex } from './cache.js';
import { compareCanonicalIds } from './scope.js';

export interface CandidateIdentityBoundary {
  candidateOrdinal: number;
  importKey: string;
  startOffset: number;
  endOffset: number;
  sourceTextSha256: string;
}

export interface PostCandidateIdentity {
  subforumId: string;
  topicId: string;
  postId: string;
  bodySha256: string;
  candidates: CandidateIdentityBoundary[];
}

export interface CandidateIdentityManifest {
  version: 1;
  scopeKey: string;
  posts: PostCandidateIdentity[];
}

export interface CandidateIdentityStability {
  appendedCandidateCount: number;
  appendedPostIds: string[];
}

export interface CandidateIdentityRebasePost {
  postId: string;
  previousCandidates: CandidateIdentityBoundary[];
  currentCandidates: CandidateIdentityBoundary[];
}

export interface CandidateIdentityRebase {
  version: 1;
  scopeKey: string;
  reason: 'EXPLICIT_PRE_IMPORT_REBASE';
  importedCatchReports: 0;
  importSafetyCheck: 'IMPORT_KEY_COLUMN_ABSENT' | 'IMPORT_KEY_PREFIX_COUNT';
  previousManifestSha256: string;
  currentManifestSha256: string;
  previousCandidateCount: number;
  currentCandidateCount: number;
  changedPosts: CandidateIdentityRebasePost[];
}

export class CandidateIdentityDriftError extends Error {
  readonly code = 'IDENTITY_DRIFT';

  constructor(readonly changedPostIds: string[]) {
    super(`Candidate boundaries changed for post(s): ${changedPostIds.join(', ')}`);
    this.name = 'CandidateIdentityDriftError';
  }
}

export class CandidateIdentityRebaseError extends Error {
  readonly code = 'IDENTITY_REBASE_FORBIDDEN';

  constructor(message: string) {
    super(message);
    this.name = 'CandidateIdentityRebaseError';
  }
}

function comparePosts(
  left: Pick<PostCandidateIdentity, 'subforumId' | 'topicId' | 'postId'>,
  right: Pick<PostCandidateIdentity, 'subforumId' | 'topicId' | 'postId'>,
): number {
  return (
    compareCanonicalIds(left.subforumId, right.subforumId) ||
    compareCanonicalIds(left.topicId, right.topicId) ||
    compareCanonicalIds(left.postId, right.postId)
  );
}

export function buildCandidateIdentityManifest(
  scopeKey: string,
  posts: readonly TechnicalForumPost[],
  candidates: readonly ParsedForumCandidate[],
): CandidateIdentityManifest {
  const candidatesByPost = new Map<string, ParsedForumCandidate[]>();
  for (const candidate of candidates) {
    const current = candidatesByPost.get(candidate.technical.postId) ?? [];
    current.push(candidate);
    candidatesByPost.set(candidate.technical.postId, current);
  }

  const records = posts.map((post): PostCandidateIdentity => ({
    subforumId: post.subforumId,
    topicId: post.topicId,
    postId: post.postId,
    bodySha256: sha256Hex(post.bodyText),
    candidates: [...(candidatesByPost.get(post.postId) ?? [])]
      .sort((left, right) => left.candidateOrdinal - right.candidateOrdinal)
      .map((candidate) => ({
        candidateOrdinal: candidate.candidateOrdinal,
        importKey: candidate.importKey,
        startOffset: candidate.technical.sourceRange.startOffset,
        endOffset: candidate.technical.sourceRange.endOffset,
        sourceTextSha256: sha256Hex(candidate.technical.sourceText),
      })),
  }));

  return { version: 1, scopeKey, posts: records.sort(comparePosts) };
}

export function assertCandidateIdentityStable(
  pinned: CandidateIdentityManifest,
  current: CandidateIdentityManifest,
): CandidateIdentityStability {
  if (pinned.version !== 1 || pinned.scopeKey !== current.scopeKey || current.version !== 1) {
    throw new CandidateIdentityDriftError(
      current.posts.map((post) => post.postId).sort(compareCanonicalIds),
    );
  }

  const currentByPost = new Map(current.posts.map((post) => [post.postId, post]));
  const changedPostIds: string[] = [];
  const appendedPostIds: string[] = [];
  let appendedCandidateCount = 0;

  for (const previous of pinned.posts) {
    const next = currentByPost.get(previous.postId);
    const previousCandidateJson = previous.candidates.map((candidate) => JSON.stringify(candidate));
    const nextCandidateJson = new Set(
      next?.candidates.map((candidate) => JSON.stringify(candidate)),
    );
    const maximumPreviousOrdinal = previous.candidates.at(-1)?.candidateOrdinal ?? 0;
    const appended =
      next?.candidates.filter((candidate) => candidate.candidateOrdinal > maximumPreviousOrdinal) ??
      [];

    if (
      next === undefined ||
      previous.subforumId !== next.subforumId ||
      previous.topicId !== next.topicId ||
      previous.bodySha256 !== next.bodySha256 ||
      previousCandidateJson.some((candidate) => !nextCandidateJson.has(candidate)) ||
      next.candidates.some(
        (candidate) =>
          candidate.candidateOrdinal <= maximumPreviousOrdinal &&
          !previousCandidateJson.includes(JSON.stringify(candidate)),
      )
    ) {
      changedPostIds.push(previous.postId);
      continue;
    }

    if (appended.length > 0) {
      appendedCandidateCount += appended.length;
      appendedPostIds.push(previous.postId);
    }
  }

  if (changedPostIds.length > 0) {
    throw new CandidateIdentityDriftError(changedPostIds.sort(compareCanonicalIds));
  }

  const pinnedPostIds = new Set(pinned.posts.map((post) => post.postId));
  for (const post of current.posts) {
    if (pinnedPostIds.has(post.postId) || post.candidates.length === 0) continue;
    appendedCandidateCount += post.candidates.length;
    appendedPostIds.push(post.postId);
  }

  return {
    appendedCandidateCount,
    appendedPostIds: [...new Set(appendedPostIds)].sort(compareCanonicalIds),
  };
}

function candidateCount(manifest: CandidateIdentityManifest): number {
  return manifest.posts.reduce((total, post) => total + post.candidates.length, 0);
}

export function buildPreImportCandidateIdentityRebase(
  pinned: CandidateIdentityManifest,
  current: CandidateIdentityManifest,
  importedCatchReports: number,
  importSafetyCheck: CandidateIdentityRebase['importSafetyCheck'],
): CandidateIdentityRebase {
  if (!Number.isSafeInteger(importedCatchReports) || importedCatchReports < 0) {
    throw new CandidateIdentityRebaseError('Imported CatchReport count is invalid');
  }
  if (importedCatchReports !== 0) {
    throw new CandidateIdentityRebaseError(
      `Cannot rebase after ${importedCatchReports} rus-fishsoft CatchReport import(s)`,
    );
  }
  if (pinned.version !== 1 || current.version !== 1 || pinned.scopeKey !== current.scopeKey) {
    throw new CandidateIdentityRebaseError('Candidate identity scope or version changed');
  }

  const currentByPost = new Map(current.posts.map((post) => [post.postId, post]));
  const changedPosts: CandidateIdentityRebasePost[] = [];

  for (const previous of pinned.posts) {
    const next = currentByPost.get(previous.postId);
    if (
      next === undefined ||
      previous.subforumId !== next.subforumId ||
      previous.topicId !== next.topicId ||
      previous.bodySha256 !== next.bodySha256
    ) {
      throw new CandidateIdentityRebaseError(
        `Cannot rebase changed or missing source post ${previous.postId}`,
      );
    }
    if (JSON.stringify(previous.candidates) !== JSON.stringify(next.candidates)) {
      changedPosts.push({
        postId: previous.postId,
        previousCandidates: previous.candidates,
        currentCandidates: next.candidates,
      });
    }
  }

  if (changedPosts.length === 0) {
    throw new CandidateIdentityRebaseError('Candidate identities have no parser drift to rebase');
  }

  return {
    version: 1,
    scopeKey: current.scopeKey,
    reason: 'EXPLICIT_PRE_IMPORT_REBASE',
    importedCatchReports: 0,
    importSafetyCheck,
    previousManifestSha256: sha256Hex(JSON.stringify(pinned)),
    currentManifestSha256: sha256Hex(JSON.stringify(current)),
    previousCandidateCount: candidateCount(pinned),
    currentCandidateCount: candidateCount(current),
    changedPosts,
  };
}
