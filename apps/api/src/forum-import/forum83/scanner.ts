import { join } from 'node:path';
import type { TechnicalForumPost } from '../candidate-types.js';
import { ForumLocalStore, readJsonFile, sha256Hex, writeJsonAtomic } from '../cache.js';
import type { ForumHtmlResponse, ForumHttpCounters } from '../http-client.js';
import { compareCanonicalIds } from '../scope.js';
import { FORUM83_ID, FORUM83_SOURCE } from './constants.js';
import {
  extractForum83IndexPage,
  extractForum83TopicPage,
  forum83Url,
  type Forum83TopicReference,
} from './html.js';
import { forum83ScopeKey, type Forum83ScanScope } from './scope.js';
import { bindingByTopicId, loadForum83TopicMap, type Forum83TopicBinding } from './topic-map.js';

export interface Forum83ScannerHttpClient {
  getHtml(url: string): Promise<ForumHtmlResponse>;
  counters: ForumHttpCounters;
}

interface TopicPageQueueItem {
  topicId: string;
  url: string;
}

interface Forum83Checkpoint {
  version: 1;
  source: typeof FORUM83_SOURCE;
  scope: Forum83ScanScope;
  scopeKey: string;
  topicMapSha256: string;
  discoveryFingerprint: string;
  pending: TopicPageQueueItem[];
  completedTopicPageUrls: string[];
  scannedTopicIds: string[];
  postIds: string[];
  sourceChangedPostIds: string[];
  complete: boolean;
  truncated: boolean;
}

interface Forum83TechnicalPostRecord extends TechnicalForumPost {
  version: 1;
  source: typeof FORUM83_SOURCE;
  bodySha256: string;
  sourceSha256: string;
}

export interface Forum83ScanManifest {
  version: 1;
  source: typeof FORUM83_SOURCE;
  forumId: typeof FORUM83_ID;
  scope: Forum83ScanScope;
  scopeKey: string;
  topicMapSha256: string;
  discoveryFingerprint: string;
  topicsDiscovered: number;
  topicIds: string[];
  scannedTopicIds: string[];
  postIds: string[];
  sourceChangedPostIds: string[];
  indexPageUrls: string[];
  completedTopicPageUrls: string[];
  complete: boolean;
  truncated: boolean;
  http: ForumHttpCounters;
}

export class Forum83ScannerError extends Error {
  constructor(
    readonly code:
      | 'CHECKPOINT_INVALID'
      | 'DISCOVERY_DRIFT'
      | 'IDENTITY_DRIFT'
      | 'TOPIC_MAP_MISMATCH'
      | 'TOPIC_OUT_OF_SCOPE',
    message: string,
  ) {
    super(message);
    this.name = 'Forum83ScannerError';
  }
}

