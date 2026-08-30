import { apiRequest } from './api-client';

export type BaitType = 'BAIT' | 'LURE';

export type PublicCatalogItem = {
  id: string;
  name: string;
};

export type PublicFishingBaseSummary = PublicCatalogItem & {
  locationsCount: number;
  fishCount: number;
};

export type PublicLocationSummary = PublicCatalogItem & {
  number: number;
};

export type PublicFishingBase = PublicCatalogItem & {
  locations: PublicLocationSummary[];
  fish: PublicCatalogItem[];
};

export type PublicLocation = PublicLocationSummary & {
  fishingBase: PublicCatalogItem;
};

export type PublicFishImage = {
  url: string;
};

export type PublicFishSummary = PublicCatalogItem & {
  image: PublicFishImage | null;
};

export type PublicFishDetail = PublicFishSummary & {
  bases: PublicCatalogItem[];
};

export type PublicBait = PublicCatalogItem & {
  type: BaitType;
};

export type PublicScreenAnchor = PublicCatalogItem;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCatalogItem(value: unknown): PublicCatalogItem {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return { id: value.id, name: value.name };
}

function readFishImage(value: unknown): PublicFishImage | null {
  if (value === null) {
    return null;
  }

  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.url !== 'string' ||
    value.url.trim() === '' ||
    !value.url.startsWith('/') ||
    value.url.startsWith('//')
  ) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return { url: value.url };
}

function readFishSummary(value: unknown): PublicFishSummary {
  const item = readCatalogItem(value);

  if (!isRecord(value) || !('image' in value)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return { ...item, image: readFishImage(value.image) };
}

function readLocationSummary(value: unknown): PublicLocationSummary {
  const item = readCatalogItem(value);

  if (!isRecord(value) || typeof value.number !== 'number' || !Number.isInteger(value.number)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return { ...item, number: value.number };
}

function readNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return value;
}

function readFishingBaseSummary(value: unknown): PublicFishingBaseSummary {
  const item = readCatalogItem(value);

  if (!isRecord(value)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return {
    ...item,
    locationsCount: readNonNegativeInteger(value.locationsCount),
    fishCount: readNonNegativeInteger(value.fishCount),
  };
}

function readItems<T>(payload: unknown, reader: (value: unknown) => T): T[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return payload.items.map(reader);
}

function readFishingBaseResponse(payload: unknown): PublicFishingBase {
  if (
    !isRecord(payload) ||
    !isRecord(payload.base) ||
    !Array.isArray(payload.base.locations) ||
    !Array.isArray(payload.base.fish)
  ) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return {
    ...readCatalogItem(payload.base),
    locations: payload.base.locations.map(readLocationSummary),
    fish: payload.base.fish.map(readCatalogItem),
  };
}

function readLocationResponse(payload: unknown): PublicLocation {
  if (!isRecord(payload) || !isRecord(payload.location)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return {
    ...readLocationSummary(payload.location),
    fishingBase: readCatalogItem(payload.location.fishingBase),
  };
}

function readFishResponse(payload: unknown): PublicFishDetail {
  if (!isRecord(payload) || !isRecord(payload.fish) || !Array.isArray(payload.fish.bases)) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return {
    ...readFishSummary(payload.fish),
    bases: payload.fish.bases.map(readCatalogItem),
  };
}

function readBait(value: unknown): PublicBait {
  const item = readCatalogItem(value);

  if (!isRecord(value) || (value.type !== 'BAIT' && value.type !== 'LURE')) {
    throw new Error('Сервер вернул некорректный ответ каталога');
  }

  return { ...item, type: value.type };
}

export async function listFishingBases(signal?: AbortSignal): Promise<PublicFishingBaseSummary[]> {
  const payload = await apiRequest<unknown>('/catalog/bases', { signal });
  return readItems(payload, readFishingBaseSummary);
}

export async function getFishingBase(
  baseId: string,
  signal?: AbortSignal,
): Promise<PublicFishingBase> {
  const payload = await apiRequest<unknown>(`/catalog/bases/${encodeURIComponent(baseId)}`, {
    signal,
  });
  return readFishingBaseResponse(payload);
}

export async function getLocation(
  locationId: string,
  signal?: AbortSignal,
): Promise<PublicLocation> {
  const payload = await apiRequest<unknown>(
    `/catalog/locations/${encodeURIComponent(locationId)}`,
    { signal },
  );
  return readLocationResponse(payload);
}

export async function listFish(signal?: AbortSignal): Promise<PublicFishSummary[]> {
  const payload = await apiRequest<unknown>('/catalog/fish', { signal });
  return readItems(payload, readFishSummary);
}

export async function getFish(fishId: string, signal?: AbortSignal): Promise<PublicFishDetail> {
  const payload = await apiRequest<unknown>(`/catalog/fish/${encodeURIComponent(fishId)}`, {
    signal,
  });
  return readFishResponse(payload);
}

export async function listBaits(signal?: AbortSignal): Promise<PublicBait[]> {
  const payload = await apiRequest<unknown>('/catalog/baits', { signal });
  return readItems(payload, readBait);
}

export async function listScreenAnchors(signal?: AbortSignal): Promise<PublicScreenAnchor[]> {
  const payload = await apiRequest<unknown>('/catalog/screen-anchors', { signal });
  return readItems(payload, readCatalogItem);
}
