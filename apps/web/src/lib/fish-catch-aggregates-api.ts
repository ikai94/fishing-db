import { apiRequest } from './api-client';

export type FishCatchAggregate = {
  fish: { id: string; name: string };
  fishingBase: { id: string; name: string };
  location: { id: string; number: number; name: string };
  bait: { id: string; name: string; isActive: boolean };
  intensity: number;
  contributorCount: number;
  maxObservedWeightGrams: number;
};

export type FishCatchAggregatePage = {
  items: FishCatchAggregate[];
  nextCursor: string | null;
};

export type ListFishCatchAggregatesOptions = {
  fishId: string;
  baseIds: readonly string[];
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

const MAX_BASE_IDS = 100;
const RESPONSE_KEYS = ['items', 'nextCursor'] as const;
const ITEM_KEYS = [
  'fish',
  'fishingBase',
  'location',
  'bait',
  'intensity',
  'contributorCount',
  'maxObservedWeightGrams',
] as const;
const NAMED_KEYS = ['id', 'name'] as const;
const LOCATION_KEYS = ['id', 'number', 'name'] as const;
const BAIT_KEYS = ['id', 'name', 'isActive'] as const;

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректные агрегированные уловы');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function readPositiveSafeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalidResponse();
  return value;
}

function readNamedItem(value: unknown): { id: string; name: string } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, NAMED_KEYS) ||
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.name !== 'string' ||
    value.name.length === 0
  ) {
    invalidResponse();
  }
  return { id: value.id, name: value.name };
}

export function decodeFishCatchAggregate(value: unknown): FishCatchAggregate {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) invalidResponse();

  const location = value.location;
  const bait = value.bait;
  if (
    !isRecord(location) ||
    !hasExactKeys(location, LOCATION_KEYS) ||
    typeof location.id !== 'string' ||
    location.id.length === 0 ||
    typeof location.name !== 'string' ||
    location.name.length === 0 ||
    !Number.isSafeInteger(location.number) ||
    (location.number as number) < 1 ||
    !isRecord(bait) ||
    !hasExactKeys(bait, BAIT_KEYS) ||
    typeof bait.id !== 'string' ||
    bait.id.length === 0 ||
    typeof bait.name !== 'string' ||
    bait.name.length === 0 ||
    typeof bait.isActive !== 'boolean'
  ) {
    invalidResponse();
  }

  const intensity = readPositiveSafeInteger(value.intensity);
  const contributorCount = readPositiveSafeInteger(value.contributorCount);
  if (contributorCount > intensity) invalidResponse();

  return {
    fish: readNamedItem(value.fish),
    fishingBase: readNamedItem(value.fishingBase),
    location: { id: location.id, number: location.number as number, name: location.name },
    bait: { id: bait.id, name: bait.name, isActive: bait.isActive },
    intensity,
    contributorCount,
    maxObservedWeightGrams: readPositiveSafeInteger(value.maxObservedWeightGrams),
  };
}

export function decodeFishCatchAggregatePage(payload: unknown): FishCatchAggregatePage {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, RESPONSE_KEYS) ||
    !Array.isArray(payload.items) ||
    (payload.nextCursor !== null && typeof payload.nextCursor !== 'string')
  ) {
    invalidResponse();
  }

  const identities = new Set<string>();
  const items = payload.items.map((value) => {
    const item = decodeFishCatchAggregate(value);
    const identity = [item.fish.id, item.fishingBase.id, item.location.id, item.bait.id].join('\0');
    if (identities.has(identity)) invalidResponse();
    identities.add(identity);
    return item;
  });

  return { items, nextCursor: payload.nextCursor };
}

export async function listFishCatchAggregates({
  fishId,
  baseIds,
  cursor,
  limit,
  signal,
}: ListFishCatchAggregatesOptions): Promise<FishCatchAggregatePage> {
  const canonicalBaseIds = [...new Set(baseIds)].sort();
  if (canonicalBaseIds.length === 0) {
    throw new Error('Для агрегированных уловов укажите хотя бы одну рыболовную базу');
  }
  if (canonicalBaseIds.length > MAX_BASE_IDS) {
    throw new Error(`Для агрегированных уловов можно выбрать не более ${MAX_BASE_IDS} баз`);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    throw new Error('Лимит агрегированных уловов должен быть от 1 до 100');
  }

  const query = new URLSearchParams({ fishId, baseIds: canonicalBaseIds.join(',') });
  if (limit !== undefined) query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);

  const payload = await apiRequest<unknown>(
    `/catch-reports/statistics/fish-catches?${query.toString()}`,
    { signal },
  );
  const page = decodeFishCatchAggregatePage(payload);
  const selectedBaseIds = new Set(canonicalBaseIds);
  if (
    page.items.some((item) => item.fish.id !== fishId || !selectedBaseIds.has(item.fishingBase.id))
  ) {
    invalidResponse();
  }
  return page;
}
