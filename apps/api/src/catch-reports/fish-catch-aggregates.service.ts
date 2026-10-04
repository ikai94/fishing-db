import { Inject, Injectable } from '@nestjs/common';
import { assessBaseFishWeight } from '../catalog/base-fish-weight-classification.js';
import { BaitImageDelivery } from '../catalog/bait-image-delivery.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  FishCatchAggregateQueryDto,
  FishCatchIntensityOrder,
  FishCatchOrderMode,
} from './dto/fish-catch-aggregate-query.dto.js';
import {
  decodeFishCatchAggregateCursor,
  encodeFishCatchAggregateCursor,
  InvalidFishCatchAggregateCursorError,
  type FishCatchAggregateCursor,
} from './fish-catch-aggregate-pagination.js';
import type { FishCatchValuesQueryDto } from './dto/fish-catch-values-query.dto.js';
import { catchReportErrors } from './catch-reports.errors.js';

type SpinningSize = 'SMALL' | 'MEDIUM' | 'LARGE';
type SpinningSpeed = 'SLOW' | 'MEDIUM' | 'FAST';

export interface FishCatchSpinningCombination {
  spinningSpeed: SpinningSpeed | null;
  spinningSize: SpinningSize | null;
}

export interface FishCatchTextSummary {
  distinctCount: number;
  value: string | null;
}

export interface FishCatchHoleSpotSummary {
  distinctCount: number;
  value: {
    holeDepthCm: number | null;
    spotPositionRaw: string | null;
  } | null;
}

export interface FishCatchAggregateDatabaseRow {
  baseNameNormalized: string;
  baseId: string;
  baseName: string;
  locationNumber: number;
  locationId: string;
  locationName: string;
  fishId: string;
  fishName: string;
  baitId: string;
  baitName: string;
  baitNameNormalized: string;
  baitIsActive: boolean;
  spinningCombinations: unknown;
  holeSpotDistinctCount: bigint;
  holeSpotSingleDepthCm: number | null;
  holeSpotSinglePositionRaw: string | null;
  userNoteRawDistinctCount: bigint;
  userNoteRawSingleValue: string | null;
  intensity: bigint;
  contributorCount: bigint;
  maxObservedWeightGrams: number;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

const SPINNING_SPEED_ORDER: Record<SpinningSpeed, number> = {
  SLOW: 0,
  MEDIUM: 1,
  FAST: 2,
};
const SPINNING_SIZE_ORDER: Record<SpinningSize, number> = {
  SMALL: 0,
  MEDIUM: 1,
  LARGE: 2,
};

function isSpinningSpeed(value: unknown): value is SpinningSpeed {
  return value === 'SLOW' || value === 'MEDIUM' || value === 'FAST';
}

function isSpinningSize(value: unknown): value is SpinningSize {
  return value === 'SMALL' || value === 'MEDIUM' || value === 'LARGE';
}

function readSpinningCombinations(value: unknown): FishCatchSpinningCombination[] {
  if (!Array.isArray(value)) {
    throw new TypeError('spinningCombinations must be a JSON array');
  }

  const identities = new Set<string>();
  const combinations = value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError('spinningCombinations contains a non-object item');
    }

    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).length !== 2 ||
      !Object.hasOwn(record, 'spinningSpeed') ||
      !Object.hasOwn(record, 'spinningSize')
    ) {
      throw new TypeError('spinningCombinations contains an invalid object');
    }

    const spinningSpeed = record.spinningSpeed;
    const spinningSize = record.spinningSize;
    if (
      (spinningSpeed !== null && !isSpinningSpeed(spinningSpeed)) ||
      (spinningSize !== null && !isSpinningSize(spinningSize)) ||
      (spinningSpeed === null && spinningSize === null)
    ) {
      throw new TypeError('spinningCombinations contains invalid observation values');
    }

    const identity = `${spinningSpeed ?? ''}\0${spinningSize ?? ''}`;
    if (identities.has(identity)) {
      throw new TypeError('spinningCombinations contains duplicate observations');
    }
    identities.add(identity);

    return { spinningSpeed, spinningSize };
  });

  return combinations.sort(
    (left, right) =>
      (left.spinningSpeed === null ? 3 : SPINNING_SPEED_ORDER[left.spinningSpeed]) -
        (right.spinningSpeed === null ? 3 : SPINNING_SPEED_ORDER[right.spinningSpeed]) ||
      (left.spinningSize === null ? 3 : SPINNING_SIZE_ORDER[left.spinningSize]) -
        (right.spinningSize === null ? 3 : SPINNING_SIZE_ORDER[right.spinningSize]),
  );
}

