import { apiRequest } from './api-client';
import {
  BASE_FISH_WEIGHT_CLASSIFICATIONS,
  type BaseFishWeightClassification,
} from './base-fish-weight';

export type WeightStatistics = Record<BaseFishWeightClassification, number>;

export type ListWeightStatisticsOptions = {
  fishId: string;
  baseIds: readonly string[];
  signal?: AbortSignal;
};

const MAX_BASE_IDS = 100;

function invalidResponse(): never {
  throw new Error('Сервер вернул некорректную статистику веса');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function decodeWeightStatistics(payload: unknown): WeightStatistics {
  if (!isRecord(payload) || Object.keys(payload).length !== 1 || !isRecord(payload.counts)) {
    invalidResponse();
  }
  const counts = payload.counts;
  if (!isRecord(counts)) invalidResponse();
  const keys = Object.keys(counts);
  if (
    keys.length !== BASE_FISH_WEIGHT_CLASSIFICATIONS.length ||
    !keys.every((key) =>
      BASE_FISH_WEIGHT_CLASSIFICATIONS.includes(key as BaseFishWeightClassification),
    )
  ) {
    invalidResponse();
  }

  return Object.fromEntries(
    BASE_FISH_WEIGHT_CLASSIFICATIONS.map((classification) => {
      const count = counts[classification];
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
        invalidResponse();
      }
      return [classification, count];
    }),
  ) as WeightStatistics;
}

export async function listWeightStatistics({
  fishId,
  baseIds,
  signal,
}: ListWeightStatisticsOptions): Promise<WeightStatistics> {
  const canonicalBaseIds = [...new Set(baseIds)].sort();
  if (canonicalBaseIds.length === 0) {
    throw new Error('Для статистики веса укажите хотя бы одну рыболовную базу');
  }
  if (canonicalBaseIds.length > MAX_BASE_IDS) {
    throw new Error(`Для статистики веса можно выбрать не более ${MAX_BASE_IDS} баз`);
  }

  const query = new URLSearchParams({ fishId, baseIds: canonicalBaseIds.join(',') });
  const payload = await apiRequest<unknown>(`/catch-reports/statistics/weights?${query}`, {
    signal,
  });
  return decodeWeightStatistics(payload);
}