export async function scanForum83(
  scope: Forum83ScanScope,
  http: Forum83ScannerHttpClient,
  store: ForumLocalStore,
): Promise<Forum83ScanManifest> {
  const scopeKey = forum83ScopeKey(scope);
  const outputDirectory = store.outputDirectory(scopeKey);
  const scanPath = join(outputDirectory, 'technical', 'scan.json');
  const checkpointPath = store.checkpointPath(scopeKey);
  const topicMap = loadForum83TopicMap();
  await writeJsonAtomic(scanPath, incompleteManifest(scope, topicMap.sha256, http.counters));

  const discovery = await discoverForum83Topics(http);
  assertApprovedDiscovery(discovery.topics, topicMap.map.topics);
  const discoveryFingerprint = sha256Hex(
    JSON.stringify(discovery.topics.map(({ topicId, title }) => ({ topicId, title }))),
  );
  await writeJsonAtomic(join(outputDirectory, 'technical', 'topic-map.json'), {
    version: 1,
    source: FORUM83_SOURCE,
    forumId: FORUM83_ID,
    topicMapSha256: topicMap.sha256,
    discoveryFingerprint,
    topics: topicMap.map.topics,
  });

  const previous = await readJsonFile<Forum83Checkpoint>(checkpointPath);
  let checkpoint: Forum83Checkpoint;
  if (previous !== null && !previous.complete) {
    assertCheckpoint(previous, scope, topicMap.sha256, discoveryFingerprint);
    checkpoint = previous;
  } else {
    const selected =
      scope.mode === 'ALL'
        ? discovery.topics
        : discovery.topics.filter((topic) => topic.topicId === scope.topicId);
    if (selected.length !== (scope.mode === 'ALL' ? 77 : 1)) {
      throw new Forum83ScannerError(
        'TOPIC_OUT_OF_SCOPE',
        scope.mode === 'TOPIC'
          ? `Topic ${scope.topicId} is not in the approved forum83 topic set`
          : 'Approved forum83 topic set is incomplete',
      );
    }
    checkpoint = {
      version: 1,
      source: FORUM83_SOURCE,
      scope,
      scopeKey,
      topicMapSha256: topicMap.sha256,
      discoveryFingerprint,
      pending: selected.map(({ topicId, url }) => ({ topicId, url })).sort(compareQueue),
      completedTopicPageUrls: [],
      scannedTopicIds: [],
      postIds: [],
      sourceChangedPostIds: [],
      complete: false,
      truncated: false,
    };
    await writeJsonAtomic(checkpointPath, checkpoint);
  }

  try {
    const bindings = bindingByTopicId(topicMap.map);
    while (checkpoint.pending.length > 0 && !checkpoint.truncated) {
      const item = checkpoint.pending[0];
      if (item === undefined) break;
      const response = await http.getHtml(item.url);
      const page = extractForum83TopicPage(response.body, response.finalUrl, item.topicId);
      const binding = bindings.get(page.topicId);
      if (binding === undefined || binding.topicTitle !== page.title) {
        throw new Forum83ScannerError(
          'TOPIC_MAP_MISMATCH',
          `Topic ${page.topicId} title differs from the approved map`,
        );
      }
      enqueue(
        checkpoint,
        page.paginationUrls.map((url) => ({ topicId: page.topicId, url })),
      );
      await storePosts(checkpoint, page.posts, scope, store);
      completeItem(checkpoint, item);
      addId(checkpoint.scannedTopicIds, page.topicId);
      if (scope.limitPosts !== null && checkpoint.postIds.length >= scope.limitPosts) {
        checkpoint.truncated = checkpoint.pending.length > 0;
        checkpoint.pending = [];
      }
      await writeJsonAtomic(checkpointPath, checkpoint);
    }
    checkpoint.complete = checkpoint.pending.length === 0;
    await writeJsonAtomic(checkpointPath, checkpoint);
    const manifest = buildManifest(
      scope,
      topicMap.sha256,
      discoveryFingerprint,
      discovery,
      checkpoint,
      http.counters,
    );
    await writeJsonAtomic(scanPath, manifest);
    return manifest;
  } catch (error: unknown) {
    const manifest = buildManifest(
      scope,
      topicMap.sha256,
      discoveryFingerprint,
      discovery,
      checkpoint,
      http.counters,
    );
    manifest.complete = false;
    await writeJsonAtomic(scanPath, manifest);
    throw error;
  }
}

async function discoverForum83Topics(http: Forum83ScannerHttpClient): Promise<{
  topics: Forum83TopicReference[];
  indexPageUrls: string[];
}> {
  const pending = [forum83Url()];
  const completed = new Set<string>();
  const topics = new Map<string, Forum83TopicReference>();
  while (pending.length > 0) {
    const url = pending.shift();
    if (url === undefined || completed.has(url)) continue;
    const response = await http.getHtml(url);
    const page = extractForum83IndexPage(response.body, response.finalUrl);
    for (const topic of page.topics) {
      const existing = topics.get(topic.topicId);
      if (
        existing !== undefined &&
        (existing.title !== topic.title || existing.url !== topic.url)
      ) {
        throw new Forum83ScannerError(
          'DISCOVERY_DRIFT',
          `Topic ${topic.topicId} has conflicting discovery metadata`,
        );
      }
      topics.set(topic.topicId, existing ?? topic);
    }
    completed.add(url);
    for (const paginationUrl of page.paginationUrls) {
      if (!completed.has(paginationUrl) && !pending.includes(paginationUrl)) {
        pending.push(paginationUrl);
      }
    }
    pending.sort(comparePageUrls);
  }
  return {
    topics: [...topics.values()].sort((left, right) =>
      compareCanonicalIds(left.topicId, right.topicId),
    ),
    indexPageUrls: [...completed].sort(comparePageUrls),
  };
}

