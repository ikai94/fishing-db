import { apiRequest } from './api-client';

export type RecordsState = 'RECORD' | 'NO_RECORD' | 'UNKNOWN';
export type RecordsStatus =
  'NO_RECORD' | 'CAN_BEAT' | 'NEAR_MAX' | 'MAXIMUM' | 'MUTANT' | 'MAX_UNKNOWN' | null;
export type RecordsBase = { id: string; name: string; isActive: boolean };
export type RecordsItem = {
  fish: { id: string; name: string; isRarest: boolean; isNightBiting: boolean };
  state: RecordsState;
  record: null | {
    weightGrams: number;
    waterbody: string;
    fishingBase: RecordsBase | null;
    playerName: string;
    caughtAt: string;
  };
  normalMaxWeightGrams: number | null;
  maxBases: RecordsBase[];
  headroomGrams: number | null;
  headroomPercent: number | null;
  status: RecordsStatus;
};
export type RecordsResponse = {
  week: { startsAt: string; endsAt: string; timezone: 'Europe/Moscow'; serverNow: string };
  sync: {
    status: 'CURRENT' | 'STALE' | 'WAITING';
    observedAt: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
  };
  items: RecordsItem[];
};
export type AdminRecordNote = { fishId: string; note: string };
export type AdminRecordNotesResponse = { items: AdminRecordNote[] };
export type UpdatedAdminRecordNoteResponse = {
  note: { fishId: string; note: string | null };
};
export type AdminWrongMaxIssue = {
  fishId: string;
  expectedWeightGrams: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AdminWrongMaxIssuesResponse = { items: AdminWrongMaxIssue[] };
export type UpdatedNightMarkResponse = { fish: { fishId: string; isNightBiting: boolean } };
export type UpdatedWrongMaxIssueResponse = { issue: AdminWrongMaxIssue };

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Некорректный ${label}.`);
  return value as Record<string, unknown>;
}
function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  const row = object(value, label);
  const actual = Object.keys(row).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Некорректный ${label}.`);
  }
  return row;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Некорректный ${label}.`);
  return value;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (Number.isNaN(Date.parse(result))) throw new Error(`Некорректный ${label}.`);
  return result;
}
function nullableInstant(value: unknown, label: string): string | null {
  return value === null ? null : instant(value, label);
}
function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`Некорректный ${label}.`);
  return value as number;
}
function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Некорректный ${label}.`);
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Некорректный ${label}.`);
  return value;
}
function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}
function decodeBase(value: unknown): RecordsBase {
  const row = exactObject(value, 'водоём', ['id', 'name', 'isActive']);
  if (typeof row.isActive !== 'boolean') throw new Error('Некорректный водоём.');
  return {
    id: text(row.id, 'ID водоёма'),
    name: text(row.name, 'название водоёма'),
    isActive: row.isActive,
  };
}
function decodeItem(value: unknown): RecordsItem {
  const row = exactObject(value, 'рекорд', [
    'fish',
    'state',
    'record',
    'normalMaxWeightGrams',
    'maxBases',
    'headroomGrams',
    'headroomPercent',
    'status',
  ]);
  const fish = exactObject(row.fish, 'рыба', ['id', 'name', 'isRarest', 'isNightBiting']);
  if (!['RECORD', 'NO_RECORD', 'UNKNOWN'].includes(String(row.state)))
    throw new Error('Некорректное состояние рекорда.');
  const statuses = [null, 'NO_RECORD', 'CAN_BEAT', 'NEAR_MAX', 'MAXIMUM', 'MUTANT', 'MAX_UNKNOWN'];
  if (!statuses.includes(row.status as never)) throw new Error('Некорректный статус рекорда.');
  const recordRaw =
    row.record === null
      ? null
      : exactObject(row.record, 'официальный рекорд', [
          'weightGrams',
          'waterbody',
          'fishingBase',
          'playerName',
          'caughtAt',
        ]);
  const record =
    recordRaw === null
      ? null
      : {
          weightGrams: positiveInteger(recordRaw.weightGrams, 'вес рекорда'),
          waterbody: text(recordRaw.waterbody, 'место рекорда'),
          fishingBase: recordRaw.fishingBase === null ? null : decodeBase(recordRaw.fishingBase),
          playerName: text(recordRaw.playerName, 'игрок'),
          caughtAt: instant(recordRaw.caughtAt, 'дата рекорда'),
        };
  if ((row.state === 'RECORD') !== (record !== null))
    throw new Error('Несогласованное состояние рекорда.');
  if (!Array.isArray(row.maxBases)) throw new Error('Некорректные базы максимума.');
  return {
    fish: {
      id: text(fish.id, 'ID рыбы'),
      name: text(fish.name, 'название рыбы'),
      isRarest: boolean(fish.isRarest, 'признак редчайшего вида'),
      isNightBiting: boolean(fish.isNightBiting, 'признак ночного клёва'),
    },
    state: row.state as RecordsState,
    record,
    normalMaxWeightGrams:
      row.normalMaxWeightGrams === null
        ? null
        : positiveInteger(row.normalMaxWeightGrams, 'наш max'),
    maxBases: row.maxBases.map(decodeBase),
    headroomGrams: nullableNumber(row.headroomGrams, 'запас'),
    headroomPercent: nullableNumber(row.headroomPercent, 'процент запаса'),
    status: row.status as RecordsStatus,
  };
}

export function decodeRecordsResponse(value: unknown): RecordsResponse {
  const root = exactObject(value, 'ответ рекордов', ['week', 'sync', 'items']);
  const week = exactObject(root.week, 'неделя', ['startsAt', 'endsAt', 'timezone', 'serverNow']);
  const sync = exactObject(root.sync, 'синхронизация', [
    'status',
    'observedAt',
    'lastAttemptAt',
    'lastSuccessAt',
  ]);
  if (week.timezone !== 'Europe/Moscow') throw new Error('Некорректный часовой пояс рекордов.');
  if (!['CURRENT', 'STALE', 'WAITING'].includes(String(sync.status)))
    throw new Error('Некорректное состояние синхронизации.');
  if (!Array.isArray(root.items)) throw new Error('Некорректный список рекордов.');
  return {
    week: {
      startsAt: instant(week.startsAt, 'начало недели'),
      endsAt: instant(week.endsAt, 'конец недели'),
      timezone: 'Europe/Moscow',
      serverNow: instant(week.serverNow, 'серверное время'),
    },
    sync: {
      status: sync.status as RecordsResponse['sync']['status'],
      observedAt: nullableInstant(sync.observedAt, 'время снимка'),
      lastAttemptAt: nullableInstant(sync.lastAttemptAt, 'время попытки'),
      lastSuccessAt: nullableInstant(sync.lastSuccessAt, 'время синхронизации'),
    },
    items: root.items.map(decodeItem),
  };
}

export async function getRecords(signal?: AbortSignal): Promise<RecordsResponse> {
  return decodeRecordsResponse(await apiRequest<unknown>('/records', { signal }));
}

/** Строго декодирует отдельную ADMIN-проекцию заметок, не расширяя публичный records-контракт. */
export function decodeAdminRecordNotesResponse(value: unknown): AdminRecordNotesResponse {
  const root = exactObject(value, 'ответ заметок к рекордам', ['items']);
  if (!Array.isArray(root.items)) throw new Error('Некорректный список заметок к рекордам.');
  return {
    items: root.items.map((value) => {
      const item = exactObject(value, 'элемент заметок к рекордам', ['fishId', 'note']);
      return {
        fishId: text(item.fishId, 'ID рыбы заметки'),
        note: text(item.note, 'текст заметки'),
      };
    }),
  };
}

/** Читает приватные заметки только через защищённый ADMIN endpoint. */
export async function getAdminRecordNotes(signal?: AbortSignal): Promise<AdminRecordNotesResponse> {
  return decodeAdminRecordNotesResponse(
    await apiRequest<unknown>('/admin/records/notes', { signal }),
  );
}

/** Сохраняет одну заметку; null в ответе подтверждает удаление пустого значения. */
export async function updateAdminRecordNote(
  fishId: string,
  note: string,
): Promise<UpdatedAdminRecordNoteResponse> {
  const payload = await apiRequest<unknown>(`/admin/records/notes/${fishId}`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  const root = exactObject(payload, 'ответ сохранения заметки', ['note']);
  const saved = exactObject(root.note, 'сохранённая заметка', ['fishId', 'note']);
  if (saved.note !== null && typeof saved.note !== 'string') {
    throw new Error('Некорректная сохранённая заметка.');
  }
  return {
    note: {
      fishId: text(saved.fishId, 'ID рыбы заметки'),
      note: saved.note === null ? null : text(saved.note, 'текст сохранённой заметки'),
    },
  };
}

/** Строго декодирует одну приватную проблему неверного «Наш max». */
function decodeWrongMaxIssue(value: unknown): AdminWrongMaxIssue {
  const item = exactObject(value, 'элемент проблемы нашего max', [
    'fishId',
    'expectedWeightGrams',
    'note',
    'createdAt',
    'updatedAt',
  ]);
  return {
    fishId: text(item.fishId, 'ID рыбы проблемы'),
    expectedWeightGrams:
      item.expectedWeightGrams === null
        ? null
        : positiveInteger(item.expectedWeightGrams, 'ожидаемый вес'),
    note: nullableText(item.note, 'пояснение проблемы'),
    createdAt: instant(item.createdAt, 'время создания проблемы'),
    updatedAt: instant(item.updatedAt, 'время обновления проблемы'),
  };
}

/** Декодирует отдельную ADMIN-проекцию проблем, не смешивая её с публичными рекордами. */
export function decodeAdminWrongMaxIssuesResponse(value: unknown): AdminWrongMaxIssuesResponse {
  const root = exactObject(value, 'ответ проблем нашего max', ['items']);
  if (!Array.isArray(root.items)) throw new Error('Некорректный список проблем нашего max.');
  return { items: root.items.map(decodeWrongMaxIssue) };
}

/** Загружает все проблемы неверного «Наш max» одним ADMIN-запросом. */
export async function getAdminWrongMaxIssues(
  signal?: AbortSignal,
): Promise<AdminWrongMaxIssuesResponse> {
  return decodeAdminWrongMaxIssuesResponse(
    await apiRequest<unknown>('/admin/records/wrong-max-issues', { signal }),
  );
}

/** Сохраняет общую ночную метку Fish через защищённый ADMIN endpoint. */
export async function updateAdminNightMark(
  fishId: string,
  isNightBiting: boolean,
): Promise<UpdatedNightMarkResponse> {
  const root = exactObject(
    await apiRequest<unknown>(`/admin/records/night-marks/${fishId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isNightBiting }),
    }),
    'ответ ночной метки',
    ['fish'],
  );
  const fish = exactObject(root.fish, 'ночная метка', ['fishId', 'isNightBiting']);
  return {
    fish: {
      fishId: text(fish.fishId, 'ID рыбы ночной метки'),
      isNightBiting: boolean(fish.isNightBiting, 'ночная метка'),
    },
  };
}

/** Создаёт или обновляет приватную проблему неверного «Наш max». */
export async function updateAdminWrongMaxIssue(
  fishId: string,
  expectedWeightGrams: number | null,
  note: string | null,
): Promise<UpdatedWrongMaxIssueResponse> {
  const root = exactObject(
    await apiRequest<unknown>(`/admin/records/wrong-max-issues/${fishId}`, {
      method: 'PATCH',
      body: JSON.stringify({ expectedWeightGrams, note }),
    }),
    'ответ сохранения проблемы нашего max',
    ['issue'],
  );
  return { issue: decodeWrongMaxIssue(root.issue) };
}

/** Полностью снимает приватную проблему неверного «Наш max». */
export async function clearAdminWrongMaxIssue(fishId: string): Promise<void> {
  await apiRequest<void>(`/admin/records/wrong-max-issues/${fishId}`, { method: 'DELETE' });
}
