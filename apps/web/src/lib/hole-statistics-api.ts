import { apiRequest } from './api-client';

export type HoleStatisticCatalogEntity = {
  id: string;
  name: string;
  isActive: boolean;
};

export type HoleStatistic = {
  fishingBase: HoleStatisticCatalogEntity;
  location: HoleStatisticCatalogEntity & { number: number };
  holeDepthCm: number;
  spotPosition: string | null;
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
};

export type ListHoleStatisticsOptions = {
  fishId: string;
  baseIds: readonly string[];
  signal?: AbortSignal;
};

const MAX_BASE_IDS = 100;
const MAX_DATABASE_INTEGER = 2_147_483_647;
const RESPONSE_KEYS = ['items'] as const;
const ITEM_KEYS = [
  'fishingBase',
  'location',
  'holeDepthCm',
  'spotPosition',
  'uniqueUsersCount',
  'reportsCount',
  'latestReportCreatedAt',
] as const;
const ENTITY_KEYS = ['id', 'name', 'isActive'] as const;
const LOCATION_KEYS = ['id', 'name', 'isActive', 'number'] as const;

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректную статистику рыболовных точек');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function readCatalogEntity(value: unknown): HoleStatisticCatalogEntity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ENTITY_KEYS) ||
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

function readPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    invalidResponse();
  }

  return value;
}

function readLocation(value: unknown): HoleStatistic['location'] {
  if (!isRecord(value) || !hasExactKeys(value, LOCATION_KEYS)) invalidResponse();

  return {
    ...readCatalogEntity({ id: value.id, name: value.name, isActive: value.isActive }),
    number: readPositiveInteger(value.number, MAX_DATABASE_INTEGER),
  };
}

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalidResponse();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalidResponse();
  }

  return value;
}

export function decodeHoleStatistic(value: unknown): HoleStatistic {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ITEM_KEYS) ||
    (value.spotPosition !== null &&
      (typeof value.spotPosition !== 'string' || value.spotPosition.length === 0))
  ) {
    invalidResponse();
  }

  const uniqueUsersCount = readPositiveInteger(value.uniqueUsersCount);
  const reportsCount = readPositiveInteger(value.reportsCount);
  if (uniqueUsersCount > reportsCount) invalidResponse();

  return {
    fishingBase: readCatalogEntity(value.fishingBase),
    location: readLocation(value.location),
    holeDepthCm: readPositiveInteger(value.holeDepthCm, MAX_DATABASE_INTEGER),
    spotPosition: value.spotPosition,
    uniqueUsersCount,
    reportsCount,
    latestReportCreatedAt: readTimestamp(value.latestReportCreatedAt),
  };
}

export function decodeHoleStatisticsResponse(payload: unknown): HoleStatistic[] {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, RESPONSE_KEYS) ||
    !Array.isArray(payload.items)
  ) {
    invalidResponse();
  }

  return payload.items.map(decodeHoleStatistic);
}

export async function listHoleStatistics({
  fishId,
  baseIds,
  signal,
}: ListHoleStatisticsOptions): Promise<HoleStatistic[]> {
  const canonicalBaseIds = [...new Set(baseIds)].sort();
  if (canonicalBaseIds.length === 0) {
    throw new Error('Для статистики укажите хотя бы одну рыболовную базу');
  }
  if (canonicalBaseIds.length > MAX_BASE_IDS) {
    throw new Error(`Для статистики можно выбрать не более ${MAX_BASE_IDS} рыболовных баз`);
  }

  const query = new URLSearchParams({ fishId, baseIds: canonicalBaseIds.join(',') });
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/holes?${query}`, { signal });
  return decodeHoleStatisticsResponse(payload);
}