async function storePosts(
  checkpoint: Forum83Checkpoint,
  posts: readonly TechnicalForumPost[],
  scope: Forum83ScanScope,
  store: ForumLocalStore,
): Promise<void> {
  const unseen = posts.filter((post) => !checkpoint.postIds.includes(post.postId));
  const remaining =
    scope.limitPosts === null
      ? Number.POSITIVE_INFINITY
      : scope.limitPosts - checkpoint.postIds.length;
  const acceptedIds = new Set(unseen.slice(0, Math.max(0, remaining)).map(({ postId }) => postId));
  const inspected = posts.filter(
    ({ postId }) => checkpoint.postIds.includes(postId) || acceptedIds.has(postId),
  );
  for (const post of inspected) {
    const record: Forum83TechnicalPostRecord = {
      version: 1,
      source: FORUM83_SOURCE,
      ...post,
      bodySha256: sha256Hex(post.bodyText),
      sourceSha256: sha256Hex(`${post.topicTitle}\0${post.bodyText}`),
    };
    const path = store.entityPath('posts', post.postId);
    const existing = await readJsonFile<Forum83TechnicalPostRecord>(path);
    if (
      existing !== null &&
      (existing.source !== FORUM83_SOURCE ||
        existing.postId !== record.postId ||
        existing.topicId !== record.topicId ||
        existing.subforumId !== FORUM83_ID ||
        existing.memberId !== record.memberId)
    ) {
      throw new Forum83ScannerError(
        'IDENTITY_DRIFT',
        `Stable forum83 identity changed for post ${post.postId}`,
      );
    }
    if (existing !== null && existing.sourceSha256 !== record.sourceSha256) {
      addId(checkpoint.sourceChangedPostIds, post.postId);
      await writeJsonAtomic(store.postRevisionPath(post.postId, record.sourceSha256), record);
    } else if (existing === null) {
      await writeJsonAtomic(path, record);
    }
    addId(checkpoint.postIds, post.postId);
  }
}

