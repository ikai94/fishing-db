import { apiRequest } from './api-client';
import type { BaitType } from './catalog-api';

export type SpotLandmark = 'ROD' | 'NOTEBOOK' | 'BACKPACK' | 'REEL' | 'CHAT' | 'TACKLE';

export type FishingNote = 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE';

export type CatchReport = {
  id: string;
  author: {
    id: string;
    nickname: string;
  };
  fishingBase: {
    id: string;
    name: string;
  };
  location: {
    id: string;
    number: number;
    name: string;
  };
  fish: {
    id: string;
    name: string;
  };
  bait: {
    id: string;
    name: string;
    type: BaitType;
  };
  weightGrams: number;
  holeDepthCm: number | null;
  spotLandmark: SpotLandmark | null;
  fishingNote: FishingNote | null;
  userNoteRaw: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CatchReportPage = {
  items: CatchReport[];
  nextCursor: string | null;
};

export type CreateCatchReportInput = {
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  holeDepthCm?: number | null;
  spotLandmark?: SpotLandmark | null;
  fishingNote?: FishingNote | null;
  userNoteRaw?: string | null;
};

export type UpdateCatchReportInput = Partial<CreateCatchReportInput>;

type ListCatchReportsOptions = {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

const SPOT_LANDMARKS = new Set<SpotLandmark>([
  'ROD',
  'NOTEBOOK',
  'BACKPACK',
  'REEL',
  'CHAT',
  'TACKLE',
]);
const FISHING_NOTES = new Set<FishingNote>(['MIDWATER', 'FROM_BOTTOM', 'SURFACE']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNamedItem(value: unknown): { id: string; name: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error('Сервер вернул некорректный отчёт об улове');
  }

  return { id: value.id, name: value.name };
}

function readNullableEnum<T extends string>(
  value: unknown,
  allowedValues: ReadonlySet<T>,
): T | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !allowedValues.has(value as T)) {
    throw new Error('Сервер вернул некорректный отчёт об улове');
  }

  return value as T;
}

function readCatchReport(value: unknown): CatchReport {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isRecord(value.author) ||
    typeof value.author.id !== 'string' ||
    typeof value.author.nickname !== 'string' ||
    !isRecord(value.location) ||
    typeof value.location.number !== 'number' ||
    !Number.isInteger(value.location.number) ||
    !isRecord(value.bait) ||
    (value.bait.type !== 'BAIT' && value.bait.type !== 'LURE') ||
    typeof value.weightGrams !== 'number' ||
    !Number.isInteger(value.weightGrams) ||
    value.weightGrams <= 0 ||
    value.weightGrams > 2_147_483_647 ||
    (value.holeDepthCm !== null &&
      (typeof value.holeDepthCm !== 'number' ||
        !Number.isInteger(value.holeDepthCm) ||
        value.holeDepthCm <= 0 ||
        value.holeDepthCm > 2_147_483_647)) ||
    (value.userNoteRaw !== null && typeof value.userNoteRaw !== 'string') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('Сервер вернул некорректный отчёт об улове');
  }

  const fishingBase = readNamedItem(value.fishingBase);
  const location = readNamedItem(value.location);
  const fish = readNamedItem(value.fish);
  const bait = readNamedItem(value.bait);

  return {
    id: value.id,
    author: { id: value.author.id, nickname: value.author.nickname },
    fishingBase,
    location: { ...location, number: value.location.number },
    fish,
    bait: { ...bait, type: value.bait.type },
    weightGrams: value.weightGrams,
    holeDepthCm: value.holeDepthCm,
    spotLandmark: readNullableEnum(value.spotLandmark, SPOT_LANDMARKS),
    fishingNote: readNullableEnum(value.fishingNote, FISHING_NOTES),
    userNoteRaw: value.userNoteRaw,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readCatchReportResponse(payload: unknown): CatchReport {
  if (!isRecord(payload)) {
    throw new Error('Сервер вернул некорректный ответ');
  }

  return readCatchReport(payload.report);
}

function readCatchReportPage(payload: unknown): CatchReportPage {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.items) ||
    (payload.nextCursor !== null && typeof payload.nextCursor !== 'string')
  ) {
    throw new Error('Сервер вернул некорректный список отчётов об уловах');
  }

  return {
    items: payload.items.map(readCatchReport),
    nextCursor: payload.nextCursor,
  };
}

function buildListPath(path: string, options: ListCatchReportsOptions): string {
  const query = new URLSearchParams();

  if (options.limit !== undefined) {
    query.set('limit', String(options.limit));
  }

  if (options.cursor) {
    query.set('cursor', options.cursor);
  }

  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export async function listCatchReports(
  options: ListCatchReportsOptions = {},
): Promise<CatchReportPage> {
  const payload = await apiRequest<unknown>(buildListPath('/catch-reports', options), {
    signal: options.signal,
  });
  return readCatchReportPage(payload);
}

export async function listMyCatchReports(
  options: ListCatchReportsOptions = {},
): Promise<CatchReportPage> {
  const payload = await apiRequest<unknown>(buildListPath('/me/catch-reports', options), {
    signal: options.signal,
  });
  return readCatchReportPage(payload);
}

export async function getCatchReport(reportId: string, signal?: AbortSignal): Promise<CatchReport> {
  const payload = await apiRequest<unknown>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    signal,
  });
  return readCatchReportResponse(payload);
}

export async function createCatchReport(input: CreateCatchReportInput): Promise<CatchReport> {
  const payload = await apiRequest<unknown>('/catch-reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readCatchReportResponse(payload);
}

export async function updateCatchReport(
  reportId: string,
  input: UpdateCatchReportInput,
): Promise<CatchReport> {
  const payload = await apiRequest<unknown>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return readCatchReportResponse(payload);
}

export async function deleteCatchReport(reportId: string): Promise<void> {
  await apiRequest<void>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
  });
}
