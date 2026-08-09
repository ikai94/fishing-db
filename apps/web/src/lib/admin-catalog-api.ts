import { apiRequest } from './api-client';
import type { BaitType } from './catalog-api';

export type CatalogStatus = 'all' | 'active' | 'inactive';

type AdminCatalogEntity = {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminFishingBase = AdminCatalogEntity;

export type AdminLocation = AdminCatalogEntity & {
  fishingBaseId: string;
  number: number;
};

export type AdminLocationSummary = AdminCatalogEntity & {
  number: number;
};

export type AdminFishingBaseDetail = AdminFishingBase & {
  locations: AdminLocationSummary[];
};

export type AdminFish = AdminCatalogEntity;

export type AdminBait = AdminCatalogEntity & {
  type: BaitType;
};

export type AdminLocationFish = {
  id: string;
  name: string;
  isActive: boolean;
  relationCreatedAt: string;
};

export type AdminLocationDetail = AdminLocation & {
  fishingBase: {
    id: string;
    name: string;
    isActive: boolean;
  };
  fish: AdminLocationFish[];
};

export type CreateFishingBaseInput = { name: string };
export type UpdateFishingBaseInput = { name?: string; isActive?: boolean };
export type CreateLocationInput = { name: string; number: number };
export type UpdateLocationInput = { name?: string; number?: number; isActive?: boolean };
export type CreateFishInput = { name: string };
export type UpdateFishInput = { name?: string; isActive?: boolean };
export type CreateBaitInput = { name: string; type: BaitType };
export type UpdateBaitInput = { name?: string; type?: BaitType; isActive?: boolean };

export type LocationFishRelation = {
  locationId: string;
  fishId: string;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readAdminEntity(value: unknown): AdminCatalogEntity {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.isActive !== 'boolean' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return {
    id: value.id,
    name: value.name,
    isActive: value.isActive,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readLocation(value: unknown): AdminLocation {
  const location = readLocationSummary(value);

  if (!isRecord(value) || typeof value.fishingBaseId !== 'string') {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return { ...location, fishingBaseId: value.fishingBaseId };
}

function readLocationSummary(value: unknown): AdminLocationSummary {
  const entity = readAdminEntity(value);

  if (!isRecord(value) || typeof value.number !== 'number' || !Number.isInteger(value.number)) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return { ...entity, number: value.number };
}

function readFish(value: unknown): AdminFish {
  return readAdminEntity(value);
}

function readBait(value: unknown): AdminBait {
  const entity = readAdminEntity(value);

  if (!isRecord(value) || (value.type !== 'BAIT' && value.type !== 'LURE')) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return { ...entity, type: value.type };
}

function readItems<T>(payload: unknown, reader: (value: unknown) => T): T[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return payload.items.map(reader);
}

function readEntityResponse<T>(
  payload: unknown,
  field: 'base' | 'location' | 'fish' | 'bait',
  reader: (value: unknown) => T,
): T {
  if (!isRecord(payload)) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return reader(payload[field]);
}

function readFishingBaseDetail(payload: unknown): AdminFishingBaseDetail {
  if (!isRecord(payload) || !isRecord(payload.base) || !Array.isArray(payload.base.locations)) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return {
    ...readAdminEntity(payload.base),
    locations: payload.base.locations.map(readLocationSummary),
  };
}

function readLocationDetail(payload: unknown): AdminLocationDetail {
  if (
    !isRecord(payload) ||
    !isRecord(payload.location) ||
    !isRecord(payload.location.fishingBase) ||
    !Array.isArray(payload.location.fish)
  ) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  const fishingBase = payload.location.fishingBase;

  if (
    typeof fishingBase.id !== 'string' ||
    typeof fishingBase.name !== 'string' ||
    typeof fishingBase.isActive !== 'boolean'
  ) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return {
    ...readLocation(payload.location),
    fishingBase: {
      id: fishingBase.id,
      name: fishingBase.name,
      isActive: fishingBase.isActive,
    },
    fish: payload.location.fish.map((value): AdminLocationFish => {
      if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.isActive !== 'boolean' ||
        typeof value.relationCreatedAt !== 'string'
      ) {
        throw new Error('Сервер вернул некорректный ответ административного каталога');
      }

      return {
        id: value.id,
        name: value.name,
        isActive: value.isActive,
        relationCreatedAt: value.relationCreatedAt,
      };
    }),
  };
}

function statusQuery(status: CatalogStatus): string {
  return `?status=${encodeURIComponent(status)}`;
}

export async function listAdminFishingBases(
  status: CatalogStatus = 'all',
  signal?: AbortSignal,
): Promise<AdminFishingBase[]> {
  const payload = await apiRequest<unknown>(`/admin/catalog/bases${statusQuery(status)}`, {
    signal,
  });
  return readItems(payload, readAdminEntity);
}

export async function createFishingBase(input: CreateFishingBaseInput): Promise<AdminFishingBase> {
  const payload = await apiRequest<unknown>('/admin/catalog/bases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'base', readAdminEntity);
}

export async function getAdminFishingBase(
  baseId: string,
  signal?: AbortSignal,
): Promise<AdminFishingBaseDetail> {
  const payload = await apiRequest<unknown>(`/admin/catalog/bases/${encodeURIComponent(baseId)}`, {
    signal,
  });
  return readFishingBaseDetail(payload);
}

export async function updateFishingBase(
  baseId: string,
  input: UpdateFishingBaseInput,
): Promise<AdminFishingBase> {
  const payload = await apiRequest<unknown>(`/admin/catalog/bases/${encodeURIComponent(baseId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'base', readAdminEntity);
}

export async function createLocation(
  baseId: string,
  input: CreateLocationInput,
): Promise<AdminLocation> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/bases/${encodeURIComponent(baseId)}/locations`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return readEntityResponse(payload, 'location', readLocation);
}

export async function getAdminLocation(
  locationId: string,
  signal?: AbortSignal,
): Promise<AdminLocationDetail> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/locations/${encodeURIComponent(locationId)}`,
    { signal },
  );
  return readLocationDetail(payload);
}

export async function updateLocation(
  locationId: string,
  input: UpdateLocationInput,
): Promise<AdminLocation> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/locations/${encodeURIComponent(locationId)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return readEntityResponse(payload, 'location', readLocation);
}

export async function listAdminFish(
  status: CatalogStatus = 'all',
  signal?: AbortSignal,
): Promise<AdminFish[]> {
  const payload = await apiRequest<unknown>(`/admin/catalog/fish${statusQuery(status)}`, {
    signal,
  });
  return readItems(payload, readFish);
}

export async function createFish(input: CreateFishInput): Promise<AdminFish> {
  const payload = await apiRequest<unknown>('/admin/catalog/fish', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'fish', readFish);
}

export async function updateFish(fishId: string, input: UpdateFishInput): Promise<AdminFish> {
  const payload = await apiRequest<unknown>(`/admin/catalog/fish/${encodeURIComponent(fishId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'fish', readFish);
}

export async function listAdminBaits(
  status: CatalogStatus = 'all',
  signal?: AbortSignal,
): Promise<AdminBait[]> {
  const payload = await apiRequest<unknown>(`/admin/catalog/baits${statusQuery(status)}`, {
    signal,
  });
  return readItems(payload, readBait);
}

export async function createBait(input: CreateBaitInput): Promise<AdminBait> {
  const payload = await apiRequest<unknown>('/admin/catalog/baits', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'bait', readBait);
}

export async function updateBait(baitId: string, input: UpdateBaitInput): Promise<AdminBait> {
  const payload = await apiRequest<unknown>(`/admin/catalog/baits/${encodeURIComponent(baitId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return readEntityResponse(payload, 'bait', readBait);
}

export async function addFishToLocation(
  locationId: string,
  fishId: string,
): Promise<LocationFishRelation> {
  const payload = await apiRequest<unknown>(
    `/admin/catalog/locations/${encodeURIComponent(locationId)}/fish`,
    { method: 'POST', body: JSON.stringify({ fishId }) },
  );

  if (!isRecord(payload) || !isRecord(payload.locationFish)) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  const relation = payload.locationFish;

  if (
    typeof relation.locationId !== 'string' ||
    typeof relation.fishId !== 'string' ||
    typeof relation.createdAt !== 'string'
  ) {
    throw new Error('Сервер вернул некорректный ответ административного каталога');
  }

  return {
    locationId: relation.locationId,
    fishId: relation.fishId,
    createdAt: relation.createdAt,
  };
}

export async function removeFishFromLocation(locationId: string, fishId: string): Promise<void> {
  await apiRequest<void>(
    `/admin/catalog/locations/${encodeURIComponent(locationId)}/fish/${encodeURIComponent(fishId)}`,
    { method: 'DELETE' },
  );
}