function toSafeCount(value: bigint, field: 'intensity' | 'contributorCount'): number {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe positive integer range`);
  }
  return Number(value);
}

function readTextSummary(
  distinctCountValue: bigint,
  value: string | null,
  field: 'spotPositionRaw' | 'userNoteRaw',
  intensity: number,
): FishCatchTextSummary {
  if (distinctCountValue < 0n || distinctCountValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} distinctCount exceeds the JavaScript safe integer range`);
  }

  const distinctCount = Number(distinctCountValue);
  if (distinctCount > intensity) {
    throw new RangeError(`${field} distinctCount cannot exceed intensity`);
  }
  if (
    (distinctCount === 1 && (typeof value !== 'string' || value.length === 0)) ||
    (distinctCount !== 1 && value !== null)
  ) {
    throw new TypeError(`${field} summary is inconsistent`);
  }

  return { distinctCount, value };
}

function readHoleSpotSummary(
  distinctCountValue: bigint,
  holeDepthCm: number | null,
  spotPositionRaw: string | null,
  intensity: number,
): FishCatchHoleSpotSummary {
  if (distinctCountValue < 0n || distinctCountValue > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('holeSpotSummary distinctCount exceeds the JavaScript safe integer range');
  }

  const distinctCount = Number(distinctCountValue);
  if (distinctCount > intensity) {
    throw new RangeError('holeSpotSummary distinctCount cannot exceed intensity');
  }
  if (
    (holeDepthCm !== null && (!Number.isSafeInteger(holeDepthCm) || holeDepthCm < 1)) ||
    (spotPositionRaw !== null &&
      (typeof spotPositionRaw !== 'string' || spotPositionRaw.length === 0)) ||
    (distinctCount === 1 && holeDepthCm === null && spotPositionRaw === null) ||
    (distinctCount !== 1 && (holeDepthCm !== null || spotPositionRaw !== null))
  ) {
    throw new TypeError('holeSpotSummary is inconsistent');
  }

  return {
    distinctCount,
    value: distinctCount === 1 ? { holeDepthCm, spotPositionRaw } : null,
  };
}

/** В режиме уловов только число строки задаёт приоритет; UUID разрешают равенство для пагинации. */
function cursorPredicate(
  cursor: FishCatchAggregateCursor | undefined,
  order: FishCatchIntensityOrder,
  mode: FishCatchOrderMode,
): Prisma.Sql {
  if (!cursor) return Prisma.empty;
  const count = BigInt(cursor.intensity);
  const comparison =
    order === 'asc' && mode === 'catches'
      ? Prisma.sql`aggregate_row."intensity" > ${count}`
      : Prisma.sql`aggregate_row."intensity" < ${count}`;
  if (mode === 'catches')
    return Prisma.sql`(${comparison} OR (aggregate_row."intensity" = ${count} AND
    (aggregate_row."locationId", aggregate_row."baitId") > (${cursor.locationId}::uuid, ${cursor.baitId}::uuid)))`;
  const place = Prisma.sql`(aggregate_row."baseNameNormalized" COLLATE "C", aggregate_row."baseId", aggregate_row."locationNumber", aggregate_row."locationId")`;
  const previousPlace = Prisma.sql`(${cursor.baseNameNormalized} COLLATE "C", ${cursor.baseId}::uuid, ${cursor.locationNumber}, ${cursor.locationId}::uuid)`;
  return Prisma.sql`(${place} > ${previousPlace} OR (${place} = ${previousPlace} AND (${comparison} OR (
    aggregate_row."intensity" = ${count} AND (aggregate_row."baitNameNormalized" COLLATE "C", aggregate_row."baitId") > (${cursor.baitNameNormalized} COLLATE "C", ${cursor.baitId}::uuid)))))`;
}

