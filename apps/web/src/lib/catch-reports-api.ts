import { apiRequest } from './api-client';
import type { BaitType } from './catalog-api';

export type FishingMethod = 'BAIT_FISHING' | 'SPINNING';
export type FishingNote = 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE';
export type SpinningSize = 'SMALL' | 'MEDIUM' | 'LARGE';
export type SpinningSpeed = 'SLOW' | 'MEDIUM' | 'FAST';

export type CatchReport = {
  id: string;
  author: { id: string; nickname: string };
  fishingBase: { id: string; name: string };
  location: { id: string; number: number; name: string };
  fish: { id: string; name: string };
  bait: { id: string; name: string };
  weightGrams: number;
  fishingMethod: FishingMethod;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: FishingNote | null;
  spinningSize: SpinningSize | null;
  spinningSpeed: SpinningSpeed | null;
  userNoteRaw: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OwnerCatchReport = CatchReport & {
  rawSourceText: string | null;
};

export type CatchReportPage = {
  items: CatchReport[];
  nextCursor: string | null;
};

export type ObservedFish = {
  fish: { id: string; name: string; isActive: boolean };
  contributorCount: number;
  reportCount: number;
};

export type LocationObservations = {
  observedFish: ObservedFish[];
  reports: CatchReport[];
};

export type CreateCatchReportInput = {
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  holeDepthCm?: number | null;
  spotPositionRaw?: string | null;
  fishingNote?: FishingNote | null;
  spinningSize?: SpinningSize | null;
  spinningSpeed?: SpinningSpeed | null;
  userNoteRaw?: string | null;
  rawSourceText?: string | null;
};

export type UpdateCatchReportInput = Partial<Omit<CreateCatchReportInput, 'rawSourceText'>>;

export type DraftStatus = 'RESOLVED' | 'MISSING' | 'UNRESOLVED';
export type DraftIssueSeverity = 'BLOCKING' | 'WARNING';

export type DraftField<T> =
  | { status: 'RESOLVED'; sourceText: string | null; value: T | null; required: boolean }
  | { status: 'MISSING'; sourceText: null; value: null; required: true }
  | {
      status: 'UNRESOLVED';
      sourceText: string;
      value: null;
      required: boolean;
      code: string;
    };

export type CatchReportDraft = {
  rawSourceText: string;
  fields: {
    fishingBase: DraftField<{ id: string; name: string }>;
    location: DraftField<{ id: string; number: number; name: string }>;
    fish: DraftField<{ id: string; name: string }>;
    bait: DraftField<{ id: string; name: string; type: BaitType }>;
    weightGrams: DraftField<number>;
    fishingMethod: DraftField<FishingMethod>;
    holeDepthCm: DraftField<number>;
    spotPositionRaw: DraftField<string>;
    fishingNote: DraftField<FishingNote>;
    spinningSize: DraftField<SpinningSize>;
    spinningSpeed: DraftField<SpinningSpeed>;
    userNoteRaw: DraftField<string>;
  };
  baseFishMembership: {
    status: DraftStatus;
    baseId: string | null;
    fishId: string | null;
  };
  issues: Array<{
    severity: DraftIssueSeverity;
    code: string;
    field?: string;
    message: string;
  }>;
  unresolvedFragments: Array<{ text: string; start: number; end: number }>;
  missingRequiredFields: string[];
  canConfirm: boolean;
};

export type CatchReportBatchDraftRow = {
  index: number;
  sourceLine: number;
  duplicateIndexes: number[];
  draft: CatchReportDraft;
};

export type ParseCatchReportBatchResult = {
  rows: CatchReportBatchDraftRow[];
};

export type CreateCatchReportsBatchResult = {
  createdCount: number;
  reportIds: string[];
};

export type CatchReportPaginationOptions = {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

export type PublicCatchReportListOptions = CatchReportPaginationOptions & {
  fishId?: string;
  baseIds?: string[];
};

const FISHING_METHODS = new Set<FishingMethod>(['BAIT_FISHING', 'SPINNING']);
const FISHING_NOTES = new Set<FishingNote>(['MIDWATER', 'FROM_BOTTOM', 'SURFACE']);
const SPINNING_SIZES = new Set<SpinningSize>(['SMALL', 'MEDIUM', 'LARGE']);
const SPINNING_SPEEDS = new Set<SpinningSpeed>(['SLOW', 'MEDIUM', 'FAST']);
const DRAFT_STATUSES = new Set<DraftStatus>(['RESOLVED', 'MISSING', 'UNRESOLVED']);
const DRAFT_SEVERITIES = new Set<DraftIssueSeverity>(['BLOCKING', 'WARNING']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidReport(): never {
  throw new Error('Сервер вернул некорректный отчёт об улове');
}

function invalidDraft(): never {
  throw new Error('Сервер вернул некорректный черновик улова');
}

function readNamedItem(value: unknown): { id: string; name: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    invalidReport();
  }

  return { id: value.id, name: value.name };
}

function readPositiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > 2_147_483_647
  ) {
    invalidReport();
  }

  return value;
}

function readNullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : readPositiveInteger(value);
}

function readEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    invalidReport();
  }

  return value as T;
}

function readNullableEnum<T extends string>(
  value: unknown,
  allowedValues: ReadonlySet<T>,
): T | null {
  return value === null ? null : readEnum(value, allowedValues);
}

/** Public projections are intentionally strict so owner-only raw source cannot leak silently. */
export function decodePublicCatchReport(value: unknown): CatchReport {
  if (
    !isRecord(value) ||
    'rawSourceText' in value ||
    'contributorKey' in value ||
    'importKey' in value ||
    typeof value.id !== 'string' ||
    !isRecord(value.author) ||
    typeof value.author.id !== 'string' ||
    typeof value.author.nickname !== 'string' ||
    !isRecord(value.location) ||
    typeof value.location.number !== 'number' ||
    !Number.isInteger(value.location.number) ||
    !isRecord(value.bait) ||
    'type' in value.bait ||
    (value.spotPositionRaw !== null && typeof value.spotPositionRaw !== 'string') ||
    (value.userNoteRaw !== null && typeof value.userNoteRaw !== 'string') ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    invalidReport();
  }

  const location = readNamedItem(value.location);

  return {
    id: value.id,
    author: { id: value.author.id, nickname: value.author.nickname },
    fishingBase: readNamedItem(value.fishingBase),
    location: { ...location, number: value.location.number },
    fish: readNamedItem(value.fish),
    bait: readNamedItem(value.bait),
    weightGrams: readPositiveInteger(value.weightGrams),
    fishingMethod: readEnum(value.fishingMethod, FISHING_METHODS),
    holeDepthCm: readNullablePositiveInteger(value.holeDepthCm),
    spotPositionRaw: value.spotPositionRaw,
    fishingNote: readNullableEnum(value.fishingNote, FISHING_NOTES),
    spinningSize: readNullableEnum(value.spinningSize, SPINNING_SIZES),
    spinningSpeed: readNullableEnum(value.spinningSpeed, SPINNING_SPEEDS),
    userNoteRaw: value.userNoteRaw,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function readObservedFish(value: unknown): ObservedFish {
  if (
    !isRecord(value) ||
    'contributorKey' in value ||
    'importKey' in value ||
    'rawSourceText' in value ||
    !isRecord(value.fish) ||
    typeof value.fish.isActive !== 'boolean'
  ) {
    invalidReport();
  }

  const contributorCount = readPositiveInteger(value.contributorCount);
  const reportCount = readPositiveInteger(value.reportCount);
  if (contributorCount > reportCount) invalidReport();

  return {
    fish: { ...readNamedItem(value.fish), isActive: value.fish.isActive },
    contributorCount,
    reportCount,
  };
}

export function decodeLocationObservations(
  payload: unknown,
  locationId: string,
): LocationObservations {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.observedFish) ||
    !Array.isArray(payload.reports)
  ) {
    throw new Error('Сервер вернул некорректные наблюдения локации');
  }

  const observedFish = payload.observedFish.map(readObservedFish);
  const reports = payload.reports.map(decodePublicCatchReport);
  const observedByFishId = new Map<string, ObservedFish>();
  const reportCounts = new Map<string, number>();

  for (const item of observedFish) {
    if (observedByFishId.has(item.fish.id)) invalidReport();
    observedByFishId.set(item.fish.id, item);
  }

  for (const report of reports) {
    if (report.location.id !== locationId) invalidReport();
    const observed = observedByFishId.get(report.fish.id);
    if (observed === undefined || observed.fish.name !== report.fish.name) invalidReport();
    reportCounts.set(report.fish.id, (reportCounts.get(report.fish.id) ?? 0) + 1);
  }

  if (observedByFishId.size !== reportCounts.size) invalidReport();
  for (const item of observedFish) {
    if (reportCounts.get(item.fish.id) !== item.reportCount) invalidReport();
  }

  return { observedFish, reports };
}

