import { Inject, Injectable } from '@nestjs/common';
import { assessBaseFishWeight } from '../catalog/base-fish-weight-classification.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { FishCatchAggregateQueryDto } from './dto/fish-catch-aggregate-query.dto.js';
import {
  decodeFishCatchAggregateCursor,
  encodeFishCatchAggregateCursor,
  InvalidFishCatchAggregateCursorError,
  type FishCatchAggregateCursor,
} from './fish-catch-aggregate-pagination.js';
import { catchReportErrors } from './catch-reports.errors.js';

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
  intensity: bigint;
  contributorCount: bigint;
  maxObservedWeightGrams: number;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

function toSafeCount(value: bigint, field: 'intensity' | 'contributorCount'): number {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe positive integer range`);
  }
  return Number(value);
}

function cursorWhere(cursor: FishCatchAggregateCursor | undefined): Prisma.Sql {
  if (cursor === undefined) return Prisma.empty;

  const intensity = BigInt(cursor.intensity);
  return Prisma.sql`
    WHERE
      aggregate_row."baseNameNormalized" COLLATE "C" > ${cursor.baseNameNormalized}
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" > ${cursor.baseId}::uuid
      )
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" = ${cursor.baseId}::uuid
        AND aggregate_row."locationNumber" > ${cursor.locationNumber}
      )
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" = ${cursor.baseId}::uuid
        AND aggregate_row."locationNumber" = ${cursor.locationNumber}
        AND aggregate_row."locationId" > ${cursor.locationId}::uuid
      )
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" = ${cursor.baseId}::uuid
        AND aggregate_row."locationNumber" = ${cursor.locationNumber}
        AND aggregate_row."locationId" = ${cursor.locationId}::uuid
        AND aggregate_row."intensity" < ${intensity}
      )
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" = ${cursor.baseId}::uuid
        AND aggregate_row."locationNumber" = ${cursor.locationNumber}
        AND aggregate_row."locationId" = ${cursor.locationId}::uuid
        AND aggregate_row."intensity" = ${intensity}
        AND aggregate_row."baitNameNormalized" COLLATE "C" > ${cursor.baitNameNormalized}
      )
      OR (
        aggregate_row."baseNameNormalized" COLLATE "C" = ${cursor.baseNameNormalized}
        AND aggregate_row."baseId" = ${cursor.baseId}::uuid
        AND aggregate_row."locationNumber" = ${cursor.locationNumber}
        AND aggregate_row."locationId" = ${cursor.locationId}::uuid
        AND aggregate_row."intensity" = ${intensity}
        AND aggregate_row."baitNameNormalized" COLLATE "C" = ${cursor.baitNameNormalized}
        AND aggregate_row."baitId" > ${cursor.baitId}::uuid
      )
  `;
}

export function buildFishCatchAggregatesQuery(
  fishId: string,
  baseIds: readonly string[],
  limit: number,
  cursor?: FishCatchAggregateCursor,
): Prisma.Sql {
  const baseIdParameters = Prisma.join(baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`));

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
        AND source_location."fishingBaseId" IN (${baseIdParameters})
      GROUP BY
        fish."id",
        fishing_base."id",
        source_location."id",
        bait."id",
        base_fish."minWeightGrams",
        base_fish."maxWeightGrams"
    )
    SELECT *
    FROM "aggregateRows" AS aggregate_row
    ${cursorWhere(cursor)}
    ORDER BY
      aggregate_row."baseNameNormalized" COLLATE "C" ASC,
      aggregate_row."baseId" ASC,
      aggregate_row."locationNumber" ASC,
      aggregate_row."locationId" ASC,
      aggregate_row."intensity" DESC,
      aggregate_row."baitNameNormalized" COLLATE "C" ASC,
      aggregate_row."baitId" ASC
    LIMIT ${limit + 1}
  `;
}

@Injectable()
export class FishCatchAggregatesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

    const fetchedRows = await this.prisma.$queryRaw<FishCatchAggregateDatabaseRow[]>(
      buildFishCatchAggregatesQuery(query.fishId, query.baseIds, limit, cursor),
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
        bait: { id: row.baitId, name: row.baitName, isActive: row.baitIsActive },
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
              baitNameNormalized: lastRow.baitNameNormalized,
              baitId: lastRow.baitId,
            })
          : null,
    };
  }
}