/** Фильтрует готовые строки, сохраняя их счётчики и сводки наблюдений. */
function pageWhere(
  cursor: FishCatchAggregateCursor | undefined,
  order: FishCatchIntensityOrder,
  minIntensity: number | undefined,
  hasComment?: boolean,
  hasHole?: boolean,
  baseIds: readonly string[] = [],
  orderMode: FishCatchOrderMode = 'catches',
  hasSpinning?: boolean,
): Prisma.Sql {
  const predicates: Prisma.Sql[] = [];
  if (baseIds.length)
    predicates.push(
      Prisma.sql`aggregate_row."baseId" IN (${Prisma.join(baseIds.map((id) => Prisma.sql`${id}::uuid`))})`,
    );
  if (cursor) predicates.push(cursorPredicate(cursor, order, orderMode));
  if (minIntensity !== undefined)
    predicates.push(Prisma.sql`aggregate_row."intensity" >= ${BigInt(minIntensity)}`);
  if (hasComment) predicates.push(Prisma.sql`aggregate_row."userNoteRawDistinctCount" > 0`);
  if (hasHole) predicates.push(Prisma.sql`aggregate_row."holeSpotDistinctCount" > 0`);
  // Используем готовую публичную сводку: наличие любого из двух полей достаточно.
  if (hasSpinning)
    predicates.push(Prisma.sql`jsonb_array_length(aggregate_row."spinningCombinations") > 0`);
  return predicates.length ? Prisma.sql`WHERE ${Prisma.join(predicates, ' AND ')}` : Prisma.empty;
}