export function decodeOwnerCatchReport(value: unknown): OwnerCatchReport {
  if (
    !isRecord(value) ||
    (value.rawSourceText !== null && typeof value.rawSourceText !== 'string')
  ) {
    invalidReport();
  }

  const { rawSourceText, ...publicFields } = value;
  return { ...decodePublicCatchReport(publicFields), rawSourceText };
}

function readReportResponse<T>(payload: unknown, reader: (value: unknown) => T): T {
  if (!isRecord(payload)) {
    throw new Error('Сервер вернул некорректный ответ');
  }

  return reader(payload.report);
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
    items: payload.items.map(decodePublicCatchReport),
    nextCursor: payload.nextCursor,
  };
}

function readDraftCatalogItem(value: unknown): { id: string; name: string } {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    invalidDraft();
  }
  return { id: value.id, name: value.name };
}

function readDraftLocation(value: unknown): { id: string; number: number; name: string } {
  const item = readDraftCatalogItem(value);
  if (!isRecord(value) || typeof value.number !== 'number' || !Number.isInteger(value.number)) {
    invalidDraft();
  }
  return { ...item, number: value.number };
}

function readDraftBait(value: unknown): { id: string; name: string; type: BaitType } {
  const item = readDraftCatalogItem(value);
  if (!isRecord(value) || (value.type !== 'BAIT' && value.type !== 'LURE')) {
    invalidDraft();
  }
  return { ...item, type: value.type };
}

function readDraftField<T>(value: unknown, reader: (fieldValue: unknown) => T): DraftField<T> {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    !DRAFT_STATUSES.has(value.status as DraftStatus)
  ) {
    invalidDraft();
  }

  if (value.status === 'MISSING') {
    if (value.sourceText !== null || value.value !== null || value.required !== true) {
      invalidDraft();
    }
    return { status: 'MISSING', sourceText: null, value: null, required: true };
  }

  if (value.status === 'UNRESOLVED') {
    if (
      typeof value.sourceText !== 'string' ||
      value.value !== null ||
      typeof value.required !== 'boolean' ||
      typeof value.code !== 'string'
    ) {
      invalidDraft();
    }
    return {
      status: 'UNRESOLVED',
      sourceText: value.sourceText,
      value: null,
      required: value.required,
      code: value.code,
    };
  }

  if (
    (value.sourceText !== null && typeof value.sourceText !== 'string') ||
    typeof value.required !== 'boolean'
  ) {
    invalidDraft();
  }

  return {
    status: 'RESOLVED',
    sourceText: value.sourceText,
    value: value.value === null ? null : reader(value.value),
    required: value.required,
  };
}

function readDraftEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    invalidDraft();
  }
  return value as T;
}

function readDraftString(value: unknown): string {
  if (typeof value !== 'string') invalidDraft();
  return value;
}

function readDraftInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) invalidDraft();
  return value;
}

