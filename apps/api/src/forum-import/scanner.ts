import { join } from 'node:path';
import type { TechnicalForumPost } from './candidate-types.js';
import { ForumLocalStore, readJsonFile, sha256Hex, writeJsonAtomic } from './cache.js';
import {
  assertNoScopeDrift,
  completeQueueItem,
  createCheckpoint,
  enqueue,
  loadCheckpoint,
  saveCheckpoint,
  type ScanCheckpoint,
  type ScanQueueItem,
} from './checkpoint.js';
import type { ForumHtmlResponse, ForumHttpCounters } from './http-client.js';
import {
  extractEligibleChildForums,
  extractForumPage,
  extractTopicPage,
  type ForumReference,
} from './invision-html.js';
import {
  compareCanonicalIds,
  getScopeKey,
  PARENT_FORUM_ID,
  SOURCE_ORIGIN,
  type ScanScope,
} from './scope.js';

export interface ForumScannerHttpClient {
  getHtml(url: string): Promise<ForumHtmlResponse>;
  counters: ForumHttpCounters;
}

export interface TechnicalPostRecord extends TechnicalForumPost {
  version: 1;
  bodySha256: string;
  sourceSha256: string;
}

export interface TechnicalScanManifest {
  version: 1;
  scope: ScanScope;
  scopeKey: string;
  parentForumId: typeof PARENT_FORUM_ID;
  discoveryFingerprint: string;
  eligibleSubforumIds: string[];
  scannedSubforumIds: string[];
  topicIds: string[];
  postIds: string[];
  sourceChangedPostIds: string[];
  discoveredPageUrls: string[];
  completedPageUrls: string[];
  complete: boolean;
  truncated: boolean;
  http: ForumHttpCounters;
}

export class ForumScannerError extends Error {
  constructor(
    readonly code: 'IDENTITY_DRIFT' | 'SCOPE_NOT_ELIGIBLE' | 'TOPIC_OUT_OF_SCOPE',
    message: string,
  ) {
    super(message);
    this.name = 'ForumScannerError';
  }
}

const parentForumUrl = forumUrl(PARENT_FORUM_ID);

export function forumUrl(forumId: string): string {
  return new URL(`/forum/index.php?/forum/${forumId}/`, SOURCE_ORIGIN).href;
}

export function topicUrl(topicId: string): string {
  return new URL(`/forum/index.php?/topic/${topicId}/`, SOURCE_ORIGIN).href;
}

export async function scanForum(
  scope: ScanScope,
  http: ForumScannerHttpClient,
  store: ForumLocalStore,
): Promise<TechnicalScanManifest> {
  const scopeKey = getScopeKey(scope);
  const scanManifestPath = join(store.outputDirectory(scopeKey), 'technical', 'scan.json');
  const checkpointPath = store.checkpointPath(scopeKey);
  let checkpoint: ScanCheckpoint | null = null;
  await writeJsonAtomic(scanManifestPath, incompleteManifest(scope, http.counters));

  try {
    const parentResponse = await http.getHtml(parentForumUrl);
    const parent = extractEligibleChildForums(parentResponse.body, parentResponse.finalUrl);
    const eligibleSubforums = parent.childForums;
    const eligibleSubforumIds = eligibleSubforums.map((child) => child.forumId);
    const discoveryFingerprint = fingerprintDiscovery(eligibleSubforums);
    const previousCheckpoint = await loadCheckpoint(checkpointPath, scope);

    if (previousCheckpoint !== null && !previousCheckpoint.complete) {
      assertNoScopeDrift(previousCheckpoint, discoveryFingerprint, eligibleSubforumIds);
      checkpoint = previousCheckpoint;
    } else {
      checkpoint = createCheckpoint(
        scope,
        discoveryFingerprint,
        eligibleSubforumIds,
        initialQueue(scope, eligibleSubforums),
      );
      await saveCheckpoint(checkpointPath, checkpoint);
    }

    while (checkpoint.pending.length > 0 && !checkpoint.truncated) {
      const item = checkpoint.pending[0];
      if (item === undefined) break;
      const response = await http.getHtml(item.url);

      if (item.kind === 'SUBFORUM_PAGE') {
        processSubforumPage(checkpoint, item, response);
      } else {
        await processTopicPage(checkpoint, item, response, scope, store);
      }

      completeQueueItem(checkpoint, item);
      await saveCheckpoint(checkpointPath, checkpoint);
    }

    checkpoint.complete = checkpoint.pending.length === 0;
    await saveCheckpoint(checkpointPath, checkpoint);
    const manifest = buildManifest(scope, checkpoint, http.counters);
    await writeJsonAtomic(scanManifestPath, manifest);
    return manifest;
  } catch (error: unknown) {
    const manifest =
      checkpoint === null
        ? incompleteManifest(scope, http.counters)
        : buildManifest(scope, checkpoint, http.counters);
    manifest.complete = false;
    await writeJsonAtomic(scanManifestPath, manifest);
    throw error;
  }
}

