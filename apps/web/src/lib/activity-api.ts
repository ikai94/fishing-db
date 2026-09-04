import { apiRequest } from './api-client';

export type ActivityNamedItem = { id: string; name: string };

export type ActivityCatchReport = {
  reportId: string;
  fish: ActivityNamedItem;
  fishingBase: ActivityNamedItem;
  location: ActivityNamedItem & { number: number };
  bait: ActivityNamedItem;
  weightGrams: number;
};

export type ActivityChange = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

export type ActivityCatalogItem =
  | { kind: 'FISHING_BASE' | 'FISH'; id: string; name: string; isActive: boolean }
  | {
      kind: 'LOCATION';
      id: string;
      name: string;
      number: number;
      isActive: boolean;
      fishingBase: ActivityNamedItem;
    }
  | {
      kind: 'BAIT';
      id: string;
      name: string;
      type: 'BAIT' | 'LURE';
      isActive: boolean;
    };

export type ActivityMembership = {
  fishingBase: ActivityNamedItem;
  fish: ActivityNamedItem;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
};

type ActivityCommon = {
  id: string;
  occurredAt: string;
};

type AnglerActivity = ActivityCommon & {
  actor: { kind: 'ANGLER'; nickname: string };
};

type AdministrationActivity = ActivityCommon & {
  actor: { kind: 'ADMINISTRATION' };
};

export type ActivityEvent =
  | (AnglerActivity & {
      type: 'CATCH_REPORT_CREATED' | 'CATCH_REPORT_DELETED';
      data: { report: ActivityCatchReport };
    })
  | (AnglerActivity & {
      type: 'CATCH_REPORT_UPDATED';
      data: { report: ActivityCatchReport; changedFields: string[] };
    })
  | (AnglerActivity & {
      type: 'CATCH_REPORT_BATCH_CREATED';
      data: { createdCount: number };
    })
  | (AdministrationActivity & {
      type: 'CATALOG_ITEM_CREATED';
      data: { item: ActivityCatalogItem };
    })
  | (AdministrationActivity & {
      type: 'CATALOG_ITEM_UPDATED';
      data: { item: ActivityCatalogItem; changes: ActivityChange[] };
    })
  | (AdministrationActivity & {
      type: 'FISHING_BASE_FISH_ADDED' | 'FISHING_BASE_FISH_REMOVED';
      data: { membership: ActivityMembership };
    })
  | (AdministrationActivity & {
      type: 'FISHING_BASE_FISH_UPDATED';
      data: { membership: ActivityMembership; changes: ActivityChange[] };
    });

export type ActivityPage = { items: ActivityEvent[]; nextCursor: string | null };

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_ID_PATTERN = /^[1-9]\d*$/;
const CATCH_FIELDS = new Set([
  'locationId',
  'fishId',
  'baitId',
  'weightGrams',
  'fishingMethod',
  'holeDepthCm',
  'spotPositionRaw',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
  'userNoteRaw',
]);

function invalidActivity(): never {
  throw new Error('Сервер вернул некорректную ленту активности');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidActivity();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidActivity();
  }
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) invalidActivity();
  return value;
}

function name(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) invalidActivity();
  return value;
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) invalidActivity();
  return value;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function named(value: unknown): ActivityNamedItem {
  const item = record(value);
  exactKeys(item, ['id', 'name']);
  return { id: uuid(item.id), name: name(item.name) };
}

function catchReport(value: unknown): ActivityCatchReport {
  const report = record(value);
  exactKeys(report, ['reportId', 'fish', 'fishingBase', 'location', 'bait', 'weightGrams']);
  const location = record(report.location);
  exactKeys(location, ['id', 'name', 'number']);
  return {
    reportId: uuid(report.reportId),
    fish: named(report.fish),
    fishingBase: named(report.fishingBase),
    location: {
      id: uuid(location.id),
      name: name(location.name),
      number: positiveInteger(location.number),
    },
    bait: named(report.bait),
    weightGrams: positiveInteger(report.weightGrams),
  };
}