export function decodeCatchReportDraft(value: unknown): CatchReportDraft {
  if (
    !isRecord(value) ||
    typeof value.rawSourceText !== 'string' ||
    !isRecord(value.fields) ||
    !isRecord(value.baseFishMembership) ||
    !Array.isArray(value.issues) ||
    !Array.isArray(value.unresolvedFragments) ||
    !Array.isArray(value.missingRequiredFields) ||
    typeof value.canConfirm !== 'boolean'
  ) {
    invalidDraft();
  }

  const fields = value.fields;
  const membership = value.baseFishMembership;
  if (
    typeof membership.status !== 'string' ||
    !DRAFT_STATUSES.has(membership.status as DraftStatus) ||
    (membership.baseId !== null && typeof membership.baseId !== 'string') ||
    (membership.fishId !== null && typeof membership.fishId !== 'string')
  ) {
    invalidDraft();
  }

  const issues = value.issues.map((issue) => {
    if (
      !isRecord(issue) ||
      typeof issue.severity !== 'string' ||
      !DRAFT_SEVERITIES.has(issue.severity as DraftIssueSeverity) ||
      typeof issue.code !== 'string' ||
      typeof issue.message !== 'string' ||
      (issue.field !== undefined && typeof issue.field !== 'string')
    ) {
      invalidDraft();
    }
    return {
      severity: issue.severity as DraftIssueSeverity,
      code: issue.code,
      ...(issue.field === undefined ? {} : { field: issue.field }),
      message: issue.message,
    };
  });

  const unresolvedFragments = value.unresolvedFragments.map((fragment) => {
    if (
      !isRecord(fragment) ||
      typeof fragment.text !== 'string' ||
      typeof fragment.start !== 'number' ||
      !Number.isInteger(fragment.start) ||
      typeof fragment.end !== 'number' ||
      !Number.isInteger(fragment.end) ||
      fragment.start < 0 ||
      fragment.end < fragment.start
    ) {
      invalidDraft();
    }
    return { text: fragment.text, start: fragment.start, end: fragment.end };
  });

  if (!value.missingRequiredFields.every((field) => typeof field === 'string')) {
    invalidDraft();
  }

  return {
    rawSourceText: value.rawSourceText,
    fields: {
      fishingBase: readDraftField(fields.fishingBase, readDraftCatalogItem),
      location: readDraftField(fields.location, readDraftLocation),
      fish: readDraftField(fields.fish, readDraftCatalogItem),
      bait: readDraftField(fields.bait, readDraftBait),
      weightGrams: readDraftField(fields.weightGrams, readDraftInteger),
      fishingMethod: readDraftField(fields.fishingMethod, (fieldValue) =>
        readDraftEnum(fieldValue, FISHING_METHODS),
      ),
      holeDepthCm: readDraftField(fields.holeDepthCm, readDraftInteger),
      spotPositionRaw: readDraftField(fields.spotPositionRaw, readDraftString),
      fishingNote: readDraftField(fields.fishingNote, (fieldValue) =>
        readDraftEnum(fieldValue, FISHING_NOTES),
      ),
      spinningSize: readDraftField(fields.spinningSize, (fieldValue) =>
        readDraftEnum(fieldValue, SPINNING_SIZES),
      ),
      spinningSpeed: readDraftField(fields.spinningSpeed, (fieldValue) =>
        readDraftEnum(fieldValue, SPINNING_SPEEDS),
      ),
      userNoteRaw: readDraftField(fields.userNoteRaw, readDraftString),
    },
    baseFishMembership: {
      status: membership.status as DraftStatus,
      baseId: membership.baseId,
      fishId: membership.fishId,
    },
    issues,
    unresolvedFragments,
    missingRequiredFields: value.missingRequiredFields as string[],
    canConfirm: value.canConfirm,
  };
}

export function decodeCatchReportBatch(value: unknown): ParseCatchReportBatchResult {
  if (!isRecord(value) || !Array.isArray(value.rows)) invalidDraft();

  const rows = value.rows.map((row, position) => {
    if (
      !isRecord(row) ||
      row.index !== position ||
      typeof row.sourceLine !== 'number' ||
      !Number.isInteger(row.sourceLine) ||
      row.sourceLine < 1 ||
      !Array.isArray(row.duplicateIndexes) ||
      new Set(row.duplicateIndexes).size !== row.duplicateIndexes.length ||
      !row.duplicateIndexes.every(
        (index) =>
          typeof index === 'number' && Number.isInteger(index) && index >= 0 && index !== position,
      )
    ) {
      invalidDraft();
    }

    return {
      index: position,
      sourceLine: row.sourceLine,
      duplicateIndexes: [...new Set(row.duplicateIndexes as number[])],
      draft: decodeCatchReportDraft(row.draft),
    };
  });

  for (const [position, row] of rows.entries()) {
    if (
      (position > 0 && row.sourceLine <= (rows[position - 1]?.sourceLine ?? 0)) ||
      row.duplicateIndexes.some(
        (duplicateIndex) =>
          duplicateIndex >= rows.length ||
          !rows[duplicateIndex]?.duplicateIndexes.includes(position) ||
          rows[duplicateIndex]?.draft.rawSourceText !== row.draft.rawSourceText,
      )
    ) {
      invalidDraft();
    }
  }

  return { rows };
}

export function decodeCreateCatchReportsBatchResult(value: unknown): CreateCatchReportsBatchResult {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'createdCount' && key !== 'reportIds') ||
    typeof value.createdCount !== 'number' ||
    !Number.isInteger(value.createdCount) ||
    value.createdCount < 1 ||
    value.createdCount > 100 ||
    !Array.isArray(value.reportIds) ||
    value.reportIds.length !== value.createdCount ||
    !value.reportIds.every((reportId) => typeof reportId === 'string' && reportId.length > 0) ||
    new Set(value.reportIds).size !== value.reportIds.length
  ) {
    invalidReport();
  }

  return { createdCount: value.createdCount, reportIds: value.reportIds as string[] };
}

