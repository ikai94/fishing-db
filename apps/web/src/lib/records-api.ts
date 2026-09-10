import { apiRequest } from './api-client';

export type RecordsState = 'RECORD' | 'NO_RECORD' | 'UNKNOWN';
export type RecordsStatus =
  'NO_RECORD' | 'CAN_BEAT' | 'NEAR_MAX' | 'MAXIMUM' | 'MUTANT' | 'MAX_UNKNOWN' | null;
export type RecordsBase = { id: string; name: string; isActive: boolean };
export type RecordsItem = {
  fish: { id: string; name: string; isRarest: boolean };
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
  const fish = exactObject(row.fish, 'рыба', ['id', 'name', 'isRarest']);
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
