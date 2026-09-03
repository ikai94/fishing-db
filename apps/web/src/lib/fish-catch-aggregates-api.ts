import { apiRequest } from './api-client';
import { isBaseFishWeightClassification, type BaseFishWeightAssessment } from './base-fish-weight';
import type { SpinningSize, SpinningSpeed } from './catch-reports-api';

export type FishCatchSpinningCombination = {
  spinningSpeed: SpinningSpeed | null;
  spinningSize: SpinningSize | null;
};

export type FishCatchTextSummary = {
  distinctCount: number;
  value: string | null;
};

export type FishCatchHoleSpotSummary = {
  distinctCount: number;
  value: {
    holeDepthCm: number | null;
    spotPositionRaw: string | null;
  } | null;
};

export type FishCatchAggregate = {
  fish: { id: string; name: string };
  fishingBase: { id: string; name: string };
  location: { id: string; number: number; name: string };
  bait: { id: string; name: string; isActive: boolean };
  spinningCombinations: FishCatchSpinningCombination[];
  holeSpotSummary: FishCatchHoleSpotSummary;
  userNoteRawSummary: FishCatchTextSummary;
  intensity: number;
  contributorCount: number;
  maxObservedWeightGrams: number;
  maxObservedWeightAssessment: BaseFishWeightAssessment;
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
  'spinningCombinations',
  'holeSpotSummary',
  'userNoteRawSummary',
  'intensity',
  'contributorCount',
  'maxObservedWeightGrams',
  'maxObservedWeightAssessment',
] as const;
const NAMED_KEYS = ['id', 'name'] as const;
const LOCATION_KEYS = ['id', 'number', 'name'] as const;
const BAIT_KEYS = ['id', 'name', 'isActive'] as const;
const COMBINATION_KEYS = ['spinningSpeed', 'spinningSize'] as const;
const TEXT_SUMMARY_KEYS = ['distinctCount', 'value'] as const;
const HOLE_SPOT_VALUE_KEYS = ['holeDepthCm', 'spotPositionRaw'] as const;
const SPINNING_SIZES = new Set<SpinningSize>(['SMALL', 'MEDIUM', 'LARGE']);
const SPINNING_SPEEDS = new Set<SpinningSpeed>(['SLOW', 'MEDIUM', 'FAST']);

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

function readTextSummary(value: unknown, intensity: number): FishCatchTextSummary {
  if (!isRecord(value) || !hasExactKeys(value, TEXT_SUMMARY_KEYS)) invalidResponse();

  const distinctCount = value.distinctCount;
  const singleValue = value.value;
  if (
    typeof distinctCount !== 'number' ||
    !Number.isSafeInteger(distinctCount) ||
    distinctCount < 0 ||
    distinctCount > intensity ||
    (distinctCount === 1 && (typeof singleValue !== 'string' || singleValue.length === 0)) ||
    (distinctCount !== 1 && singleValue !== null)
  ) {
    invalidResponse();
  }

  return { distinctCount, value: singleValue as string | null };
}

