import { HttpException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ActivityEventWriter } from '../activity/activity-event-writer.service.js';
import type {
  CatchReportActivityField,
  CatchReportActivitySnapshot,
} from '../activity/activity-event.types.js';
import {
  assessBaseFishWeight,
  type BaseFishWeightBounds,
} from '../catalog/base-fish-weight-classification.js';
import { isPrismaError } from '../catalog/catalog-errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  isCatchReportObservationComplete,
  type CatchReportObservation,
} from './catch-report-observation.js';
import {
  assertCatchReportObservation,
  deriveFishingMethod,
  prepareCatchReportCreate,
  prepareCatchReportCreates,
  type PreparedCatchReportCreate,
  validateCatchReportBait,
  validateCatchReportFish,
  validateCatchReportFishingBaseFish,
  validateCatchReportLocation,
} from './catch-report-create-domain.js';
import { nativeContributorKey } from './catch-report-identity.js';
import {
  buildCatchReportPage,
  catchReportCursorWhere,
  decodeCatchReportCursor,
  InvalidCatchReportCursorError,
  type CatchReportCursorWhere,
} from './catch-report-pagination.js';
import { normalizeSpotPositionRaw, normalizeUserNoteRaw } from './catch-report-raw-note.js';
import {
  CATCH_REPORT_DEFAULT_LIMIT,
  type CatchReportFishingMethod,
  type CatchReportFishingNote,
  type CatchReportSpinningSize,
  type CatchReportSpinningSpeed,
} from './catch-reports.constants.js';
import { catchReportErrors } from './catch-reports.errors.js';
import type { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import type { PublicCatchReportListQueryDto } from './dto/public-catch-report-list-query.dto.js';
import type { OwnerCatchReportListQueryDto } from './dto/owner-catch-report-list-query.dto.js';
import type { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';

/**
 * Явный allowlist публичной Prisma-проекции.
 *
 * В нём намеренно нет rawSourceText, contributorKey и importKey: новые поля persistence-модели
 * не должны автоматически просачиваться в публичный контракт.
 */
export const PUBLIC_CATCH_REPORT_SELECT = {
  id: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      nickname: true,
    },
  },
  location: {
    select: {
      id: true,
      number: true,
      name: true,
      fishingBase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  fish: {
    select: {
      id: true,
      name: true,
    },
  },
  bait: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

/** Owner-detail allowlist: добавляет rawSourceText, но скрывает внутренние identity keys. */
const OWNER_CATCH_REPORT_SELECT = {
  id: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  rawSourceText: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      nickname: true,
    },
  },
  location: {
    select: {
      id: true,
      number: true,
      name: true,
      fishingBase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  fish: {
    select: {
      id: true,
      name: true,
    },
  },
  bait: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

/**
 * Внутренняя проекция Location-агрегации.
 *
 * contributorKey нужен лишь для distinct-подсчёта и удаляется mapper-ом; расширенная Fish нужна
 * для стабильной сортировки и отображения исторически неактивной рыбы.
 */
const LOCATION_OBSERVATION_SELECT = {
  ...PUBLIC_CATCH_REPORT_SELECT,
  contributorKey: true,
  fish: {
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      isActive: true,
    },
  },
} as const;

/** Узкий owner allowlist для чтения результата мутации внутри той же транзакции. */
const OWNER_CATCH_REPORT_SCALAR_SELECT = {
  id: true,
  userId: true,
  locationId: true,
  fishId: true,
  baitId: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  rawSourceText: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;
const BATCH_TRANSACTION_TIMEOUT_MS = 120_000;
const BATCH_INSERT_CHUNK_SIZE = 500;

const BATCH_DOMAIN_FIELD_BY_CODE: Readonly<Record<string, keyof CreateCatchReportDto>> = {
  FISHING_BASE_INACTIVE: 'locationId',
  LOCATION_INACTIVE: 'locationId',
  LOCATION_NOT_FOUND: 'locationId',
  FISH_INACTIVE: 'fishId',
  FISH_NOT_AVAILABLE_AT_FISHING_BASE: 'fishId',
  FISH_NOT_FOUND: 'fishId',
  BAIT_INACTIVE: 'baitId',
  BAIT_NOT_FOUND: 'baitId',
};

type BatchFieldErrors = Record<string, string[]>;

/** Сужает неизвестное тело HTTP-ошибки перед безопасным чтением полей. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Возвращает структурированное тело доменной HttpException для batch-ошибки. */
function httpExceptionResponse(error: HttpException): Record<string, unknown> | null {
  const value = error.getResponse();
  return isRecord(value) ? value : null;
}

/** Переводит доменную ошибку строки в адрес reports.<index>.<field>. */
function appendBatchRowErrors(result: BatchFieldErrors, rowIndex: number, error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const response = httpExceptionResponse(error);
  if (response === null) return false;

  const message =
    typeof response.message === 'string' ? response.message : 'Отчёт не прошёл проверку';
  const code = typeof response.code === 'string' ? response.code : null;
  const responseErrors = response.errors;
  let appended = false;

  if (isRecord(responseErrors)) {
    for (const [field, messages] of Object.entries(responseErrors)) {
      if (!Array.isArray(messages)) continue;
      const strings = messages.filter((item): item is string => typeof item === 'string');
      if (strings.length === 0) continue;
      result[`reports.${rowIndex}.${field}`] = strings;
      appended = true;
    }
  }

  const domainField = code === null ? undefined : BATCH_DOMAIN_FIELD_BY_CODE[code];
  if (!appended && domainField !== undefined) {
    result[`reports.${rowIndex}.${domainField}`] = [message];
    appended = true;
  }

  return appended;
}

/** Описывает только поля, разрешённые публичной проекцией CatchReport. */
export interface PublicCatchReportRecord {
  id: string;
  weightGrams: number;
  fishingMethod: CatchReportFishingMethod;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: CatchReportFishingNote | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
  userNoteRaw: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; nickname: string };
  location: {
    id: string;
    number: number;
    name: string;
    fishingBase: { id: string; name: string };
  };
  fish: { id: string; name: string };
  bait: { id: string; name: string };
}

/** Расширяет публичную запись единственным owner-only полем для detail-ответа. */
interface OwnerCatchReportRecord extends PublicCatchReportRecord {
  rawSourceText: string | null;
}

/** Держит contributorKey только во внутреннем контуре Location-агрегации. */
interface LocationObservationRecord extends Omit<PublicCatchReportRecord, 'fish'> {
  contributorKey: string;
  fish: {
    id: string;
    name: string;
    nameNormalized: string;
    isActive: boolean;
  };
}

/** Считает отчёты отдельно от множества неизменных contributor identity. */
interface ObservedFishAccumulator {
  fish: LocationObservationRecord['fish'];
  contributorKeys: Set<string>;
  reportCount: number;
}

/** Снимок сохраняемых полей до PATCH для исторической валидации и ActivityEvent. */
interface CurrentCatchReportState {
  userId: string;
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  fishingMethod: CatchReportFishingMethod;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: CatchReportFishingNote | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
  userNoteRaw: string | null;
}

/** Allowlist полей, которые PATCH вправе передать Prisma. */
interface CatchReportWriteData {
  locationId?: string;
  fishId?: string;
  baitId?: string;
  weightGrams?: number;
  fishingMethod?: CatchReportFishingMethod;
  holeDepthCm?: number | null;
  spotPositionRaw?: string | null;
  fishingNote?: CatchReportFishingNote | null;
  spinningSize?: CatchReportSpinningSize | null;
  spinningSpeed?: CatchReportSpinningSpeed | null;
  userNoteRaw?: string | null;
}

interface PublicCatchReportFilters {
  fishId?: string;
  baseIds?: string[];
}

type WeightBoundsDatabase = Pick<Prisma.TransactionClient, 'fishingBaseFish'>;

const MISSING_WEIGHT_BOUNDS: BaseFishWeightBounds = {
  minWeightGrams: null,
  maxWeightGrams: null,
};

/** Строит однозначный ключ текущих весовых границ membership Base–Fish. */
function baseFishWeightKey(fishingBaseId: string, fishId: string): string {
  return `${fishingBaseId}:${fishId}`;
}

/**
 * Загружает текущие весовые границы, не отфильтровывая исторические отчёты.
 * Отсутствующая сегодня membership даёт пустые границы, а не скрывает сохранённый улов.
 */
export async function resolveBaseFishWeightBounds(
  database: WeightBoundsDatabase,
  records: readonly PublicCatchReportRecord[],
): Promise<Map<string, BaseFishWeightBounds>> {
  if (records.length === 0) return new Map();

  const fishingBaseIds = [...new Set(records.map((record) => record.location.fishingBase.id))];
  const fishIds = [...new Set(records.map((record) => record.fish.id))];
  const memberships = await database.fishingBaseFish.findMany({
    where: {
      fishingBaseId: { in: fishingBaseIds },
      fishId: { in: fishIds },
    },
    select: {
      fishingBaseId: true,
      fishId: true,
      minWeightGrams: true,
      maxWeightGrams: true,
    },
  });

  return new Map(
    memberships.map((membership) => [
      baseFishWeightKey(membership.fishingBaseId, membership.fishId),
      {
        minWeightGrams: membership.minWeightGrams,
        maxWeightGrams: membership.maxWeightGrams,
      },
    ]),
  );
}

/** Оценивает вес по текущим границам Base–Fish без изменения сохранённой истории. */
function weightAssessment(
  record: PublicCatchReportRecord,
  boundsByBaseFish: ReadonlyMap<string, BaseFishWeightBounds>,
) {
  const bounds =
    boundsByBaseFish.get(baseFishWeightKey(record.location.fishingBase.id, record.fish.id)) ??
    MISSING_WEIGHT_BOUNDS;
  return assessBaseFishWeight(record.weightGrams, bounds);
}

/**
 * Собирает публичный ответ только из allowlisted полей.
 * contributorKey, importKey и owner-only rawSourceText сюда попасть не могут.
 */
export function toPublicCatchReport(
  record: PublicCatchReportRecord,
  boundsByBaseFish: ReadonlyMap<string, BaseFishWeightBounds>,
) {
  return {
    id: record.id,
    author: {
      id: record.user.id,
      nickname: record.user.nickname,
    },
    fishingBase: {
      id: record.location.fishingBase.id,
      name: record.location.fishingBase.name,
    },
    location: {
      id: record.location.id,
      number: record.location.number,
      name: record.location.name,
    },
    fish: {
      id: record.fish.id,
      name: record.fish.name,
    },
    bait: {
      id: record.bait.id,
      name: record.bait.name,
    },
    weightGrams: record.weightGrams,
    weightAssessment: weightAssessment(record, boundsByBaseFish),
    fishingMethod: record.fishingMethod,
    holeDepthCm: record.holeDepthCm,
    spotPositionRaw: record.spotPositionRaw,
    fishingNote: record.fishingNote,
    spinningSize: record.spinningSize,
    spinningSpeed: record.spinningSpeed,
    userNoteRaw: record.userNoteRaw,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Добавляет rawSourceText только к уже проверенной owner-detail проекции. */
function toOwnerCatchReport(
  record: OwnerCatchReportRecord,
  boundsByBaseFish: ReadonlyMap<string, BaseFishWeightBounds>,
) {
  const publicReport = toPublicCatchReport(record, boundsByBaseFish);

  return {
    id: publicReport.id,
    author: publicReport.author,
    fishingBase: publicReport.fishingBase,
    location: publicReport.location,
    fish: publicReport.fish,
    bait: publicReport.bait,
    weightGrams: publicReport.weightGrams,
    weightAssessment: publicReport.weightAssessment,
    fishingMethod: publicReport.fishingMethod,
    holeDepthCm: publicReport.holeDepthCm,
    spotPositionRaw: publicReport.spotPositionRaw,
    fishingNote: publicReport.fishingNote,
    spinningSize: publicReport.spinningSize,
    spinningSpeed: publicReport.spinningSpeed,
    userNoteRaw: publicReport.userNoteRaw,
    rawSourceText: record.rawSourceText,
    createdAt: publicReport.createdAt,
    updatedAt: publicReport.updatedAt,
  };
}

/** Отличает пустой PATCH от передачи nullable-полей со значением null. */
function updateHasNoDefinedValues(dto: UpdateCatchReportDto): boolean {
  return [
    dto.locationId,
    dto.fishId,
    dto.baitId,
    dto.weightGrams,
    dto.holeDepthCm,
    dto.spotPositionRaw,
    dto.fishingNote,
    dto.spinningSize,
    dto.spinningSpeed,
    dto.userNoteRaw,
  ].every((value) => value === undefined);
}

/**
 * Строит Prisma PATCH allowlist и сохраняет семантику raw-полей.
 * Непустой ввод не trim-ится и не переписывается; пустая строка становится null.
 */
function buildUpdateData(dto: UpdateCatchReportDto): CatchReportWriteData {
  const data: CatchReportWriteData = {};

  if (dto.locationId !== undefined) data.locationId = dto.locationId;
  if (dto.fishId !== undefined) data.fishId = dto.fishId;
  if (dto.baitId !== undefined) data.baitId = dto.baitId;
  if (dto.weightGrams !== undefined) data.weightGrams = dto.weightGrams;
  if (dto.holeDepthCm !== undefined) data.holeDepthCm = dto.holeDepthCm;
  if (dto.spotPositionRaw !== undefined) {
    data.spotPositionRaw = normalizeSpotPositionRaw(dto.spotPositionRaw);
  }
  if (dto.fishingNote !== undefined) data.fishingNote = dto.fishingNote;
  if (dto.spinningSize !== undefined) data.spinningSize = dto.spinningSize;
  if (dto.spinningSpeed !== undefined) data.spinningSpeed = dto.spinningSpeed;
  if (dto.userNoteRaw !== undefined) data.userNoteRaw = normalizeUserNoteRaw(dto.userNoteRaw);

  return data;
}

/** Восстанавливает исторически сохранённое наблюдение до применения PATCH. */
function currentObservation(current: CurrentCatchReportState): CatchReportObservation {
  return {
    fishingMethod: current.fishingMethod,
    holeDepthCm: current.holeDepthCm,
    spinningSize: current.spinningSize,
    spinningSpeed: current.spinningSpeed,
  };
}

/** Даёт детерминированный tie-break для нормализованных строк и UUID. */
function compareStableStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Формирует публично безопасный снимок отчёта для неизменяемого ActivityEvent. */
function activitySnapshot(report: {
  id: string;
  weightGrams: number;
  fishingBase: { id: string; name: string };
  location: { id: string; number: number; name: string };
  fish: { id: string; name: string };
  bait: { id: string; name: string };
}): CatchReportActivitySnapshot {
  return {
    reportId: report.id,
    fish: report.fish,
    fishingBase: report.fishingBase,
    location: report.location,
    bait: report.bait,
    weightGrams: report.weightGrams,
  };
}

/** Вычисляет только фактически изменившиеся публичные поля для audit-события PATCH. */
function changedActivityFields(
  before: CurrentCatchReportState,
  after: {
    location: { id: string };
    fish: { id: string };
    bait: { id: string };
    weightGrams: number;
    fishingMethod: CatchReportFishingMethod;
    holeDepthCm: number | null;
    spotPositionRaw: string | null;
    fishingNote: CatchReportFishingNote | null;
    spinningSize: CatchReportSpinningSize | null;
    spinningSpeed: CatchReportSpinningSpeed | null;
    userNoteRaw: string | null;
  },
): CatchReportActivityField[] {
  const candidates: Array<[CatchReportActivityField, unknown, unknown]> = [
    ['locationId', before.locationId, after.location.id],
    ['fishId', before.fishId, after.fish.id],
    ['baitId', before.baitId, after.bait.id],
    ['weightGrams', before.weightGrams, after.weightGrams],
    ['fishingMethod', before.fishingMethod, after.fishingMethod],
    ['holeDepthCm', before.holeDepthCm, after.holeDepthCm],
    ['spotPositionRaw', before.spotPositionRaw, after.spotPositionRaw],
    ['fishingNote', before.fishingNote, after.fishingNote],
    ['spinningSize', before.spinningSize, after.spinningSize],
    ['spinningSpeed', before.spinningSpeed, after.spinningSpeed],
    ['userNoteRaw', before.userNoteRaw, after.userNoteRaw],
  ];

  return candidates
    .filter(([, beforeValue, afterValue]) => beforeValue !== afterValue)
    .map(([field]) => field);
}

/**
 * Владеет публичными/owner проекциями и атомарными мутациями CatchReport.
 * Online-мутации сериализуются с ActivityEvent; offline-import использует общий preflight,
 * но намеренно не публикует online-активность.
 */
@Injectable()
export class CatchReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityEventWriter) private readonly activityEvents: ActivityEventWriter,
  ) {}

  /** Читает публичную историю без фильтров активности каталога или ban автора. */
  async listPublic(query: PublicCatchReportListQueryDto) {
    return this.list(query, undefined, {
      fishId: query.fishId,
      baseIds: query.baseIds,
    });
  }

  /** Ограничивает архив actorUserId и сохраняет list-проекцию без rawSourceText. */
  async listMine(actorUserId: string, query: OwnerCatchReportListQueryDto) {
    return this.list(query, actorUserId, undefined, {
      source: query.source,
      fishId: query.fishId,
      baseId: query.baseId,
      locationId: query.locationId,
      baitId: query.baitId,
    });
  }

  /**
   * Агрегирует все исторические отчёты Location по Fish.
   * reportCount считает наблюдения, а contributorCount — уникальные contributorKey, поэтому
   * импортированные участники не схлопываются из-за общего ADMIN-владельца.
   */
  async listLocationObservations(locationId: string) {
    const records = await this.prisma.catchReport.findMany({
      where: { locationId },
      orderBy: [
        { fish: { nameNormalized: 'asc' } },
        { fishId: 'asc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      select: LOCATION_OBSERVATION_SELECT,
    });
    const boundsByBaseFish = await resolveBaseFishWeightBounds(this.prisma, records);
    const observedFishById = new Map<string, ObservedFishAccumulator>();

    // contributorKey используется только для множества участников и не отдаётся наружу.
    for (const record of records) {
      const existing = observedFishById.get(record.fish.id);

      if (existing === undefined) {
        observedFishById.set(record.fish.id, {
          fish: record.fish,
          contributorKeys: new Set([record.contributorKey]),
          reportCount: 1,
        });
      } else {
        existing.contributorKeys.add(record.contributorKey);
        existing.reportCount += 1;
      }
    }

    const observedFish = [...observedFishById.values()]
      .sort(
        (left, right) =>
          right.contributorKeys.size - left.contributorKeys.size ||
          right.reportCount - left.reportCount ||
          compareStableStrings(left.fish.nameNormalized, right.fish.nameNormalized) ||
          compareStableStrings(left.fish.id, right.fish.id),
      )
      .map((item) => ({
        fish: {
          id: item.fish.id,
          name: item.fish.name,
          isActive: item.fish.isActive,
        },
        contributorCount: item.contributorKeys.size,
        reportCount: item.reportCount,
      }));

    return {
      observedFish,
      reports: records.map((record) => toPublicCatchReport(record, boundsByBaseFish)),
    };
  }

  /** Возвращает public-detail без проверки текущей активности связанных сущностей. */
  async getPublic(reportId: string) {
    const record = await this.prisma.catchReport.findUnique({
      where: { id: reportId },
      select: PUBLIC_CATCH_REPORT_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();
    const boundsByBaseFish = await resolveBaseFishWeightBounds(this.prisma, [record]);
    return { report: toPublicCatchReport(record, boundsByBaseFish) };
  }

  /** Возвращает owner-detail только при совпадении report.userId с actorUserId. */
  async getMine(actorUserId: string, reportId: string) {
    const record = await this.prisma.catchReport.findFirst({
      where: { id: reportId, userId: actorUserId },
      select: OWNER_CATCH_REPORT_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();
    const boundsByBaseFish = await resolveBaseFishWeightBounds(this.prisma, [record]);
    return { report: toOwnerCatchReport(record, boundsByBaseFish) };
  }

  /**
   * Атомарно создаёт нативный отчёт и его ActivityEvent.
   * contributorKey выводится из User, но остаётся внутренней неизменной личностью участника.
   */
  async create(actorUserId: string, dto: CreateCatchReportDto) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const prepared = await prepareCatchReportCreate(tx, dto);

        const record = await tx.catchReport.create({
          data: {
            userId: actorUserId,
            contributorKey: nativeContributorKey(actorUserId),
            importKey: null,
            ...prepared.data,
          },
          select: { id: true },
        });

        const result = await this.getMineInTransaction(tx, actorUserId, record.id);
        // Событие — последняя запись: отчёт и публичная активность фиксируются вместе.
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATCH_REPORT_CREATED',
          subjectType: 'CATCH_REPORT',
          subjectKey: record.id,
          payload: { report: activitySnapshot(result.report) },
        });
        return result;
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  /**
   * Атомарно создаёт batch после полного preflight и публикует одно агрегатное ActivityEvent.
   * Ошибки собираются по индексам до первой вставки, а данные вставляются chunks, чтобы
   * ограничить размер SQL-запроса без частичного сохранения batch.
   */
  async createBatch(actorUserId: string, reports: readonly CreateCatchReportDto[]) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const prepared: PreparedCatchReportCreate[] = [];
        const validationErrors: BatchFieldErrors = {};
        const preparationResults = await prepareCatchReportCreates(tx, reports);

        for (const [rowIndex, result] of preparationResults.entries()) {
          if ('error' in result) {
            if (!appendBatchRowErrors(validationErrors, rowIndex, result.error)) {
              throw result.error;
            }
          } else {
            prepared.push(result.prepared);
          }
        }

        if (Object.keys(validationErrors).length > 0) {
          throw catchReportErrors.batchValidation(validationErrors);
        }

        const contributorKey = nativeContributorKey(actorUserId);
        const reportIds = prepared.map(() => randomUUID());
        // Chunking меняет размер запросов, но все chunks остаются в одной транзакции.
        for (let offset = 0; offset < prepared.length; offset += BATCH_INSERT_CHUNK_SIZE) {
          const items = prepared.slice(offset, offset + BATCH_INSERT_CHUNK_SIZE);
          await tx.catchReport.createMany({
            data: items.map((item, index) => ({
              id: reportIds[offset + index],
              userId: actorUserId,
              contributorKey,
              importKey: null,
              ...item.data,
            })),
          });
        }

        // Агрегатное событие пишется лишь после успешной вставки каждого chunk.
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATCH_REPORT_BATCH_CREATED',
          subjectType: 'CATCH_REPORT_BATCH',
          subjectKey: randomUUID(),
          payload: { createdCount: reportIds.length },
        });

        return { createdCount: reportIds.length, reportIds };
      }, BATCH_TRANSACTION_TIMEOUT_MS);
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  /**
   * Атомарно обновляет owner-report и при реальном изменении добавляет ActivityEvent.
   * Ссылки перепроверяются только при смене Location/Fish/Bait; fishingMethod выводится заново
   * исключительно при фактической смене Bait.
   */
  async update(actorUserId: string, reportId: string, dto: UpdateCatchReportDto) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const current = await tx.catchReport.findUnique({
          where: { id: reportId },
          select: {
            userId: true,
            locationId: true,
            fishId: true,
            baitId: true,
            weightGrams: true,
            fishingMethod: true,
            holeDepthCm: true,
            spotPositionRaw: true,
            fishingNote: true,
            spinningSize: true,
            spinningSpeed: true,
            userNoteRaw: true,
          },
        });

        if (current === null) throw catchReportErrors.notFound();
        if (current.userId !== actorUserId) throw catchReportErrors.notOwned();
        if (updateHasNoDefinedValues(dto)) throw catchReportErrors.emptyUpdate();

        const locationChanged =
          dto.locationId !== undefined && dto.locationId !== current.locationId;
        const fishChanged = dto.fishId !== undefined && dto.fishId !== current.fishId;
        const baitChanged = dto.baitId !== undefined && dto.baitId !== current.baitId;

        // Неизменённые ссылки допустимы после деактивации или удаления membership.
        if (locationChanged || fishChanged) {
          const resultingLocationId = dto.locationId ?? current.locationId;
          const resultingFishId = dto.fishId ?? current.fishId;
          const location = await validateCatchReportLocation(tx, resultingLocationId);
          await validateCatchReportFish(tx, resultingFishId);
          await validateCatchReportFishingBaseFish(tx, location.fishingBaseId, resultingFishId);
        }

        let fishingMethod: CatchReportFishingMethod = current.fishingMethod;
        const data = buildUpdateData(dto);

        // Текущий тип Bait не переопределяет историю, пока ссылка Bait не меняется.
        if (baitChanged) {
          const bait = await validateCatchReportBait(tx, dto.baitId ?? current.baitId);
          fishingMethod = deriveFishingMethod(bait.type);
          data.fishingMethod = fishingMethod;
        }

        let resultingSpinningSize =
          dto.spinningSize === undefined ? current.spinningSize : dto.spinningSize;
        let resultingSpinningSpeed =
          dto.spinningSpeed === undefined ? current.spinningSpeed : dto.spinningSpeed;

        if (baitChanged && fishingMethod === 'BAIT_FISHING') {
          resultingSpinningSize = null;
          resultingSpinningSpeed = null;
        }

        const observation: CatchReportObservation = {
          fishingMethod,
          holeDepthCm: dto.holeDepthCm === undefined ? current.holeDepthCm : dto.holeDepthCm,
          spinningSize: resultingSpinningSize,
          spinningSpeed: resultingSpinningSpeed,
        };
        const methodFieldsTouched =
          dto.holeDepthCm !== undefined ||
          dto.spinningSize !== undefined ||
          dto.spinningSpeed !== undefined;

        if (
          baitChanged ||
          methodFieldsTouched ||
          isCatchReportObservationComplete(currentObservation(current))
        ) {
          assertCatchReportObservation(observation);
        }

        if (baitChanged && fishingMethod === 'BAIT_FISHING') {
          data.spinningSize = null;
          data.spinningSpeed = null;
        }

        const record = await tx.catchReport.update({
          where: { id: reportId, userId: actorUserId },
          data,
          select: { id: true },
        });

        const result = await this.getMineInTransaction(tx, actorUserId, record.id);
        const changedFields = changedActivityFields(current, result.report);
        if (changedFields.length > 0) {
          // Effective no-op возвращает отчёт, но не создаёт ложное событие активности.
          await this.activityEvents.append(tx, actorUserId, {
            type: 'CATCH_REPORT_UPDATED',
            subjectType: 'CATCH_REPORT',
            subjectKey: record.id,
            payload: { report: activitySnapshot(result.report), changedFields },
          });
        }
        return result;
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) throw catchReportErrors.notFound();
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  /** Атомарно удаляет owner-report и сохраняет его публичный снимок в ActivityEvent. */
  async delete(actorUserId: string, reportId: string): Promise<void> {
    try {
      await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const current = await tx.catchReport.findUnique({
          where: { id: reportId },
          select: { userId: true },
        });

        if (current === null) throw catchReportErrors.notFound();
        if (current.userId !== actorUserId) throw catchReportErrors.notOwned();

        const beforeDelete = await this.getMineInTransaction(tx, actorUserId, reportId);

        await tx.catchReport.delete({
          where: { id: reportId, userId: actorUserId },
        });
        // Снимок получен до DELETE, а append завершает ту же транзакцию после удаления.
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATCH_REPORT_DELETED',
          subjectType: 'CATCH_REPORT',
          subjectKey: reportId,
          payload: { report: activitySnapshot(beforeDelete.report) },
        });
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) throw catchReportErrors.notFound();
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  /**
   * Выполняет cursor-чтение через публичный Prisma allowlist.
   * Owner-list получает userId-фильтр, но rawSourceText остаётся только в owner-detail;
   * active/membership/ban-фильтры отсутствуют ради исторической семантики.
   */
  private async list(
    query: CatchReportListQueryDto,
    actorUserId?: string,
    publicFilters?: PublicCatchReportFilters,
    ownerFilters?: {
      source?: 'native';
      fishId?: string;
      baseId?: string;
      locationId?: string;
      baitId?: string;
    },
  ) {
    const limit = query.limit ?? CATCH_REPORT_DEFAULT_LIMIT;
    const cursorWhere = this.cursorWhere(query.cursor);
    const filterWhere =
      publicFilters === undefined
        ? {}
        : {
            ...(publicFilters.fishId === undefined ? {} : { fishId: publicFilters.fishId }),
            ...(publicFilters.baseIds === undefined
              ? {}
              : {
                  location: {
                    fishingBaseId: { in: publicFilters.baseIds },
                  },
                }),
          };
    const where = {
      ...(actorUserId === undefined
        ? {}
        : {
            userId: actorUserId,
            ...(ownerFilters?.source === 'native'
              ? { importKey: null, contributorKey: nativeContributorKey(actorUserId) }
              : {}),
          }),
      ...filterWhere,
      ...(ownerFilters?.fishId === undefined ? {} : { fishId: ownerFilters.fishId }),
      ...(ownerFilters?.locationId === undefined ? {} : { locationId: ownerFilters.locationId }),
      ...(ownerFilters?.baitId === undefined ? {} : { baitId: ownerFilters.baitId }),
      ...(ownerFilters?.baseId === undefined
        ? {}
        : { location: { fishingBaseId: ownerFilters.baseId } }),
      ...cursorWhere,
    };
    const fetchedRecords = await this.prisma.catchReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: PUBLIC_CATCH_REPORT_SELECT,
    });
    const page = buildCatchReportPage(fetchedRecords, limit);
    const boundsByBaseFish = await resolveBaseFishWeightBounds(this.prisma, page.items);

    return {
      items: page.items.map((record) => toPublicCatchReport(record, boundsByBaseFish)),
      nextCursor: page.nextCursor,
    };
  }

  /** Повторяет сериализуемую транзакцию только при P2034 и не дробит операцию. */
  private async runSerializableTransaction<Result>(
    operation: (tx: Prisma.TransactionClient) => Promise<Result>,
    timeout?: number,
  ): Promise<Result> {
    let lastConflict: unknown;

    for (let attempt = 1; attempt <= SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: 'Serializable',
          ...(timeout === undefined ? {} : { timeout }),
        });
      } catch (error: unknown) {
        if (!isPrismaError(error, 'P2034')) throw error;
        lastConflict = error;
      }
    }

    throw lastConflict;
  }

  /** Переводит ошибку непрозрачного cursor в стабильную доменную ошибку API. */
  private cursorWhere(cursor: string | undefined): CatchReportCursorWhere | object {
    if (cursor === undefined) return {};

    try {
      return catchReportCursorWhere(decodeCatchReportCursor(cursor));
    } catch (error: unknown) {
      if (error instanceof InvalidCatchReportCursorError) {
        throw catchReportErrors.invalidCursor();
      }
      throw error;
    }
  }

  /**
   * Повторно проверяет ban внутри транзакции под FOR SHARE.
   * NotBannedGuard даёт ранний отказ, а эта проверка закрывает гонку до записи.
   */
  private async assertActorCanMutate(
    database: Prisma.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    const [actor] = await database.$queryRaw<Array<{ isBanned: boolean }>>`
      SELECT "isBanned"
      FROM "User"
      WHERE "id" = ${actorUserId}::uuid
      FOR SHARE
    `;

    if (actor?.isBanned) throw catchReportErrors.accountBanned();
    if (actor === undefined) throw catchReportErrors.referenceConflict();
  }

  /**
   * Собирает owner-detail результата мутации внутри её транзакции.
   * Раздельные allowlisted чтения не допускают утечки persistence-записи.
   */
  private async getMineInTransaction(
    database: Prisma.TransactionClient,
    actorUserId: string,
    reportId: string,
  ) {
    const record = await database.catchReport.findFirst({
      where: { id: reportId, userId: actorUserId },
      select: OWNER_CATCH_REPORT_SCALAR_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();

    const user = await database.user.findUnique({
      where: { id: record.userId },
      select: { id: true, nickname: true },
    });
    const location = await database.location.findUnique({
      where: { id: record.locationId },
      select: { id: true, fishingBaseId: true, number: true, name: true },
    });
    const fishingBase =
      location === null
        ? null
        : await database.fishingBase.findUnique({
            where: { id: location.fishingBaseId },
            select: { id: true, name: true },
          });
    const fish = await database.fish.findUnique({
      where: { id: record.fishId },
      select: { id: true, name: true },
    });
    const bait = await database.bait.findUnique({
      where: { id: record.baitId },
      select: { id: true, name: true },
    });

    if (
      user === null ||
      location === null ||
      fishingBase === null ||
      fish === null ||
      bait === null
    ) {
      throw catchReportErrors.referenceConflict();
    }

    const ownerRecord: OwnerCatchReportRecord = {
      id: record.id,
      weightGrams: record.weightGrams,
      fishingMethod: record.fishingMethod,
      holeDepthCm: record.holeDepthCm,
      spotPositionRaw: record.spotPositionRaw,
      fishingNote: record.fishingNote,
      spinningSize: record.spinningSize,
      spinningSpeed: record.spinningSpeed,
      userNoteRaw: record.userNoteRaw,
      rawSourceText: record.rawSourceText,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      user,
      location: {
        id: location.id,
        number: location.number,
        name: location.name,
        fishingBase,
      },
      fish,
      bait,
    };
    const boundsByBaseFish = await resolveBaseFishWeightBounds(database, [ownerRecord]);

    return { report: toOwnerCatchReport(ownerRecord, boundsByBaseFish) };
  }
}
