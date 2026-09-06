import { apiRequest } from './api-client';
import { decodePublicCatchReport, type CatchReport } from './catch-reports-api';

export type SpotStatisticsScope =
  | { kind: 'fish'; fishId: string; baseIds: readonly string[] }
  | { kind: 'location'; locationId: string; fishIds?: readonly string[] };

type ActiveCatalogEntity = { id: string; name: string; isActive: boolean };

export type SpotTopBait = {
  bait: ActiveCatalogEntity;
  contributorCount: number;
  reportsCount: number;
};

export type SpotStatistic = {
  groupKey: string;
  fishingBase: ActiveCatalogEntity;
  location: ActiveCatalogEntity & { number: number };
  holeDepthCm: number | null;
  spotPosition: string | null;
  contributorCount: number;
  reportsCount: number;
  fishCount: number;
  topBaits: SpotTopBait[];
  latestReportCreatedAt: string;
};

export type SpotStatisticsPage = {
  items: SpotStatistic[];
  totalGroups: number;
  scopedReportsCount: number;
  unlocatedReportsCount: number;
};

export type SpotEvidencePage = { items: CatchReport[]; nextCursor: string | null };

const RESPONSE_KEYS = [
  'items',
  'totalGroups',
  'scopedReportsCount',
  'unlocatedReportsCount',
] as const;
const ITEM_KEYS = [
  'groupKey',
  'fishingBase',
  'location',
  'holeDepthCm',
  'spotPosition',
  'contributorCount',
  'reportsCount',
  'fishCount',
  'topBaits',
  'latestReportCreatedAt',
] as const;
const ENTITY_KEYS = ['id', 'name', 'isActive'] as const;
const LOCATION_KEYS = ['id', 'name', 'isActive', 'number'] as const;
const TOP_BAIT_KEYS = ['bait', 'contributorCount', 'reportsCount'] as const;

function invalid(): never {
  throw new Error('Сервер вернул некорректную статистику ям и точек');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function readCount(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    invalid();
  }
  return value;
}

function readEntity(value: unknown): ActiveCatalogEntity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ENTITY_KEYS) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.isActive !== 'boolean'
  ) {
    invalid();
  }
  return { id: value.id, name: value.name, isActive: value.isActive };
}

function readLocation(value: unknown): SpotStatistic['location'] {
  if (!isRecord(value) || !hasExactKeys(value, LOCATION_KEYS)) invalid();
  return {
    ...readEntity({ id: value.id, name: value.name, isActive: value.isActive }),
    number: readCount(value.number, true),
  };
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalid();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) invalid();
  return value;
}

function readTopBait(value: unknown): SpotTopBait {
  if (!isRecord(value) || !hasExactKeys(value, TOP_BAIT_KEYS)) invalid();
  const contributorCount = readCount(value.contributorCount, true);
  const reportsCount = readCount(value.reportsCount, true);
  if (contributorCount > reportsCount) invalid();
  return { bait: readEntity(value.bait), contributorCount, reportsCount };
}

function readItem(value: unknown): SpotStatistic {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ITEM_KEYS) ||
    typeof value.groupKey !== 'string' ||
    value.groupKey.length === 0 ||
    (value.holeDepthCm !== null && readCount(value.holeDepthCm, true) < 1) ||
    (value.spotPosition !== null &&
      (typeof value.spotPosition !== 'string' || value.spotPosition.length === 0)) ||
    !Array.isArray(value.topBaits) ||
    value.topBaits.length > 3
  ) {
    invalid();
  }
  if (value.holeDepthCm === null && value.spotPosition === null) invalid();
  const contributorCount = readCount(value.contributorCount, true);
  const reportsCount = readCount(value.reportsCount, true);
  const fishCount = readCount(value.fishCount, true);
  if (contributorCount > reportsCount || fishCount > reportsCount) invalid();

  return {
    groupKey: value.groupKey,
    fishingBase: readEntity(value.fishingBase),
    location: readLocation(value.location),
    holeDepthCm: value.holeDepthCm as number | null,
    spotPosition: value.spotPosition as string | null,
    contributorCount,
    reportsCount,
    fishCount,
    topBaits: value.topBaits.map(readTopBait),
    latestReportCreatedAt: readTimestamp(value.latestReportCreatedAt),
  };
}

export function decodeSpotStatisticsPage(payload: unknown): SpotStatisticsPage {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, RESPONSE_KEYS) ||
    !Array.isArray(payload.items)
  ) {
    invalid();
  }
  const page = {
    items: payload.items.map(readItem),
    totalGroups: readCount(payload.totalGroups),
    scopedReportsCount: readCount(payload.scopedReportsCount),
    unlocatedReportsCount: readCount(payload.unlocatedReportsCount),
  };
  if (
    page.items.length > page.totalGroups ||
    page.unlocatedReportsCount > page.scopedReportsCount
  ) {
    invalid();
  }
  return page;
}

export function decodeSpotEvidencePage(payload: unknown): SpotEvidencePage {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ['items', 'nextCursor']) ||
    !Array.isArray(payload.items) ||
    (payload.nextCursor !== null && typeof payload.nextCursor !== 'string')
  ) {
    invalid();
  }
  return {
    items: payload.items.map(decodePublicCatchReport),
    nextCursor: payload.nextCursor,
  };
}

function scopeQuery(scope: SpotStatisticsScope): URLSearchParams {
  const query = new URLSearchParams();
  if (scope.kind === 'fish') {
    query.set('fishId', scope.fishId);
    const baseIds = [...new Set(scope.baseIds)].sort();
    if (baseIds.length > 0) query.set('baseIds', baseIds.join(','));
  } else {
    query.set('locationId', scope.locationId);
    const fishIds = scope.fishIds === undefined ? [] : [...new Set(scope.fishIds)].sort();
    if (scope.fishIds !== undefined && fishIds.length > 0) query.set('fishIds', fishIds.join(','));
  }
  return query;
}

export async function listSpotStatistics(options: {
  scope: SpotStatisticsScope;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<SpotStatisticsPage> {
  const query = scopeQuery(options.scope);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.offset !== undefined) query.set('offset', String(options.offset));
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/spots?${query}`, {
    signal: options.signal,
  });
  return decodeSpotStatisticsPage(payload);
}

export async function listSpotEvidence(options: {
  scope: SpotStatisticsScope;
  groupKey: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}): Promise<SpotEvidencePage> {
  const query = scopeQuery(options.scope);
  query.set('groupKey', options.groupKey);
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/spots/reports?${query}`, {
    signal: options.signal,
  });
  return decodeSpotEvidencePage(payload);
}
