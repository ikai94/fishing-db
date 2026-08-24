import { createHash } from 'node:crypto';
import type { TechnicalForumPost } from './candidate-types.js';
import type {
  CatalogResolutionStatus,
  ForumCandidateStatus,
  ForumStagingIssue,
  ResolvedForumCandidate,
} from './catalog-resolver.js';
import { compareResolvedCandidates, sha256Text } from './staging.js';

export interface ForumAuditScope {
  mode: 'TOPIC' | 'SUBFORUM' | 'ALL';
  parentForumId: '69';
  requestedTopicId: string | null;
  requestedSubforumId: string | null;
  eligibleSubforumIds: string[];
  scannedSubforumIds: string[];
  limitPosts: number | null;
  truncated: boolean;
}

export interface ForumCrawlCounters {
  forumPagesDiscovered: number;
  forumPagesScanned: number;
  topicPagesDiscovered: number;
  topicPagesScanned: number;
  topicsDiscovered: number;
  topicsScanned: number;
  identityDrift: number;
  scopeDriftDetected: number;
  outOfScopeLinksRejected: number;
  httpRetries: number;
  http429Responses: number;
  httpChallenges: number;
  httpCacheHits: number;
  httpCacheMisses: number;
}

export interface ResolutionCounts {
  RESOLVED: number;
  MISSING: number;
  UNRESOLVED: number;
}

export interface CandidateStatusCounts {
  USABLE_COMPLETE: number;
  USABLE_PARTIAL: number;
  UNRESOLVED: number;
}

export interface PostStatusCounts extends CandidateStatusCounts {
  NO_CATCH_DATA: number;
}

export interface ForumImportAudit {
  version: 1;
  scope: ForumAuditScope;
  pagesDiscovered: number;
  pagesScanned: number;
  forumPagesDiscovered: number;
  forumPagesScanned: number;
  topicPagesDiscovered: number;
  topicPagesScanned: number;
  eligibleSubforumsDiscovered: number;
  subforumsScanned: number;
  topicsDiscovered: number;
  topicsScanned: number;
  postsScanned: number;
  candidatesExtracted: number;
  candidateStatusCounts: CandidateStatusCounts;
  postStatusCounts: PostStatusCounts;
  catalogResolutionCounts: {
    fish: ResolutionCounts;
    fishingBase: ResolutionCounts;
    location: ResolutionCounts;
    bait: ResolutionCounts;
    fishingBaseFish: ResolutionCounts;
  };
  fishingMethodCounts: {
    BAIT_FISHING: number;
    SPINNING: number;
    UNRESOLVED: number;
  };
  withHoleDepthCm: number;
  withSpotPositionRaw: number;
  withUserNoteRaw: number;
  multiCandidatePosts: number;
  duplicateImportKeys: number;
  identityDrift: number;
  externalContributorCount: number;
  scopeDriftDetected: number;
  outOfScopeLinksRejected: number;
  http: {
    retries: number;
    responses429: number;
    challenges: number;
    cacheHits: number;
    cacheMisses: number;
  };
  catalogSnapshotFingerprint: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface ForumImportAuditInput {
  scope: ForumAuditScope;
  counters: ForumCrawlCounters;
  posts: readonly TechnicalForumPost[];
  candidates: readonly ResolvedForumCandidate[];
  catalogSnapshotFingerprint: string;
  files?: Readonly<Record<string, string>>;
}

export interface ReviewCandidateReference {
  subforumId: string;
  topicId: string;
  postId: string;
  candidateOrdinal: number;
  importKey: string;
  status: ForumCandidateStatus;
  issues: ForumStagingIssue[];
}

export interface ReviewPostReference {
  subforumId: string;
  topicId: string;
  postId: string;
}

export interface ForumReviewBundle {
  version: 1;
  unresolved: ReviewCandidateReference[];
  multiCandidatePosts: ReviewPostReference[];
  usableSample: ReviewCandidateReference[];
  noCatchDataSample: ReviewPostReference[];
}

function emptyResolutionCounts(): ResolutionCounts {
  return { RESOLVED: 0, MISSING: 0, UNRESOLVED: 0 };
}

function emptyCandidateStatusCounts(): CandidateStatusCounts {
  return { USABLE_COMPLETE: 0, USABLE_PARTIAL: 0, UNRESOLVED: 0 };
}

function emptyPostStatusCounts(): PostStatusCounts {
  return { ...emptyCandidateStatusCounts(), NO_CATCH_DATA: 0 };
}

function postKey(post: Pick<TechnicalForumPost, 'subforumId' | 'topicId' | 'postId'>): string {
  return `${post.subforumId}\0${post.topicId}\0${post.postId}`;
}

function candidatePostKey(candidate: ResolvedForumCandidate): string {
  return postKey(candidate.technical);
}

function compareNumericText(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareNumericText);
}

