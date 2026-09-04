import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CATCH_REPORT_ACTIVITY_FIELDS,
  type ActivityChange,
  type ActivityChangeValue,
  type ActivityNamedSnapshot,
  type CatalogItemActivitySnapshot,
  type CatchReportActivityField,
  type CatchReportActivitySnapshot,
  type FishingBaseFishActivitySnapshot,
  type PublicActivityEvent,
} from './activity-event.types.js';
import {
  buildActivityPage,
  decodeActivityCursor,
  InvalidActivityCursorError,
} from './activity-pagination.js';
import type { ActivityListQueryDto } from './dto/activity-list-query.dto.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATCH_REPORT_FIELDS = new Set<string>(CATCH_REPORT_ACTIVITY_FIELDS);

type StoredActivityEvent = {
  id: bigint;
  type:
    | 'CATCH_REPORT_CREATED'
    | 'CATCH_REPORT_BATCH_CREATED'
    | 'CATCH_REPORT_UPDATED'
    | 'CATCH_REPORT_DELETED'
    | 'CATALOG_ITEM_CREATED'
    | 'CATALOG_ITEM_UPDATED'
    | 'FISHING_BASE_FISH_ADDED'
    | 'FISHING_BASE_FISH_UPDATED'
    | 'FISHING_BASE_FISH_REMOVED';
  subjectType:
    | 'CATCH_REPORT'
    | 'CATCH_REPORT_BATCH'
    | 'FISHING_BASE'
    | 'LOCATION'
    | 'FISH'
    | 'BAIT'
    | 'FISHING_BASE_FISH';
  subjectKey: string;
  actorNicknameSnapshot: string;
  actorRoleSnapshot: 'USER' | 'ADMIN';
  payloadVersion: number;
  payload: unknown;
  occurredAt: Date;
};

function invalidStoredEvent(): never {
  throw new InternalServerErrorException({
    statusCode: 500,
    code: 'ACTIVITY_EVENT_INVALID',
    message: 'Не удалось прочитать событие активности',
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidStoredEvent();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalidStoredEvent();
  }
}

function readUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) invalidStoredEvent();
  return value;
}

function readName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) invalidStoredEvent();
  return value;
}

function readPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) invalidStoredEvent();
  return value;
}

function readNullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : readPositiveInteger(value);
}

function readNamed(value: unknown): ActivityNamedSnapshot {
  const record = asRecord(value);
  exactKeys(record, ['id', 'name']);
  return { id: readUuid(record.id), name: readName(record.name) };
}

function readCatchReport(value: unknown): CatchReportActivitySnapshot {
  const record = asRecord(value);
  exactKeys(record, ['reportId', 'fish', 'fishingBase', 'location', 'bait', 'weightGrams']);
  const location = asRecord(record.location);
  exactKeys(location, ['id', 'name', 'number']);

  return {
    reportId: readUuid(record.reportId),
    fish: readNamed(record.fish),
    fishingBase: readNamed(record.fishingBase),
    location: {
      id: readUuid(location.id),
      name: readName(location.name),
      number: readPositiveInteger(location.number),
    },
    bait: readNamed(record.bait),
    weightGrams: readPositiveInteger(record.weightGrams),
  };
}

function readChangedFields(value: unknown): CatchReportActivityField[] {
  if (!Array.isArray(value) || value.length === 0) invalidStoredEvent();
  const fields = value.map((field) => {
    if (typeof field !== 'string' || !CATCH_REPORT_FIELDS.has(field)) invalidStoredEvent();
    return field as CatchReportActivityField;
  });
  if (new Set(fields).size !== fields.length) invalidStoredEvent();
  return fields;
}

type ChangeValueType =
  'string' | 'positiveInteger' | 'nullablePositiveInteger' | 'boolean' | 'baitType';