function readHoleSpotSummary(value: unknown, intensity: number): FishCatchHoleSpotSummary {
  if (!isRecord(value) || !hasExactKeys(value, TEXT_SUMMARY_KEYS)) invalidResponse();

  const distinctCount = value.distinctCount;
  const singleValue = value.value;
  if (
    typeof distinctCount !== 'number' ||
    !Number.isSafeInteger(distinctCount) ||
    distinctCount < 0 ||
    distinctCount > intensity
  ) {
    invalidResponse();
  }
  if (distinctCount !== 1) {
    if (singleValue !== null) invalidResponse();
    return { distinctCount, value: null };
  }
  if (!isRecord(singleValue) || !hasExactKeys(singleValue, HOLE_SPOT_VALUE_KEYS)) {
    invalidResponse();
  }

  const holeDepthCm = singleValue.holeDepthCm;
  const spotPositionRaw = singleValue.spotPositionRaw;
  if (
    (holeDepthCm !== null &&
      (typeof holeDepthCm !== 'number' || !Number.isSafeInteger(holeDepthCm) || holeDepthCm < 1)) ||
    (spotPositionRaw !== null &&
      (typeof spotPositionRaw !== 'string' || spotPositionRaw.length === 0)) ||
    (holeDepthCm === null && spotPositionRaw === null)
  ) {
    invalidResponse();
  }

  return {
    distinctCount,
    value: {
      holeDepthCm: holeDepthCm as number | null,
      spotPositionRaw: spotPositionRaw as string | null,
    },
  };
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

function readNullablePositiveSafeInteger(value: unknown): number | null {
  return value === null ? null : readPositiveSafeInteger(value);
}

function readWeightAssessment(value: unknown): BaseFishWeightAssessment {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['classification', 'minWeightGrams', 'maxWeightGrams']) ||
    !isBaseFishWeightClassification(value.classification)
  ) {
    invalidResponse();
  }
  const minWeightGrams = readNullablePositiveSafeInteger(value.minWeightGrams);
  const maxWeightGrams = readNullablePositiveSafeInteger(value.maxWeightGrams);
  if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
    invalidResponse();
  }
  return { classification: value.classification, minWeightGrams, maxWeightGrams };
}

function readSpinningCombinations(value: unknown): FishCatchSpinningCombination[] {
  if (!Array.isArray(value)) invalidResponse();

  const identities = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, COMBINATION_KEYS)) invalidResponse();

    const spinningSpeed = item.spinningSpeed;
    const spinningSize = item.spinningSize;
    if (
      (spinningSpeed !== null &&
        (typeof spinningSpeed !== 'string' ||
          !SPINNING_SPEEDS.has(spinningSpeed as SpinningSpeed))) ||
      (spinningSize !== null &&
        (typeof spinningSize !== 'string' || !SPINNING_SIZES.has(spinningSize as SpinningSize))) ||
      (spinningSpeed === null && spinningSize === null)
    ) {
      invalidResponse();
    }

    const identity = `${spinningSpeed ?? ''}\0${spinningSize ?? ''}`;
    if (identities.has(identity)) invalidResponse();
    identities.add(identity);

    return {
      spinningSpeed: spinningSpeed as SpinningSpeed | null,
      spinningSize: spinningSize as SpinningSize | null,
    };
  });
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
    spinningCombinations: readSpinningCombinations(value.spinningCombinations),
    holeSpotSummary: readHoleSpotSummary(value.holeSpotSummary, intensity),
    userNoteRawSummary: readTextSummary(value.userNoteRawSummary, intensity),
    intensity,
    contributorCount,
    maxObservedWeightGrams: readPositiveSafeInteger(value.maxObservedWeightGrams),
    maxObservedWeightAssessment: readWeightAssessment(value.maxObservedWeightAssessment),
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
  if (canonicalBaseIds.length > MAX_BASE_IDS) {
    throw new Error(`Для агрегированных уловов можно выбрать не более ${MAX_BASE_IDS} баз`);
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    throw new Error('Лимит агрегированных уловов должен быть от 1 до 100');
  }

  const query = new URLSearchParams({ fishId });
  if (canonicalBaseIds.length > 0) query.set('baseIds', canonicalBaseIds.join(','));
  if (limit !== undefined) query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);

  const payload = await apiRequest<unknown>(
    `/catch-reports/statistics/fish-catches?${query.toString()}`,
    { signal },
  );
  const page = decodeFishCatchAggregatePage(payload);
  const selectedBaseIds = new Set(canonicalBaseIds);
  if (
    page.items.some(
      (item) =>
        item.fish.id !== fishId ||
        (selectedBaseIds.size > 0 && !selectedBaseIds.has(item.fishingBase.id)),
    )
  ) {
    invalidResponse();
  }
  return page;
}