function comparePosts(left: ReviewPostReference, right: ReviewPostReference): number {
  return (
    compareNumericText(left.subforumId, right.subforumId) ||
    compareNumericText(left.topicId, right.topicId) ||
    compareNumericText(left.postId, right.postId)
  );
}

function uniquePosts(posts: readonly TechnicalForumPost[]): ReviewPostReference[] {
  const byKey = new Map<string, ReviewPostReference>();

  for (const post of posts) {
    byKey.set(postKey(post), {
      subforumId: post.subforumId,
      topicId: post.topicId,
      postId: post.postId,
    });
  }

  return [...byKey.values()].sort(comparePosts);
}

function countResolution(counts: ResolutionCounts, status: CatalogResolutionStatus): void {
  counts[status] += 1;
}

function postRollupStatus(candidates: readonly ResolvedForumCandidate[]): ForumCandidateStatus {
  if (candidates.some((candidate) => candidate.status === 'UNRESOLVED')) {
    return 'UNRESOLVED';
  }

  if (candidates.some((candidate) => candidate.status === 'USABLE_PARTIAL')) {
    return 'USABLE_PARTIAL';
  }

  return 'USABLE_COMPLETE';
}

function countDuplicateKeys(values: readonly string[]): number {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.values()].filter((count) => count > 1).length;
}

function hashFiles(
  files: Readonly<Record<string, string>>,
): Array<{ path: string; sha256: string }> {
  return Object.entries(files)
    .sort(([left], [right]) => compareText(left, right))
    .map(([path, contents]) => ({ path, sha256: sha256Text(contents) }));
}

export function buildForumImportAudit(input: ForumImportAuditInput): ForumImportAudit {
  const candidates = [...input.candidates].sort(compareResolvedCandidates);
  const posts = uniquePosts(input.posts);
  const candidateStatusCounts = emptyCandidateStatusCounts();
  const postStatusCounts = emptyPostStatusCounts();
  const fishCounts = emptyResolutionCounts();
  const fishingBaseCounts = emptyResolutionCounts();
  const locationCounts = emptyResolutionCounts();
  const baitCounts = emptyResolutionCounts();
  const membershipCounts = emptyResolutionCounts();
  const fishingMethodCounts = { BAIT_FISHING: 0, SPINNING: 0, UNRESOLVED: 0 };
  const candidatesByPost = new Map<string, ResolvedForumCandidate[]>();
  const eligibleSubforumIds = sortedUniqueIds(input.scope.eligibleSubforumIds);
  const scannedSubforumIds = sortedUniqueIds(input.scope.scannedSubforumIds);

  for (const candidate of candidates) {
    candidateStatusCounts[candidate.status] += 1;
    countResolution(fishCounts, candidate.resolution.fish.status);
    countResolution(fishingBaseCounts, candidate.resolution.fishingBase.status);
    countResolution(locationCounts, candidate.resolution.location.status);
    countResolution(baitCounts, candidate.resolution.bait.status);
    countResolution(membershipCounts, candidate.resolution.fishingBaseFish.status);

    if (candidate.fishingMethod === null) {
      fishingMethodCounts.UNRESOLVED += 1;
    } else {
      fishingMethodCounts[candidate.fishingMethod] += 1;
    }

    const key = candidatePostKey(candidate);
    const current = candidatesByPost.get(key) ?? [];
    current.push(candidate);
    candidatesByPost.set(key, current);
  }

  for (const post of posts) {
    const postCandidates = candidatesByPost.get(postKey(post));

    if (postCandidates === undefined || postCandidates.length === 0) {
      postStatusCounts.NO_CATCH_DATA += 1;
    } else {
      postStatusCounts[postRollupStatus(postCandidates)] += 1;
    }
  }

  return {
    version: 1,
    scope: {
      ...input.scope,
      eligibleSubforumIds,
      scannedSubforumIds,
    },
    pagesDiscovered: input.counters.forumPagesDiscovered + input.counters.topicPagesDiscovered,
    pagesScanned: input.counters.forumPagesScanned + input.counters.topicPagesScanned,
    forumPagesDiscovered: input.counters.forumPagesDiscovered,
    forumPagesScanned: input.counters.forumPagesScanned,
    topicPagesDiscovered: input.counters.topicPagesDiscovered,
    topicPagesScanned: input.counters.topicPagesScanned,
    eligibleSubforumsDiscovered: eligibleSubforumIds.length,
    subforumsScanned: scannedSubforumIds.length,
    topicsDiscovered: input.counters.topicsDiscovered,
    topicsScanned: input.counters.topicsScanned,
    postsScanned: posts.length,
    candidatesExtracted: candidates.length,
    candidateStatusCounts,
    postStatusCounts,
    catalogResolutionCounts: {
      fish: fishCounts,
      fishingBase: fishingBaseCounts,
      location: locationCounts,
      bait: baitCounts,
      fishingBaseFish: membershipCounts,
    },
    fishingMethodCounts,
    withHoleDepthCm: candidates.filter((candidate) => candidate.holeDepthCm !== null).length,
    withSpotPositionRaw: candidates.filter((candidate) => candidate.spotPositionRaw !== null)
      .length,
    withUserNoteRaw: candidates.filter((candidate) => candidate.userNoteRaw !== null).length,
    multiCandidatePosts: [...candidatesByPost.values()].filter(
      (postCandidates) => postCandidates.length > 1,
    ).length,
    duplicateImportKeys: countDuplicateKeys(candidates.map((candidate) => candidate.importKey)),
    identityDrift: input.counters.identityDrift,
    externalContributorCount: new Set(
      candidates.flatMap((candidate) =>
        candidate.contributorKey === null ? [] : [candidate.contributorKey],
      ),
    ).size,
    scopeDriftDetected: input.counters.scopeDriftDetected,
    outOfScopeLinksRejected: input.counters.outOfScopeLinksRejected,
    http: {
      retries: input.counters.httpRetries,
      responses429: input.counters.http429Responses,
      challenges: input.counters.httpChallenges,
      cacheHits: input.counters.httpCacheHits,
      cacheMisses: input.counters.httpCacheMisses,
    },
    catalogSnapshotFingerprint: input.catalogSnapshotFingerprint,
    files: hashFiles(input.files ?? {}),
  };
}