function buildPaginationQuery(options: CatchReportPaginationOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor) query.set('cursor', options.cursor);
  return query;
}

function buildPublicListPath(options: PublicCatchReportListOptions): string {
  const query = buildPaginationQuery(options);
  if (options.fishId) query.set('fishId', options.fishId);
  if (options.baseIds !== undefined) {
    const baseIds = [...new Set(options.baseIds)].sort();
    if (baseIds.length === 0) {
      throw new Error('Для фильтра укажите хотя бы одну рыболовную базу');
    }
    query.set('baseIds', baseIds.join(','));
  }
  const search = query.toString();
  return search ? `/catch-reports?${search}` : '/catch-reports';
}

function buildPaginationPath(path: string, options: CatchReportPaginationOptions): string {
  const search = buildPaginationQuery(options).toString();
  return search ? `${path}?${search}` : path;
}

export async function listCatchReports(
  options: PublicCatchReportListOptions = {},
): Promise<CatchReportPage> {
  const payload = await apiRequest<unknown>(buildPublicListPath(options), {
    signal: options.signal,
  });
  return readCatchReportPage(payload);
}

export async function getLocationObservations(
  locationId: string,
  signal?: AbortSignal,
): Promise<LocationObservations> {
  const payload = await apiRequest<unknown>(
    `/catch-reports/locations/${encodeURIComponent(locationId)}/observations`,
    { signal },
  );
  return decodeLocationObservations(payload, locationId);
}

export async function listMyCatchReports(
  options: CatchReportPaginationOptions = {},
): Promise<CatchReportPage> {
  const payload = await apiRequest<unknown>(buildPaginationPath('/me/catch-reports', options), {
    signal: options.signal,
  });
  return readCatchReportPage(payload);
}

export async function getCatchReport(reportId: string, signal?: AbortSignal): Promise<CatchReport> {
  const payload = await apiRequest<unknown>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    signal,
  });
  return readReportResponse(payload, decodePublicCatchReport);
}

export async function getOwnerCatchReport(
  reportId: string,
  signal?: AbortSignal,
): Promise<OwnerCatchReport> {
  const payload = await apiRequest<unknown>(`/me/catch-reports/${encodeURIComponent(reportId)}`, {
    signal,
  });
  return readReportResponse(payload, decodeOwnerCatchReport);
}

export async function createCatchReport(input: CreateCatchReportInput): Promise<OwnerCatchReport> {
  const payload = await apiRequest<unknown>('/catch-reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return readReportResponse(payload, decodeOwnerCatchReport);
}

export async function createCatchReportsBatch(
  reports: CreateCatchReportInput[],
): Promise<CreateCatchReportsBatchResult> {
  const payload = await apiRequest<unknown>('/catch-reports/batch', {
    method: 'POST',
    body: JSON.stringify({ reports }),
  });
  return decodeCreateCatchReportsBatchResult(payload);
}

export async function updateCatchReport(
  reportId: string,
  input: UpdateCatchReportInput,
): Promise<OwnerCatchReport> {
  const payload = await apiRequest<unknown>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return readReportResponse(payload, decodeOwnerCatchReport);
}

export async function deleteCatchReport(reportId: string): Promise<void> {
  await apiRequest<void>(`/catch-reports/${encodeURIComponent(reportId)}`, {
    method: 'DELETE',
  });
}

export async function parseCatchReport(
  rawSourceText: string,
  signal?: AbortSignal,
): Promise<CatchReportDraft> {
  const payload = await apiRequest<unknown>('/catch-reports/parse', {
    method: 'POST',
    body: JSON.stringify({ rawSourceText }),
    signal,
  });
  if (!isRecord(payload)) invalidDraft();
  return decodeCatchReportDraft(payload.draft);
}

export async function parseCatchReportBatch(
  rawSourceText: string,
  signal?: AbortSignal,
): Promise<ParseCatchReportBatchResult> {
  const payload = await apiRequest<unknown>('/catch-reports/parse-batch', {
    method: 'POST',
    body: JSON.stringify({ rawSourceText }),
    signal,
  });
  return decodeCatchReportBatch(payload);
}