export async function readForum83TechnicalPosts(
  store: ForumLocalStore,
  postIds: readonly string[],
): Promise<TechnicalForumPost[]> {
  const posts: TechnicalForumPost[] = [];
  for (const postId of [...postIds].sort(compareCanonicalIds)) {
    const record = await readJsonFile<Forum83TechnicalPostRecord>(
      store.entityPath('posts', postId),
    );
    if (
      record === null ||
      record.version !== 1 ||
      record.source !== FORUM83_SOURCE ||
      record.subforumId !== FORUM83_ID ||
      record.postId !== postId
    ) {
      throw new Forum83ScannerError('CHECKPOINT_INVALID', `Missing forum83 post ${postId}`);
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

function assertApprovedDiscovery(
  discovered: readonly Forum83TopicReference[],
  approved: readonly Forum83TopicBinding[],
): void {
  const discoveredRows = discovered.map(({ topicId, title }) => ({ topicId, topicTitle: title }));
  const approvedRows = approved
    .map(({ topicId, topicTitle }) => ({ topicId, topicTitle }))
    .sort((left, right) => compareCanonicalIds(left.topicId, right.topicId));
  if (JSON.stringify(discoveredRows) !== JSON.stringify(approvedRows)) {
    throw new Forum83ScannerError(
      'TOPIC_MAP_MISMATCH',
      'Live forum83 topics differ from the approved 77-topic map',
    );
  }
}

function assertCheckpoint(
  checkpoint: Forum83Checkpoint,
  scope: Forum83ScanScope,
  topicMapSha256: string,
  discoveryFingerprint: string,
): void {
  if (
    checkpoint.version !== 1 ||
    checkpoint.source !== FORUM83_SOURCE ||
    checkpoint.scopeKey !== forum83ScopeKey(scope) ||
    JSON.stringify(checkpoint.scope) !== JSON.stringify(scope) ||
    checkpoint.topicMapSha256 !== topicMapSha256
  ) {
    throw new Forum83ScannerError('CHECKPOINT_INVALID', 'Forum83 checkpoint is invalid');
  }
  if (checkpoint.discoveryFingerprint !== discoveryFingerprint) {
    throw new Forum83ScannerError(
      'DISCOVERY_DRIFT',
      'Forum83 topic discovery changed while the bounded scan was incomplete',
    );
  }
}

function incompleteManifest(
  scope: Forum83ScanScope,
  topicMapSha256: string,
  http: ForumHttpCounters,
): Forum83ScanManifest {
  return {
    version: 1,
    source: FORUM83_SOURCE,
    forumId: FORUM83_ID,
    scope,
    scopeKey: forum83ScopeKey(scope),
    topicMapSha256,
    discoveryFingerprint: '',
    topicsDiscovered: 0,
    topicIds: [],
    scannedTopicIds: [],
    postIds: [],
    sourceChangedPostIds: [],
    indexPageUrls: [],
    completedTopicPageUrls: [],
    complete: false,
    truncated: false,
    http: { ...http },
  };
}

function buildManifest(
  scope: Forum83ScanScope,
  topicMapSha256: string,
  discoveryFingerprint: string,
  discovery: { topics: Forum83TopicReference[]; indexPageUrls: string[] },
  checkpoint: Forum83Checkpoint,
  http: ForumHttpCounters,
): Forum83ScanManifest {
  return {
    version: 1,
    source: FORUM83_SOURCE,
    forumId: FORUM83_ID,
    scope,
    scopeKey: checkpoint.scopeKey,
    topicMapSha256,
    discoveryFingerprint,
    topicsDiscovered: discovery.topics.length,
    topicIds: discovery.topics.map(({ topicId }) => topicId),
    scannedTopicIds: [...checkpoint.scannedTopicIds],
    postIds: [...checkpoint.postIds],
    sourceChangedPostIds: [...checkpoint.sourceChangedPostIds],
    indexPageUrls: discovery.indexPageUrls,
    completedTopicPageUrls: [...checkpoint.completedTopicPageUrls],
    complete: checkpoint.complete,
    truncated: checkpoint.truncated,
    http: { ...http },
  };
}

function enqueue(checkpoint: Forum83Checkpoint, items: readonly TopicPageQueueItem[]): void {
  const completed = new Set(checkpoint.completedTopicPageUrls);
  const combined = [...checkpoint.pending, ...items].filter((item) => !completed.has(item.url));
  checkpoint.pending = [...new Map(combined.map((item) => [item.url, item])).values()].sort(
    compareQueue,
  );
}

function completeItem(checkpoint: Forum83Checkpoint, item: TopicPageQueueItem): void {
  checkpoint.pending = checkpoint.pending.filter((candidate) => candidate.url !== item.url);
  if (!checkpoint.completedTopicPageUrls.includes(item.url)) {
    checkpoint.completedTopicPageUrls.push(item.url);
    checkpoint.completedTopicPageUrls.sort(comparePageUrls);
  }
}

function compareQueue(left: TopicPageQueueItem, right: TopicPageQueueItem): number {
  return compareCanonicalIds(left.topicId, right.topicId) || comparePageUrls(left.url, right.url);
}

function comparePageUrls(left: string, right: string): number {
  const leftPage = pageNumber(left);
  const rightPage = pageNumber(right);
  return leftPage - rightPage || left.localeCompare(right, 'en');
}

function pageNumber(value: string): number {
  const match = new URL(value).href.match(/\/page\/(\d+)(?:\/|$)/iu)?.[1];
  return match === undefined ? 1 : Number(match);
}

function addId(target: string[], id: string): void {
  if (!target.includes(id)) {
    target.push(id);
    target.sort(compareCanonicalIds);
  }
}