function readChangeValue(value: unknown, type: ChangeValueType): ActivityChangeValue {
  if (type === 'string') return readName(value);
  if (type === 'positiveInteger') return readPositiveInteger(value);
  if (type === 'nullablePositiveInteger') return readNullablePositiveInteger(value);
  if (type === 'boolean') {
    if (typeof value !== 'boolean') invalidStoredEvent();
    return value;
  }
  if (value !== 'BAIT' && value !== 'LURE') invalidStoredEvent();
  return value;
}

function readChanges(
  value: unknown,
  fieldTypes: Readonly<Record<string, ChangeValueType>>,
): ActivityChange[] {
  if (!Array.isArray(value) || value.length === 0) invalidStoredEvent();
  const changes = value.map((item) => {
    const record = asRecord(item);
    exactKeys(record, ['field', 'before', 'after']);
    if (typeof record.field !== 'string') invalidStoredEvent();
    const valueType = fieldTypes[record.field];
    if (valueType === undefined) invalidStoredEvent();
    const before = readChangeValue(record.before, valueType);
    const after = readChangeValue(record.after, valueType);
    if (before === after) invalidStoredEvent();
    return { field: record.field, before, after };
  });
  if (new Set(changes.map((change) => change.field)).size !== changes.length) invalidStoredEvent();
  return changes;
}

function readCatalogItem(value: unknown): CatalogItemActivitySnapshot {
  const record = asRecord(value);
  const kind = record.kind;

  if (kind === 'FISHING_BASE' || kind === 'FISH') {
    exactKeys(record, ['kind', 'id', 'name', 'isActive']);
    if (typeof record.isActive !== 'boolean') invalidStoredEvent();
    return {
      kind,
      id: readUuid(record.id),
      name: readName(record.name),
      isActive: record.isActive,
    };
  }

  if (kind === 'LOCATION') {
    exactKeys(record, ['kind', 'id', 'name', 'number', 'isActive', 'fishingBase']);
    if (typeof record.isActive !== 'boolean') invalidStoredEvent();
    return {
      kind,
      id: readUuid(record.id),
      name: readName(record.name),
      number: readPositiveInteger(record.number),
      isActive: record.isActive,
      fishingBase: readNamed(record.fishingBase),
    };
  }

  if (kind === 'BAIT') {
    exactKeys(record, ['kind', 'id', 'name', 'type', 'isActive']);
    if (record.type !== 'BAIT' && record.type !== 'LURE') invalidStoredEvent();
    if (typeof record.isActive !== 'boolean') invalidStoredEvent();
    return {
      kind,
      id: readUuid(record.id),
      name: readName(record.name),
      type: record.type,
      isActive: record.isActive,
    };
  }

  return invalidStoredEvent();
}

function catalogFields(
  item: CatalogItemActivitySnapshot,
): Readonly<Record<string, ChangeValueType>> {
  if (item.kind === 'LOCATION') {
    return { name: 'string', number: 'positiveInteger', isActive: 'boolean' };
  }
  if (item.kind === 'BAIT') return { name: 'string', type: 'baitType', isActive: 'boolean' };
  return { name: 'string', isActive: 'boolean' };
}

function readMembership(value: unknown): FishingBaseFishActivitySnapshot {
  const record = asRecord(value);
  exactKeys(record, ['fishingBase', 'fish', 'minWeightGrams', 'maxWeightGrams']);
  const minWeightGrams = readNullablePositiveInteger(record.minWeightGrams);
  const maxWeightGrams = readNullablePositiveInteger(record.maxWeightGrams);
  if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
    invalidStoredEvent();
  }
  return {
    fishingBase: readNamed(record.fishingBase),
    fish: readNamed(record.fish),
    minWeightGrams,
    maxWeightGrams,
  };
}

function publicActor(record: StoredActivityEvent): PublicActivityEvent['actor'] {
  const isCatalog =
    record.type.startsWith('CATALOG_') || record.type.startsWith('FISHING_BASE_FISH_');
  if (isCatalog) {
    if (record.actorRoleSnapshot !== 'ADMIN') invalidStoredEvent();
    return { kind: 'ADMINISTRATION' };
  }
  if (record.actorNicknameSnapshot.length === 0 || record.actorNicknameSnapshot.length > 32) {
    invalidStoredEvent();
  }
  return { kind: 'ANGLER', nickname: record.actorNicknameSnapshot };
}