function incompleteManifest(scope: ScanScope, http: ForumHttpCounters): TechnicalScanManifest {
  return {
    version: 1,
    scope,
    scopeKey: getScopeKey(scope),
    parentForumId: PARENT_FORUM_ID,
    discoveryFingerprint: '',
    eligibleSubforumIds: [],
    scannedSubforumIds: [],
    topicIds: [],
    postIds: [],
    sourceChangedPostIds: [],
    discoveredPageUrls: [parentForumUrl],
    completedPageUrls: [],
    complete: false,
    truncated: false,
    http: { ...http },
  };
}

function initialQueue(scope: ScanScope, eligible: readonly ForumReference[]): ScanQueueItem[] {
  if (scope.mode === 'TOPIC') {
    return [
      {
        kind: 'TOPIC_PAGE',
        subforumId: null,
        topicId: scope.topicId,
        url: topicUrl(scope.topicId),
      },
    ];
  }

  const selected =
    scope.mode === 'ALL'
      ? eligible
      : eligible.filter((child) => child.forumId === scope.subforumId);
  if (scope.mode === 'SUBFORUM' && selected.length !== 1) {
    throw new ForumScannerError(
      'SCOPE_NOT_ELIGIBLE',
      `Forum ${scope.subforumId} is not an eligible direct child of parent forum 69`,
    );
  }
  return selected.map((child) => ({
    kind: 'SUBFORUM_PAGE',
    subforumId: child.forumId,
    url: child.url,
  }));
}

function processSubforumPage(
  checkpoint: ScanCheckpoint,
  item: Extract<ScanQueueItem, { kind: 'SUBFORUM_PAGE' }>,
  response: ForumHtmlResponse,
): void {
  const page = extractForumPage(response.body, response.finalUrl, item.subforumId);
  addCanonicalId(checkpoint.scannedSubforumIds, page.forumId);
  const pageItems: ScanQueueItem[] = page.paginationUrls.map((url) => ({
    kind: 'SUBFORUM_PAGE',
    subforumId: item.subforumId,
    url,
  }));
  for (const topic of page.topics) {
    if (!checkpoint.topicIds.includes(topic.topicId)) checkpoint.topicIds.push(topic.topicId);
    pageItems.push({
      kind: 'TOPIC_PAGE',
      subforumId: item.subforumId,
      topicId: topic.topicId,
      url: topic.url,
    });
  }
  checkpoint.topicIds.sort(compareCanonicalIds);
  enqueue(checkpoint, pageItems);
}