function changedFields(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) invalidActivity();
  const fields = value.map((field) => {
    if (typeof field !== 'string' || !CATCH_FIELDS.has(field)) invalidActivity();
    return field;
  });
  if (new Set(fields).size !== fields.length) invalidActivity();
  return fields;
}

type ChangeValueType =
  'string' | 'positiveInteger' | 'nullablePositiveInteger' | 'boolean' | 'baitType';

function changeValue(value: unknown, type: ChangeValueType): string | number | boolean | null {
  if (type === 'string') return name(value);
  if (type === 'positiveInteger') return positiveInteger(value);
  if (type === 'nullablePositiveInteger') return nullablePositiveInteger(value);
  if (type === 'boolean') {
    if (typeof value !== 'boolean') invalidActivity();
    return value;
  }
  if (value !== 'BAIT' && value !== 'LURE') invalidActivity();
  return value;
}

function changes(
  value: unknown,
  fieldTypes: Readonly<Record<string, ChangeValueType>>,
): ActivityChange[] {
  if (!Array.isArray(value) || value.length === 0) invalidActivity();
  const result = value.map((entry) => {
    const item = record(entry);
    exactKeys(item, ['field', 'before', 'after']);
    if (typeof item.field !== 'string') invalidActivity();
    const valueType = fieldTypes[item.field];
    if (valueType === undefined) invalidActivity();
    const before = changeValue(item.before, valueType);
    const after = changeValue(item.after, valueType);
    if (before === after) invalidActivity();
    return { field: item.field, before, after };
  });
  if (new Set(result.map((item) => item.field)).size !== result.length) invalidActivity();
  return result;
}

function catalogItem(value: unknown): ActivityCatalogItem {
  const item = record(value);
  if (item.kind === 'FISHING_BASE' || item.kind === 'FISH') {
    exactKeys(item, ['kind', 'id', 'name', 'isActive']);
    if (typeof item.isActive !== 'boolean') invalidActivity();
    return { kind: item.kind, id: uuid(item.id), name: name(item.name), isActive: item.isActive };
  }
  if (item.kind === 'LOCATION') {
    exactKeys(item, ['kind', 'id', 'name', 'number', 'isActive', 'fishingBase']);
    if (typeof item.isActive !== 'boolean') invalidActivity();
    return {
      kind: item.kind,
      id: uuid(item.id),
      name: name(item.name),
      number: positiveInteger(item.number),
      isActive: item.isActive,
      fishingBase: named(item.fishingBase),
    };
  }
  if (item.kind === 'BAIT') {
    exactKeys(item, ['kind', 'id', 'name', 'type', 'isActive']);
    if ((item.type !== 'BAIT' && item.type !== 'LURE') || typeof item.isActive !== 'boolean') {
      invalidActivity();
    }
    return {
      kind: item.kind,
      id: uuid(item.id),
      name: name(item.name),
      type: item.type,
      isActive: item.isActive,
    };
  }
  return invalidActivity();
}

function catalogFields(item: ActivityCatalogItem): Readonly<Record<string, ChangeValueType>> {
  if (item.kind === 'LOCATION') {
    return { name: 'string', number: 'positiveInteger', isActive: 'boolean' };
  }
  if (item.kind === 'BAIT') return { name: 'string', type: 'baitType', isActive: 'boolean' };
  return { name: 'string', isActive: 'boolean' };
}

function membership(value: unknown): ActivityMembership {
  const item = record(value);
  exactKeys(item, ['fishingBase', 'fish', 'minWeightGrams', 'maxWeightGrams']);
  const minWeightGrams = nullablePositiveInteger(item.minWeightGrams);
  const maxWeightGrams = nullablePositiveInteger(item.maxWeightGrams);
  if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
    invalidActivity();
  }
  return {
    fishingBase: named(item.fishingBase),
    fish: named(item.fish),
    minWeightGrams,
    maxWeightGrams,
  };
}

function common(value: Record<string, unknown>) {
  if (typeof value.id !== 'string' || !EVENT_ID_PATTERN.test(value.id)) invalidActivity();
  if (typeof value.occurredAt !== 'string') invalidActivity();
  const date = new Date(value.occurredAt);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value.occurredAt) invalidActivity();
  return { id: value.id, occurredAt: value.occurredAt };
}