function candidateReference(candidate: ResolvedForumCandidate): ReviewCandidateReference {
  return {
    subforumId: candidate.technical.subforumId,
    topicId: candidate.technical.topicId,
    postId: candidate.technical.postId,
    candidateOrdinal: candidate.candidateOrdinal,
    importKey: candidate.importKey,
    status: candidate.status,
    issues: candidate.issues.map((issue) => ({ ...issue })),
  };
}

function deterministicSample<T>(
  values: readonly T[],
  limit: number,
  stableKey: (value: T) => string,
): T[] {
  return [...values]
    .sort((left, right) => {
      const leftKey = stableKey(left);
      const rightKey = stableKey(right);
      const leftHash = createHash('sha256').update(leftKey, 'utf8').digest('hex');
      const rightHash = createHash('sha256').update(rightKey, 'utf8').digest('hex');
      return compareText(leftHash, rightHash) || compareText(leftKey, rightKey);
    })
    .slice(0, limit);
}

export function buildForumReviewBundle(
  postsInput: readonly TechnicalForumPost[],
  candidatesInput: readonly ResolvedForumCandidate[],
  limits: { usable?: number; noCatchData?: number } = {},
): ForumReviewBundle {
  const candidates = [...candidatesInput].sort(compareResolvedCandidates);
  const posts = uniquePosts(postsInput);
  const candidatesByPost = new Map<string, ResolvedForumCandidate[]>();

  for (const candidate of candidates) {
    const key = candidatePostKey(candidate);
    const current = candidatesByPost.get(key) ?? [];
    current.push(candidate);
    candidatesByPost.set(key, current);
  }

  const multiCandidatePosts = posts.filter(
    (post) => (candidatesByPost.get(postKey(post))?.length ?? 0) > 1,
  );
  const noCatchData = posts.filter((post) => !candidatesByPost.has(postKey(post)));
  const usable = candidates.filter((candidate) => candidate.status !== 'UNRESOLVED');

  return {
    version: 1,
    unresolved: candidates
      .filter((candidate) => candidate.status === 'UNRESOLVED')
      .map(candidateReference),
    multiCandidatePosts,
    usableSample: deterministicSample(
      usable,
      limits.usable ?? 200,
      (candidate) => candidate.importKey,
    )
      .sort(compareResolvedCandidates)
      .map(candidateReference),
    noCatchDataSample: deterministicSample(noCatchData, limits.noCatchData ?? 100, (post) =>
      postKey(post),
    ).sort(comparePosts),
  };
}