/** Один GROUP BY даёт число каждой строки; выбранный порядок применяется до LIMIT. */
export function buildFishCatchAggregatesQuery(
  fishId: string,
  baseIds: readonly string[],
  limit: number,
  cursor?: FishCatchAggregateCursor,
  intensityOrder: FishCatchIntensityOrder = 'desc',
  minIntensity?: number,
  hasComment?: boolean,
  hasHole?: boolean,
  orderMode: FishCatchOrderMode = 'catches',
  hasSpinning?: boolean,
): Prisma.Sql {
  const intensityDirection = intensityOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  const orderBy =
    orderMode === 'catches'
      ? Prisma.sql`aggregate_row."intensity" ${intensityDirection}, aggregate_row."locationId" ASC, aggregate_row."baitId" ASC`
      : Prisma.sql`aggregate_row."baseNameNormalized" COLLATE "C" ASC, aggregate_row."baseId" ASC, aggregate_row."locationNumber" ASC, aggregate_row."locationId" ASC, aggregate_row."intensity" DESC, aggregate_row."baitNameNormalized" COLLATE "C" ASC, aggregate_row."baitId" ASC`;
  return Prisma.sql`
    WITH "aggregateRows" AS (
      SELECT
        fish."id" AS "fishId",
        fish."name" AS "fishName",
        fishing_base."id" AS "baseId",
        fishing_base."name" AS "baseName",
        fishing_base."nameNormalized" AS "baseNameNormalized",
        source_location."id" AS "locationId",
        source_location."number" AS "locationNumber",
        source_location."name" AS "locationName",
        bait."id" AS "baitId",
        bait."name" AS "baitName",
        bait."nameNormalized" AS "baitNameNormalized",
        bait."isActive" AS "baitIsActive",
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'spinningSpeed', report."spinningSpeed",
              'spinningSize', report."spinningSize"
            )
          ) FILTER (
            WHERE report."fishingMethod" = 'SPINNING'
              AND (report."spinningSpeed" IS NOT NULL OR report."spinningSize" IS NOT NULL)
          ),
          '[]'::jsonb
        ) AS "spinningCombinations",
        COUNT(
          DISTINCT jsonb_build_array(report."holeDepthCm", report."spotPositionRaw")
        ) FILTER (
          WHERE report."holeDepthCm" IS NOT NULL OR report."spotPositionRaw" IS NOT NULL
        ) AS "holeSpotDistinctCount",
        CASE
          WHEN COUNT(
            DISTINCT jsonb_build_array(report."holeDepthCm", report."spotPositionRaw")
          ) FILTER (
            WHERE report."holeDepthCm" IS NOT NULL OR report."spotPositionRaw" IS NOT NULL
          ) = 1
            THEN MIN(report."holeDepthCm") FILTER (
              WHERE report."holeDepthCm" IS NOT NULL OR report."spotPositionRaw" IS NOT NULL
            )
          ELSE NULL
        END AS "holeSpotSingleDepthCm",
        CASE
          WHEN COUNT(
            DISTINCT jsonb_build_array(report."holeDepthCm", report."spotPositionRaw")
          ) FILTER (
            WHERE report."holeDepthCm" IS NOT NULL OR report."spotPositionRaw" IS NOT NULL
          ) = 1
            THEN MIN(report."spotPositionRaw" COLLATE "C") FILTER (
              WHERE report."holeDepthCm" IS NOT NULL OR report."spotPositionRaw" IS NOT NULL
            )
          ELSE NULL
        END AS "holeSpotSinglePositionRaw",
        COUNT(DISTINCT report."userNoteRaw" COLLATE "C")
          AS "userNoteRawDistinctCount",
        CASE
          WHEN COUNT(DISTINCT report."userNoteRaw" COLLATE "C") = 1
            THEN MIN(report."userNoteRaw" COLLATE "C")
          ELSE NULL
        END AS "userNoteRawSingleValue",
        COUNT(*) AS "intensity",
        COUNT(DISTINCT report."contributorKey") AS "contributorCount",
        MAX(report."weightGrams") AS "maxObservedWeightGrams",
        base_fish."minWeightGrams" AS "minWeightGrams",
        base_fish."maxWeightGrams" AS "maxWeightGrams"
      FROM "CatchReport" AS report
      INNER JOIN "Location" AS source_location
        ON source_location."id" = report."locationId"
      INNER JOIN "FishingBase" AS fishing_base
        ON fishing_base."id" = source_location."fishingBaseId"
      INNER JOIN "Fish" AS fish
        ON fish."id" = report."fishId"
      INNER JOIN "Bait" AS bait
        ON bait."id" = report."baitId"
      LEFT JOIN "FishingBaseFish" AS base_fish
        ON base_fish."fishingBaseId" = source_location."fishingBaseId"
        AND base_fish."fishId" = report."fishId"
      WHERE report."fishId" = ${fishId}::uuid
      GROUP BY
        fish."id",
        fishing_base."id",
        source_location."id",
        bait."id",
        base_fish."minWeightGrams",
        base_fish."maxWeightGrams"
    )
    SELECT * FROM "aggregateRows" AS aggregate_row
    ${pageWhere(cursor, intensityOrder, minIntensity, hasComment, hasHole, baseIds, orderMode, hasSpinning)}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
  `;
}