async function processTopicPage(
  checkpoint: ScanCheckpoint,
  item: Extract<ScanQueueItem, { kind: 'TOPIC_PAGE' }>,
  response: ForumHtmlResponse,
  scope: ScanScope,
  store: ForumLocalStore,
): Promise<void> {
  const page = extractTopicPage(response.body, response.finalUrl, {
    expectedTopicId: item.topicId,
    ...(item.subforumId === null ? {} : { expectedSubforumId: item.subforumId }),
  });
  if (!checkpoint.eligibleSubforumIds.includes(page.subforumId)) {
    throw new ForumScannerError(
      'TOPIC_OUT_OF_SCOPE',
      `Topic ${item.topicId} belongs to non-eligible forum ${page.subforumId}`,
    );
  }
  if (scope.mode === 'SUBFORUM' && page.subforumId !== scope.subforumId) {
    throw new ForumScannerError('TOPIC_OUT_OF_SCOPE', `Topic ${item.topicId} left selected forum`);
  }
  addCanonicalId(checkpoint.scannedSubforumIds, page.subforumId);

  enqueue(
    checkpoint,
    page.paginationUrls.map((url) => ({
      kind: 'TOPIC_PAGE',
      subforumId: page.subforumId,
      topicId: page.topicId,
      url,
    })),
  );
  if (!checkpoint.topicIds.includes(page.topicId)) {
    checkpoint.topicIds.push(page.topicId);
    checkpoint.topicIds.sort(compareCanonicalIds);
  }

  const unseenPosts = page.posts.filter((post) => !checkpoint.postIds.includes(post.postId));
  const remaining =
    scope.limitPosts === null
      ? Number.POSITIVE_INFINITY
      : scope.limitPosts - checkpoint.postIds.length;
  const acceptedPosts = unseenPosts.slice(0, Math.max(0, remaining));
  const acceptedPostIds = new Set(acceptedPosts.map((post) => post.postId));
  const postsToInspect = page.posts.filter(
    (post) => checkpoint.postIds.includes(post.postId) || acceptedPostIds.has(post.postId),
  );

  for (const post of postsToInspect) {
    const record: TechnicalPostRecord = {
      version: 1,
      subforumId: page.subforumId,
      topicId: page.topicId,
      postId: post.postId,
      memberId: post.memberId,
      topicTitle: page.title,
      bodyText: post.authorText,
      bodySha256: sha256Hex(post.authorText),
      sourceSha256: sha256Hex(`${page.title}\0${post.authorText}`),
    };
    const path = store.entityPath('posts', post.postId);
    const existing = await readJsonFile<TechnicalPostRecord>(path);
    if (
      existing !== null &&
      (existing.postId !== record.postId ||
        existing.topicId !== record.topicId ||
        existing.subforumId !== record.subforumId ||
        existing.memberId !== record.memberId)
    ) {
      throw new ForumScannerError(
        'IDENTITY_DRIFT',
        `Stable identity metadata changed for post ${post.postId}`,
      );
    }
    if (existing !== null && existing.sourceSha256 !== record.sourceSha256) {
      addCanonicalId(checkpoint.sourceChangedPostIds, post.postId);
      await writeJsonAtomic(store.postRevisionPath(post.postId, record.sourceSha256), record);
    } else if (existing === null) {
      await writeJsonAtomic(path, record);
    }
    addCanonicalId(checkpoint.postIds, post.postId);
  }
  checkpoint.postIds.sort(compareCanonicalIds);

  if (
    scope.limitPosts !== null &&
    checkpoint.postIds.length >= scope.limitPosts &&
    (acceptedPosts.length < unseenPosts.length ||
      checkpoint.pending.some((candidate) => candidate.url !== item.url))
  ) {
    checkpoint.truncated = true;
    checkpoint.pending = [];
  }
}

function fingerprintDiscovery(children: readonly ForumReference[]): string {
  return sha256Hex(
    JSON.stringify(children.map((child) => ({ forumId: child.forumId, url: child.url }))),
  );
}

function buildManifest(
  scope: ScanScope,
  checkpoint: ScanCheckpoint,
  http: ForumHttpCounters,
): TechnicalScanManifest {
  return {
    version: 1,
    scope,
    scopeKey: checkpoint.scopeKey,
    parentForumId: PARENT_FORUM_ID,
    discoveryFingerprint: checkpoint.discoveryFingerprint,
    eligibleSubforumIds: [...checkpoint.eligibleSubforumIds],
    scannedSubforumIds: [...checkpoint.scannedSubforumIds],
    topicIds: [...checkpoint.topicIds],
    postIds: [...checkpoint.postIds],
    sourceChangedPostIds: [...checkpoint.sourceChangedPostIds],
    discoveredPageUrls: [parentForumUrl, ...checkpoint.discoveredUrls],
    completedPageUrls: [parentForumUrl, ...checkpoint.completedUrls],
    complete: checkpoint.complete,
    truncated: checkpoint.truncated,
    http: { ...http },
  };
}

function addCanonicalId(target: string[], id: string): void {
  if (!target.includes(id)) {
    target.push(id);
    target.sort(compareCanonicalIds);
  }
}

export async function readTechnicalPosts(
  store: ForumLocalStore,
  postIds: readonly string[],
): Promise<TechnicalForumPost[]> {
  const posts: TechnicalForumPost[] = [];
  for (const postId of [...postIds].sort(compareCanonicalIds)) {
    const record = await readJsonFile<TechnicalPostRecord>(store.entityPath('posts', postId));
    if (record === null || record.version !== 1 || record.postId !== postId) {
      throw new Error(`Missing or invalid technical post ${postId}`);
    }
    posts.push({
      subforumId: record.subforumId,
      topicId: record.topicId,
      postId: record.postId,
      memberId: record.memberId,
      topicTitle: record.topicTitle,
      bodyText: record.bodyText,
    });
  }
  return posts;
}
