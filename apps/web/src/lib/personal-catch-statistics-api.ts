import { apiRequest } from './api-client';

export type HistoricalItem = { id: string; name: string; isActive: boolean };
export type PersonalNamedRanking = { item: HistoricalItem; reportsCount: number };
export type PersonalLocationRanking = {
  location: HistoricalItem & { number: number };
  fishingBase: HistoricalItem;
  reportsCount: number;
};
export type PersonalCatchStatistics = {
  totalCatches: number;
  uniqueFishCount: number;
  topFish: PersonalNamedRanking[];
  topBases: PersonalNamedRanking[];
  topLocations: PersonalLocationRanking[];
  topBaits: PersonalNamedRanking[];
};
export type PersonalCatchRecord = {
  fish: HistoricalItem;
  maxWeightGrams: number;
  representativeReport: {
    id: string;
    createdAt: string;
    fishingBase: HistoricalItem;
    location: HistoricalItem & { number: number };
    bait: HistoricalItem;
  };
};
export type PersonalCatchRecordPage = {
  items: PersonalCatchRecord[];
  nextCursor: string | null;
};

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректную личную статистику');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function readCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalidResponse();
  return value;
}

function readPositiveInteger(value: unknown): number {
  const result = readCount(value);
  if (result < 1) invalidResponse();
  return result;
}

function readItem(value: unknown): HistoricalItem {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['id', 'name', 'isActive']) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0 ||
    typeof value.isActive !== 'boolean'
  ) {
    invalidResponse();
  }
  return { id: value.id, name: value.name, isActive: value.isActive };
}

function readLocation(value: unknown): HistoricalItem & { number: number } {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'name', 'number', 'isActive'])) {
    invalidResponse();
  }
  const item = readItem({ id: value.id, name: value.name, isActive: value.isActive });
  return { ...item, number: readPositiveInteger(value.number) };
}

function readNamedRanking(value: unknown): PersonalNamedRanking {
  if (!isRecord(value) || !hasExactKeys(value, ['item', 'reportsCount'])) invalidResponse();
  return { item: readItem(value.item), reportsCount: readPositiveInteger(value.reportsCount) };
}

function readRankingList<T extends { reportsCount: number }>(
  value: unknown[],
  read: (item: unknown) => T,
  identity: (item: T) => string,
): T[] {
  if (value.length > 10) invalidResponse();
  const items = value.map(read);
  if (new Set(items.map(identity)).size !== items.length) invalidResponse();
  return items;
}

function readLocationRanking(value: unknown): PersonalLocationRanking {
  if (!isRecord(value) || !hasExactKeys(value, ['location', 'fishingBase', 'reportsCount'])) {
    invalidResponse();
  }
  return {
    location: readLocation(value.location),
    fishingBase: readItem(value.fishingBase),
    reportsCount: readPositiveInteger(value.reportsCount),
  };
}

export function decodePersonalCatchStatistics(value: unknown): PersonalCatchStatistics {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'totalCatches',
      'uniqueFishCount',
      'topFish',
      'topBases',
      'topLocations',
      'topBaits',
    ]) ||
    !Array.isArray(value.topFish) ||
    !Array.isArray(value.topBases) ||
    !Array.isArray(value.topLocations) ||
    !Array.isArray(value.topBaits)
  ) {
    invalidResponse();
  }
  const result = {
    totalCatches: readCount(value.totalCatches),
    uniqueFishCount: readCount(value.uniqueFishCount),
    topFish: readRankingList(value.topFish, readNamedRanking, (entry) => entry.item.id),
    topBases: readRankingList(value.topBases, readNamedRanking, (entry) => entry.item.id),
    topLocations: readRankingList(
      value.topLocations,
      readLocationRanking,
      (entry) => entry.location.id,
    ),
    topBaits: readRankingList(value.topBaits, readNamedRanking, (entry) => entry.item.id),
  };
  if (result.uniqueFishCount > result.totalCatches) invalidResponse();
  return result;
}

function readRecord(value: unknown): PersonalCatchRecord {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['fish', 'maxWeightGrams', 'representativeReport']) ||
    !isRecord(value.representativeReport) ||
    !hasExactKeys(value.representativeReport, [
      'id',
      'createdAt',
      'fishingBase',
      'location',
      'bait',
    ]) ||
    typeof value.representativeReport.id !== 'string' ||
    typeof value.representativeReport.createdAt !== 'string'
  ) {
    invalidResponse();
  }
  const createdAt = new Date(value.representativeReport.createdAt);
  if (
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== value.representativeReport.createdAt
  ) {
    invalidResponse();
  }
  return {
    fish: readItem(value.fish),
    maxWeightGrams: readPositiveInteger(value.maxWeightGrams),
    representativeReport: {
      id: value.representativeReport.id,
      createdAt: value.representativeReport.createdAt,
      fishingBase: readItem(value.representativeReport.fishingBase),
      location: readLocation(value.representativeReport.location),
      bait: readItem(value.representativeReport.bait),
    },
  };
}

export function decodePersonalCatchRecordPage(value: unknown): PersonalCatchRecordPage {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['items', 'nextCursor']) ||
    !Array.isArray(value.items) ||
    (value.nextCursor !== null &&
      (typeof value.nextCursor !== 'string' || value.nextCursor.length === 0))
  ) {
    invalidResponse();
  }
  const items = value.items.map(readRecord);
  if (new Set(items.map((item) => item.fish.id)).size !== items.length) invalidResponse();
  return { items, nextCursor: value.nextCursor as string | null };
}

export async function getPersonalCatchStatistics(
  signal?: AbortSignal,
): Promise<PersonalCatchStatistics> {
  const payload = await apiRequest<unknown>('/me/catch-reports/statistics', { signal });
  return decodePersonalCatchStatistics(payload);
}

export async function listPersonalCatchRecords(
  options: {
    limit?: number;
    cursor?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<PersonalCatchRecordPage> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  const search = query.toString();
  const payload = await apiRequest<unknown>(
    `/me/catch-reports/records${search ? `?${search}` : ''}`,
    { signal: options.signal },
  );
  return decodePersonalCatchRecordPage(payload);
}
