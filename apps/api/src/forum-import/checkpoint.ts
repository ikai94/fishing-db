import { readJsonFile, writeJsonAtomic } from './cache.js';
import { compareCanonicalIds, getScopeKey, type ScanScope } from './scope.js';

export const FORUM_SCANNER_VERSION = 1 as const;

export type ScanQueueItem =
  | {
      kind: 'SUBFORUM_PAGE';
      subforumId: string;
      url: string;
    }
  | {
      kind: 'TOPIC_PAGE';
      subforumId: string | null;
      topicId: string;
      url: string;
    };

export interface ScanCheckpoint {
  schemaVersion: 1;
  scannerVersion: typeof FORUM_SCANNER_VERSION;
  scope: ScanScope;
  scopeKey: string;
  discoveryFingerprint: string;
  eligibleSubforumIds: string[];
  pending: ScanQueueItem[];
  discoveredUrls: string[];
  completedUrls: string[];
  scannedSubforumIds: string[];
  topicIds: string[];
  postIds: string[];
  sourceChangedPostIds: string[];
  pagesScanned: number;
  complete: boolean;
  truncated: boolean;
}

export class ForumCheckpointError extends Error {
  constructor(
    readonly code: 'CHECKPOINT_INVALID' | 'SCOPE_DRIFT' | 'SCOPE_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'ForumCheckpointError';
  }
}

function sameScope(left: ScanScope, right: ScanScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createCheckpoint(
  scope: ScanScope,
  discoveryFingerprint: string,
  eligibleSubforumIds: readonly string[],
  pending: readonly ScanQueueItem[],
): ScanCheckpoint {
  return {
    schemaVersion: 1,
    scannerVersion: FORUM_SCANNER_VERSION,
    scope,
    scopeKey: getScopeKey(scope),
    discoveryFingerprint,
    eligibleSubforumIds: [...eligibleSubforumIds].sort(compareCanonicalIds),
    pending: sortQueue(deduplicateQueue(pending)),
    discoveredUrls: [...new Set(pending.map((item) => item.url))].sort(),
    completedUrls: [],
    scannedSubforumIds: [],
    topicIds: [],
    postIds: [],
    sourceChangedPostIds: [],
    pagesScanned: 0,
    complete: false,
    truncated: false,
  };
}

export async function loadCheckpoint(
  path: string,
  requestedScope: ScanScope,
): Promise<ScanCheckpoint | null> {
  const checkpoint = await readJsonFile<ScanCheckpoint>(path);
  if (checkpoint === null) return null;
  if (
    checkpoint.schemaVersion !== 1 ||
    checkpoint.scannerVersion !== FORUM_SCANNER_VERSION ||
    !Array.isArray(checkpoint.pending) ||
    !Array.isArray(checkpoint.discoveredUrls) ||
    !Array.isArray(checkpoint.completedUrls) ||
    !Array.isArray(checkpoint.eligibleSubforumIds) ||
    !Array.isArray(checkpoint.scannedSubforumIds) ||
    !Array.isArray(checkpoint.topicIds) ||
    !Array.isArray(checkpoint.postIds) ||
    !Array.isArray(checkpoint.sourceChangedPostIds)
  ) {
    throw new ForumCheckpointError('CHECKPOINT_INVALID', `Invalid checkpoint at ${path}`);
  }
  if (
    !sameScope(checkpoint.scope, requestedScope) ||
    checkpoint.scopeKey !== getScopeKey(requestedScope)
  ) {
    throw new ForumCheckpointError(
      'SCOPE_MISMATCH',
      'Checkpoint scope differs from the requested scan scope',
    );
  }
  return checkpoint;
}

export async function saveCheckpoint(path: string, checkpoint: ScanCheckpoint): Promise<void> {
  await writeJsonAtomic(path, checkpoint);
}

export function assertNoScopeDrift(
  checkpoint: ScanCheckpoint,
  discoveryFingerprint: string,
  eligibleSubforumIds: readonly string[],
): void {
  const currentIds = [...eligibleSubforumIds].sort(compareCanonicalIds);
  if (
    checkpoint.discoveryFingerprint !== discoveryFingerprint ||
    JSON.stringify(checkpoint.eligibleSubforumIds) !== JSON.stringify(currentIds)
  ) {
    throw new ForumCheckpointError(
      'SCOPE_DRIFT',
      'Parent forum child discovery changed while the scan was incomplete',
    );
  }
}

export function enqueue(checkpoint: ScanCheckpoint, items: readonly ScanQueueItem[]): void {
  const completed = new Set(checkpoint.completedUrls);
  checkpoint.pending = sortQueue(
    deduplicateQueue([...checkpoint.pending, ...items]).filter((item) => !completed.has(item.url)),
  );
  checkpoint.discoveredUrls = [
    ...new Set([...checkpoint.discoveredUrls, ...items.map((item) => item.url)]),
  ].sort();
}

export function completeQueueItem(checkpoint: ScanCheckpoint, item: ScanQueueItem): void {
  checkpoint.pending = checkpoint.pending.filter((candidate) => candidate.url !== item.url);
  if (!checkpoint.completedUrls.includes(item.url)) {
    checkpoint.completedUrls.push(item.url);
    checkpoint.completedUrls.sort();
    checkpoint.pagesScanned += 1;
  }
}

function deduplicateQueue(items: readonly ScanQueueItem[]): ScanQueueItem[] {
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

function sortQueue(items: readonly ScanQueueItem[]): ScanQueueItem[] {
  return [...items].sort((left, right) => {
    const kind = left.kind === right.kind ? 0 : left.kind === 'SUBFORUM_PAGE' ? -1 : 1;
    if (kind !== 0) return kind;
    const subforum = compareNullableIds(left.subforumId, right.subforumId);
    if (subforum !== 0) return subforum;
    if (left.kind === 'TOPIC_PAGE' && right.kind === 'TOPIC_PAGE') {
      const topic = compareCanonicalIds(left.topicId, right.topicId);
      if (topic !== 0) return topic;
    }
    const page = comparePaginationPage(left.url, right.url);
    if (page !== 0) return page;
    return left.url.localeCompare(right.url, 'en');
  });
}

function comparePaginationPage(left: string, right: string): number {
  const leftPage = paginationPage(left);
  const rightPage = paginationPage(right);
  return leftPage < rightPage ? -1 : leftPage > rightPage ? 1 : 0;
}

function paginationPage(value: string): bigint {
  const url = new URL(value);
  const queryPage = url.searchParams.get('page');
  if (queryPage !== null && /^\d+$/u.test(queryPage)) return BigInt(queryPage);
  const pathPage = `${url.pathname}${url.search}`.match(/\/page\/(\d+)(?=[^0-9]|$)/iu)?.[1];
  return pathPage === undefined ? 1n : BigInt(pathPage);
}

function compareNullableIds(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareCanonicalIds(left, right);
}