function mapPublicActivityEvent(record: StoredActivityEvent): PublicActivityEvent {
  if (record.payloadVersion !== 1) invalidStoredEvent();
  const payload = asRecord(record.payload);
  let data: PublicActivityEvent['data'];

  if (record.type === 'CATCH_REPORT_CREATED' || record.type === 'CATCH_REPORT_DELETED') {
    if (record.subjectType !== 'CATCH_REPORT') invalidStoredEvent();
    exactKeys(payload, ['report']);
    const report = readCatchReport(payload.report);
    if (record.subjectKey !== report.reportId) invalidStoredEvent();
    data = { report };
  } else if (record.type === 'CATCH_REPORT_UPDATED') {
    if (record.subjectType !== 'CATCH_REPORT') invalidStoredEvent();
    exactKeys(payload, ['report', 'changedFields']);
    const report = readCatchReport(payload.report);
    if (record.subjectKey !== report.reportId) invalidStoredEvent();
    data = { report, changedFields: readChangedFields(payload.changedFields) };
  } else if (record.type === 'CATCH_REPORT_BATCH_CREATED') {
    if (record.subjectType !== 'CATCH_REPORT_BATCH' || !UUID_V4_PATTERN.test(record.subjectKey)) {
      invalidStoredEvent();
    }
    exactKeys(payload, ['createdCount']);
    data = { createdCount: readPositiveInteger(payload.createdCount) };
  } else if (record.type === 'CATALOG_ITEM_CREATED' || record.type === 'CATALOG_ITEM_UPDATED') {
    exactKeys(payload, record.type === 'CATALOG_ITEM_CREATED' ? ['item'] : ['item', 'changes']);
    const item = readCatalogItem(payload.item);
    if (record.subjectType !== item.kind || record.subjectKey !== item.id) invalidStoredEvent();
    data =
      record.type === 'CATALOG_ITEM_CREATED'
        ? { item }
        : { item, changes: readChanges(payload.changes, catalogFields(item)) };
  } else {
    if (record.subjectType !== 'FISHING_BASE_FISH') invalidStoredEvent();
    exactKeys(
      payload,
      record.type === 'FISHING_BASE_FISH_UPDATED' ? ['membership', 'changes'] : ['membership'],
    );
    const membership = readMembership(payload.membership);
    if (record.subjectKey !== `${membership.fishingBase.id}:${membership.fish.id}`) {
      invalidStoredEvent();
    }
    data =
      record.type === 'FISHING_BASE_FISH_UPDATED'
        ? {
            membership,
            changes: readChanges(payload.changes, {
              minWeightGrams: 'nullablePositiveInteger',
              maxWeightGrams: 'nullablePositiveInteger',
            }),
          }
        : { membership };
  }

  return {
    id: record.id.toString(10),
    type: record.type,
    occurredAt: record.occurredAt,
    actor: publicActor(record),
    data,
  };
}

@Injectable()
export class ActivityQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: ActivityListQueryDto) {
    let beforeId: bigint | undefined;
    try {
      beforeId = query.cursor === undefined ? undefined : decodeActivityCursor(query.cursor);
    } catch (error: unknown) {
      if (error instanceof InvalidActivityCursorError) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'ACTIVITY_CURSOR_INVALID',
          message: 'Некорректный курсор ленты активности',
        });
      }
      throw error;
    }

    const fetched = await this.prisma.activityEvent.findMany({
      where: beforeId === undefined ? {} : { id: { lt: beforeId } },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: {
        id: true,
        type: true,
        subjectType: true,
        subjectKey: true,
        actorNicknameSnapshot: true,
        actorRoleSnapshot: true,
        payloadVersion: true,
        payload: true,
        occurredAt: true,
      },
    });
    const page = buildActivityPage(fetched, query.limit);

    return {
      items: page.items.map((event) => mapPublicActivityEvent(event)),
      nextCursor: page.nextCursor,
    };
  }
}
