import { apiRequest } from './api-client';

export type BaitStatistic = {
  bait: {
    id: string;
    name: string;
    isActive: boolean;
  };
  reportsCount: number;
};

export type ListBaitStatisticsOptions = {
  fishId: string;
  baseId: string;
  signal?: AbortSignal;
};

const RESPONSE_KEYS = ['items'] as const;
const ITEM_KEYS = ['bait', 'reportsCount'] as const;
const BAIT_KEYS = ['id', 'name', 'isActive'] as const;

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректную статистику наживок и приманок');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalidResponse();
  }

  return value;
}

function readBait(value: unknown): BaitStatistic['bait'] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, BAIT_KEYS) ||
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

export function decodeBaitStatistic(value: unknown): BaitStatistic {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) invalidResponse();

  const reportsCount = readPositiveInteger(value.reportsCount);

  return {
    bait: readBait(value.bait),
    reportsCount,
  };
}

export function decodeBaitStatisticsResponse(payload: unknown): BaitStatistic[] {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, RESPONSE_KEYS) ||
    !Array.isArray(payload.items)
  ) {
    invalidResponse();
  }

  const identities = new Set<string>();
  return payload.items.map((value) => {
    const item = decodeBaitStatistic(value);
    const identity = item.bait.id;
    if (identities.has(identity)) invalidResponse();
    identities.add(identity);
    return item;
  });
}

export async function listBaitStatistics({
  fishId,
  baseId,
  signal,
}: ListBaitStatisticsOptions): Promise<BaitStatistic[]> {
  if (baseId.length === 0) {
    throw new Error('Для статистики укажите одну рыболовную базу');
  }

  const query = new URLSearchParams({ fishId, baseId });
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/baits?${query}`, { signal });
  return decodeBaitStatisticsResponse(payload);
}