/** Отдаёт публичные исторические строки Fish и ленивые наблюдения без приватных полей. */
@Injectable()
export class FishCatchAggregatesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BaitImageDelivery) private readonly baitImageDelivery: BaitImageDelivery,
  ) {}

  /** Возвращает точные публичные значения; rawSourceText никогда не читается. */
  async values(query: FishCatchValuesQueryDto) {
    const predicate = Prisma.sql`"fishId" = ${query.fishId}::uuid AND "locationId" = ${query.locationId}::uuid AND "baitId" = ${query.baitId}::uuid`;
    if (query.field === 'comment') {
      const rows = await this.prisma.$queryRaw<{ value: string }[]>(Prisma.sql`
        SELECT DISTINCT "userNoteRaw" COLLATE "C" AS value FROM "CatchReport"
        WHERE ${predicate} AND "userNoteRaw" IS NOT NULL
        ORDER BY value LIMIT 26 OFFSET ${query.offset}`);
      return { items: rows.slice(0, 25), nextOffset: rows.length > 25 ? query.offset + 25 : null };
    }
    const rows = await this.prisma.$queryRaw<
      { holeDepthCm: number | null; spotPositionRaw: string | null }[]
    >(Prisma.sql`
      SELECT DISTINCT "holeDepthCm", "spotPositionRaw" COLLATE "C" AS "spotPositionRaw" FROM "CatchReport"
      WHERE ${predicate} AND ("holeDepthCm" IS NOT NULL OR "spotPositionRaw" IS NOT NULL)
      ORDER BY "holeDepthCm" ASC NULLS LAST, "spotPositionRaw" COLLATE "C" ASC NULLS LAST
      LIMIT 26 OFFSET ${query.offset}`);
    return { items: rows.slice(0, 25), nextOffset: rows.length > 25 ? query.offset + 25 : null };
  }

  /** Сохраняет локальные данные строк, меняя только глобальный ключ сортировки. */
  async list(query: FishCatchAggregateQueryDto) {
    const limit = query.limit;
    let cursor: FishCatchAggregateCursor | undefined;

    if (query.cursor !== undefined) {
      try {
        cursor = decodeFishCatchAggregateCursor(query.cursor);
      } catch (error: unknown) {
        if (error instanceof InvalidFishCatchAggregateCursorError) {
          throw catchReportErrors.invalidCursor();
        }
        throw error;
      }
    }

    // Курсор другого режима или направления нельзя продолжать в новом порядке.
    if (
      cursor &&
      (cursor.orderMode !== query.orderMode ||
        cursor.intensityOrder !== (query.orderMode === 'places' ? 'desc' : query.intensityOrder))
    ) {
      throw catchReportErrors.invalidCursor();
    }

    const fetchedRows = await this.prisma.$queryRaw<FishCatchAggregateDatabaseRow[]>(
      buildFishCatchAggregatesQuery(
        query.fishId,
        query.baseIds,
        limit,
        cursor,
        query.intensityOrder,
        query.minIntensity,
        query.hasComment,
        query.hasHole,
        query.orderMode,
        query.hasSpinning,
      ),
    );
    const hasNextPage = fetchedRows.length > limit;
    const rows = hasNextPage ? fetchedRows.slice(0, limit) : fetchedRows;
    const mappedRows = rows.map((row) => {
      const intensity = toSafeCount(row.intensity, 'intensity');
      const contributorCount = toSafeCount(row.contributorCount, 'contributorCount');
      if (contributorCount > intensity) {
        throw new RangeError('contributorCount cannot exceed intensity');
      }

      return {
        fish: { id: row.fishId, name: row.fishName },
        fishingBase: { id: row.baseId, name: row.baseName },
        location: { id: row.locationId, number: row.locationNumber, name: row.locationName },
        bait: {
          id: row.baitId,
          name: row.baitName,
          isActive: row.baitIsActive,
          image: this.baitImageDelivery.resolvePublicImage({
            baitId: row.baitId,
            nameNormalized: row.baitNameNormalized,
          }),
        },
        spinningCombinations: readSpinningCombinations(row.spinningCombinations),
        holeSpotSummary: readHoleSpotSummary(
          row.holeSpotDistinctCount,
          row.holeSpotSingleDepthCm,
          row.holeSpotSinglePositionRaw,
          intensity,
        ),
        userNoteRawSummary: readTextSummary(
          row.userNoteRawDistinctCount,
          row.userNoteRawSingleValue,
          'userNoteRaw',
          intensity,
        ),
        intensity,
        contributorCount,
        maxObservedWeightGrams: row.maxObservedWeightGrams,
        maxObservedWeightAssessment: assessBaseFishWeight(row.maxObservedWeightGrams, {
          minWeightGrams: row.minWeightGrams,
          maxWeightGrams: row.maxWeightGrams,
        }),
      };
    });
    const lastRow = rows.at(-1);

    return {
      items: mappedRows,
      nextCursor:
        hasNextPage && lastRow !== undefined
          ? encodeFishCatchAggregateCursor({
              baseNameNormalized: lastRow.baseNameNormalized,
              baseId: lastRow.baseId,
              locationNumber: lastRow.locationNumber,
              locationId: lastRow.locationId,
              intensity: toSafeCount(lastRow.intensity, 'intensity'),
              orderMode: query.orderMode,
              intensityOrder: query.orderMode === 'places' ? 'desc' : query.intensityOrder,
              baitNameNormalized: lastRow.baitNameNormalized,
              baitId: lastRow.baitId,
            })
          : null,
    };
  }
}