function angler(value: unknown): { kind: 'ANGLER'; nickname: string } {
  const actor = record(value);
  exactKeys(actor, ['kind', 'nickname']);
  if (
    actor.kind !== 'ANGLER' ||
    typeof actor.nickname !== 'string' ||
    actor.nickname.length === 0
  ) {
    invalidActivity();
  }
  return { kind: 'ANGLER', nickname: actor.nickname };
}

function administration(value: unknown): { kind: 'ADMINISTRATION' } {
  const actor = record(value);
  exactKeys(actor, ['kind']);
  if (actor.kind !== 'ADMINISTRATION') invalidActivity();
  return { kind: 'ADMINISTRATION' };
}

export function decodeActivityEvent(value: unknown): ActivityEvent {
  const event = record(value);
  exactKeys(event, ['id', 'type', 'occurredAt', 'actor', 'data']);
  const base = common(event);
  const data = record(event.data);

  if (event.type === 'CATCH_REPORT_CREATED' || event.type === 'CATCH_REPORT_DELETED') {
    exactKeys(data, ['report']);
    return {
      ...base,
      type: event.type,
      actor: angler(event.actor),
      data: { report: catchReport(data.report) },
    };
  }
  if (event.type === 'CATCH_REPORT_UPDATED') {
    exactKeys(data, ['report', 'changedFields']);
    return {
      ...base,
      type: event.type,
      actor: angler(event.actor),
      data: { report: catchReport(data.report), changedFields: changedFields(data.changedFields) },
    };
  }
  if (event.type === 'CATCH_REPORT_BATCH_CREATED') {
    exactKeys(data, ['createdCount']);
    return {
      ...base,
      type: event.type,
      actor: angler(event.actor),
      data: { createdCount: positiveInteger(data.createdCount) },
    };
  }
  if (event.type === 'CATALOG_ITEM_CREATED' || event.type === 'CATALOG_ITEM_UPDATED') {
    exactKeys(data, event.type === 'CATALOG_ITEM_CREATED' ? ['item'] : ['item', 'changes']);
    const item = catalogItem(data.item);
    return event.type === 'CATALOG_ITEM_CREATED'
      ? { ...base, type: event.type, actor: administration(event.actor), data: { item } }
      : {
          ...base,
          type: event.type,
          actor: administration(event.actor),
          data: { item, changes: changes(data.changes, catalogFields(item)) },
        };
  }
  if (event.type === 'FISHING_BASE_FISH_ADDED' || event.type === 'FISHING_BASE_FISH_REMOVED') {
    exactKeys(data, ['membership']);
    return {
      ...base,
      type: event.type,
      actor: administration(event.actor),
      data: { membership: membership(data.membership) },
    };
  }
  if (event.type === 'FISHING_BASE_FISH_UPDATED') {
    exactKeys(data, ['membership', 'changes']);
    return {
      ...base,
      type: event.type,
      actor: administration(event.actor),
      data: {
        membership: membership(data.membership),
        changes: changes(data.changes, {
          minWeightGrams: 'nullablePositiveInteger',
          maxWeightGrams: 'nullablePositiveInteger',
        }),
      },
    };
  }
  return invalidActivity();
}

export function decodeActivityPage(value: unknown): ActivityPage {
  const page = record(value);
  exactKeys(page, ['items', 'nextCursor']);
  if (
    !Array.isArray(page.items) ||
    (page.nextCursor !== null && typeof page.nextCursor !== 'string')
  ) {
    invalidActivity();
  }
  return { items: page.items.map(decodeActivityEvent), nextCursor: page.nextCursor };
}

export async function listActivity(
  options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set('limit', String(options.limit));
  if (options.cursor !== undefined) query.set('cursor', options.cursor);
  const suffix = query.size === 0 ? '' : `?${query.toString()}`;
  const payload = await apiRequest<unknown>(`/activity${suffix}`, { signal: options.signal });
  return decodeActivityPage(payload);
}
