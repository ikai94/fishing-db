import { apiRequest } from './api-client';
import type { FishingMethod, FishingNote, SpinningSize, SpinningSpeed } from './catch-reports-api';

type FishingConditionStatisticCounts = {
  fishingNote: FishingNote | null;
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
};

export type FishingConditionStatistic =
  | (FishingConditionStatisticCounts & {
      fishingMethod: 'BAIT_FISHING';
      spinningSize: null;
      spinningSpeed: null;
    })
  | (FishingConditionStatisticCounts & {
      fishingMethod: 'SPINNING';
      spinningSize: SpinningSize;
      spinningSpeed: SpinningSpeed;
    });

export type ListFishingConditionStatisticsOptions = {
  fishId: string;
  baseIds: readonly string[];
  signal?: AbortSignal;
};

const MAX_BASE_IDS = 100;
const RESPONSE_KEYS = ['items'] as const;
const ITEM_KEYS = [
  'fishingMethod',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
  'uniqueUsersCount',
  'reportsCount',
  'latestReportCreatedAt',
] as const;
const FISHING_METHODS = new Set<FishingMethod>(['BAIT_FISHING', 'SPINNING']);
const FISHING_NOTES = new Set<FishingNote>(['MIDWATER', 'FROM_BOTTOM', 'SURFACE']);
const SPINNING_SIZES = new Set<SpinningSize>(['SMALL', 'MEDIUM', 'LARGE']);
const SPINNING_SPEEDS = new Set<SpinningSpeed>(['SLOW', 'MEDIUM', 'FAST']);

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректную статистику условий ловли');
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

function readTimestamp(value: unknown): string {
  if (typeof value !== 'string') invalidResponse();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    invalidResponse();
  }

  return value;
}

function readFishingMethod(value: unknown): FishingMethod {
  if (typeof value !== 'string' || !FISHING_METHODS.has(value as FishingMethod)) {
    invalidResponse();
  }

  return value as FishingMethod;
}

function readFishingNote(value: unknown): FishingNote | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !FISHING_NOTES.has(value as FishingNote)) {
    invalidResponse();
  }

  return value as FishingNote;
}

function readSpinningSize(value: unknown): SpinningSize {
  if (typeof value !== 'string' || !SPINNING_SIZES.has(value as SpinningSize)) {
    invalidResponse();
  }

  return value as SpinningSize;
}

function readSpinningSpeed(value: unknown): SpinningSpeed {
  if (typeof value !== 'string' || !SPINNING_SPEEDS.has(value as SpinningSpeed)) {
    invalidResponse();
  }

  return value as SpinningSpeed;
}

export function decodeFishingConditionStatistic(value: unknown): FishingConditionStatistic {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_KEYS)) invalidResponse();

  const fishingMethod = readFishingMethod(value.fishingMethod);
  const fishingNote = readFishingNote(value.fishingNote);
  const uniqueUsersCount = readPositiveInteger(value.uniqueUsersCount);
  const reportsCount = readPositiveInteger(value.reportsCount);
  if (uniqueUsersCount > reportsCount) invalidResponse();

  const common = {
    fishingNote,
    uniqueUsersCount,
    reportsCount,
    latestReportCreatedAt: readTimestamp(value.latestReportCreatedAt),
  };

  if (fishingMethod === 'BAIT_FISHING') {
    if (value.spinningSize !== null || value.spinningSpeed !== null) invalidResponse();

    return {
      fishingMethod,
      spinningSize: null,
      spinningSpeed: null,
      ...common,
    };
  }

  return {
    fishingMethod,
    spinningSize: readSpinningSize(value.spinningSize),
    spinningSpeed: readSpinningSpeed(value.spinningSpeed),
    ...common,
  };
}

export function decodeFishingConditionStatisticsResponse(
  payload: unknown,
): FishingConditionStatistic[] {
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, RESPONSE_KEYS) ||
    !Array.isArray(payload.items)
  ) {
    invalidResponse();
  }

  const identities = new Set<string>();
  return payload.items.map((value) => {
    const item = decodeFishingConditionStatistic(value);
    const identity = JSON.stringify([
      item.fishingMethod,
      item.fishingNote,
      item.spinningSize,
      item.spinningSpeed,
    ]);
    if (identities.has(identity)) invalidResponse();
    identities.add(identity);
    return item;
  });
}

export async function listFishingConditionStatistics({
  fishId,
  baseIds,
  signal,
}: ListFishingConditionStatisticsOptions): Promise<FishingConditionStatistic[]> {
  const canonicalBaseIds = [...new Set(baseIds)].sort();
  if (canonicalBaseIds.length === 0) {
    throw new Error('Для статистики укажите хотя бы одну рыболовную базу');
  }
  if (canonicalBaseIds.length > MAX_BASE_IDS) {
    throw new Error(`Для статистики можно выбрать не более ${MAX_BASE_IDS} рыболовных баз`);
  }

  const query = new URLSearchParams({ fishId, baseIds: canonicalBaseIds.join(',') });
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/conditions?${query}`, {
    signal,
  });
  return decodeFishingConditionStatisticsResponse(payload);
}
