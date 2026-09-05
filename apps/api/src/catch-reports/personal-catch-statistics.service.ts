import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { catchReportErrors } from './catch-reports.errors.js';
import { nativeContributorKey } from './catch-report-identity.js';
import type { PersonalCatchRecordsQueryDto } from './dto/personal-catch-records-query.dto.js';
import {
  decodePersonalCatchRecordCursor,
  encodePersonalCatchRecordCursor,
  InvalidPersonalCatchRecordCursorError,
  type PersonalCatchRecordCursor,
} from './personal-catch-record-pagination.js';

interface OverviewRow {
  totalCatches: bigint;
  uniqueFishCount: bigint;
}

interface NamedCountRow {
  id: string;
  name: string;
  isActive: boolean;
  reportsCount: bigint;
}

interface LocationCountRow extends NamedCountRow {
  number: number;
  baseId: string;
  baseName: string;
  baseIsActive: boolean;
}

interface RecordRow {
  fishId: string;
  fishName: string;
  fishNameNormalized: string;
  fishIsActive: boolean;
  maxWeightGrams: number;
  reportId: string;
  reportCreatedAt: Date;
  baseId: string;
  baseName: string;
  baseIsActive: boolean;
  locationId: string;
  locationNumber: number;
  locationName: string;
  locationIsActive: boolean;
  baitId: string;
  baitName: string;
  baitIsActive: boolean;
}

function toSafeCount(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe integer range`);
  }
  return Number(value);
}

function nativeScope(userId: string): Prisma.Sql {
  return Prisma.sql`
    report."userId" = ${userId}::uuid
    AND report."importKey" IS NULL
    AND report."contributorKey" = ${nativeContributorKey(userId)}
  `;
}

function recordCursorWhere(cursor: PersonalCatchRecordCursor | undefined): Prisma.Sql {
  if (cursor === undefined) return Prisma.empty;
  return Prisma.sql`
    AND (
      fish."nameNormalized" COLLATE "C" > ${cursor.fishNameNormalized}
      OR (
        fish."nameNormalized" COLLATE "C" = ${cursor.fishNameNormalized}
        AND fish."id" > ${cursor.fishId}::uuid
      )
    )
  `;
}

export function buildPersonalCatchOverviewQuery(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*) AS "totalCatches", COUNT(DISTINCT report."fishId") AS "uniqueFishCount"
    FROM "CatchReport" AS report
    WHERE ${nativeScope(userId)}
  `;
}

export function buildPersonalNamedRankingQuery(
  userId: string,
  kind: 'fish' | 'base' | 'bait',
): Prisma.Sql {
  if (kind === 'fish') {
    return Prisma.sql`
      SELECT fish."id", fish."name", fish."isActive", COUNT(*) AS "reportsCount"
      FROM "CatchReport" AS report
      INNER JOIN "Fish" AS fish ON fish."id" = report."fishId"
      WHERE ${nativeScope(userId)}
      GROUP BY fish."id"
      ORDER BY COUNT(*) DESC, fish."nameNormalized" COLLATE "C" ASC, fish."id" ASC
      LIMIT 10
    `;
  }
  if (kind === 'bait') {
    return Prisma.sql`
      SELECT bait."id", bait."name", bait."isActive", COUNT(*) AS "reportsCount"
      FROM "CatchReport" AS report
      INNER JOIN "Bait" AS bait ON bait."id" = report."baitId"
      WHERE ${nativeScope(userId)}
      GROUP BY bait."id"
      ORDER BY COUNT(*) DESC, bait."nameNormalized" COLLATE "C" ASC, bait."id" ASC
      LIMIT 10
    `;
  }
  return Prisma.sql`
    SELECT fishing_base."id", fishing_base."name", fishing_base."isActive",
      COUNT(*) AS "reportsCount"
    FROM "CatchReport" AS report
    INNER JOIN "Location" AS source_location ON source_location."id" = report."locationId"
    INNER JOIN "FishingBase" AS fishing_base
      ON fishing_base."id" = source_location."fishingBaseId"
    WHERE ${nativeScope(userId)}
    GROUP BY fishing_base."id"
    ORDER BY COUNT(*) DESC, fishing_base."nameNormalized" COLLATE "C" ASC,
      fishing_base."id" ASC
    LIMIT 10
  `;
}

export function buildPersonalLocationRankingQuery(userId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT source_location."id", source_location."name", source_location."number",
      source_location."isActive", fishing_base."id" AS "baseId",
      fishing_base."name" AS "baseName", fishing_base."isActive" AS "baseIsActive",
      COUNT(*) AS "reportsCount"
    FROM "CatchReport" AS report
    INNER JOIN "Location" AS source_location ON source_location."id" = report."locationId"
    INNER JOIN "FishingBase" AS fishing_base
      ON fishing_base."id" = source_location."fishingBaseId"
    WHERE ${nativeScope(userId)}
    GROUP BY source_location."id", fishing_base."id"
    ORDER BY COUNT(*) DESC, fishing_base."nameNormalized" COLLATE "C" ASC,
      source_location."number" ASC, source_location."id" ASC
    LIMIT 10
  `;
}

export function buildPersonalCatchRecordsQuery(
  userId: string,
  limit: number,
  cursor?: PersonalCatchRecordCursor,
): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (
      SELECT report."id", report."fishId", report."locationId", report."baitId",
        report."weightGrams", report."createdAt",
        ROW_NUMBER() OVER (
          PARTITION BY report."fishId"
          ORDER BY report."weightGrams" DESC, report."createdAt" ASC, report."id" ASC
        ) AS position
      FROM "CatchReport" AS report
      WHERE ${nativeScope(userId)}
    )
    SELECT fish."id" AS "fishId", fish."name" AS "fishName",
      fish."nameNormalized" AS "fishNameNormalized", fish."isActive" AS "fishIsActive",
      ranked."weightGrams" AS "maxWeightGrams", ranked."id" AS "reportId",
      ranked."createdAt" AS "reportCreatedAt", fishing_base."id" AS "baseId",
      fishing_base."name" AS "baseName", fishing_base."isActive" AS "baseIsActive",
      source_location."id" AS "locationId", source_location."number" AS "locationNumber",
      source_location."name" AS "locationName",
      source_location."isActive" AS "locationIsActive", bait."id" AS "baitId",
      bait."name" AS "baitName", bait."isActive" AS "baitIsActive"
    FROM ranked
    INNER JOIN "Fish" AS fish ON fish."id" = ranked."fishId"
    INNER JOIN "Location" AS source_location ON source_location."id" = ranked."locationId"
    INNER JOIN "FishingBase" AS fishing_base
      ON fishing_base."id" = source_location."fishingBaseId"
    INNER JOIN "Bait" AS bait ON bait."id" = ranked."baitId"
    WHERE ranked.position = 1
    ${recordCursorWhere(cursor)}
    ORDER BY fish."nameNormalized" COLLATE "C" ASC, fish."id" ASC
    LIMIT ${limit + 1}
  `;
}

@Injectable()
export class PersonalCatchStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getStatistics(userId: string) {
    const [overviewRows, fishRows, baseRows, locationRows, baitRows] =
      await this.prisma.$transaction(
        async (tx) =>
          Promise.all([
            tx.$queryRaw<OverviewRow[]>(buildPersonalCatchOverviewQuery(userId)),
            tx.$queryRaw<NamedCountRow[]>(buildPersonalNamedRankingQuery(userId, 'fish')),
            tx.$queryRaw<NamedCountRow[]>(buildPersonalNamedRankingQuery(userId, 'base')),
            tx.$queryRaw<LocationCountRow[]>(buildPersonalLocationRankingQuery(userId)),
            tx.$queryRaw<NamedCountRow[]>(buildPersonalNamedRankingQuery(userId, 'bait')),
          ]),
        { isolationLevel: 'RepeatableRead' },
      );
    const overview = overviewRows[0] ?? { totalCatches: 0n, uniqueFishCount: 0n };
    const mapNamed = (row: NamedCountRow) => ({
      item: { id: row.id, name: row.name, isActive: row.isActive },
      reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
    });

    return {
      totalCatches: toSafeCount(overview.totalCatches, 'totalCatches'),
      uniqueFishCount: toSafeCount(overview.uniqueFishCount, 'uniqueFishCount'),
      topFish: fishRows.map(mapNamed),
      topBases: baseRows.map(mapNamed),
      topLocations: locationRows.map((row) => ({
        location: { id: row.id, number: row.number, name: row.name, isActive: row.isActive },
        fishingBase: { id: row.baseId, name: row.baseName, isActive: row.baseIsActive },
        reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
      })),
      topBaits: baitRows.map(mapNamed),
    };
  }

  async listRecords(userId: string, query: PersonalCatchRecordsQueryDto) {
    let cursor: PersonalCatchRecordCursor | undefined;
    if (query.cursor !== undefined) {
      try {
        cursor = decodePersonalCatchRecordCursor(query.cursor);
      } catch (error: unknown) {
        if (error instanceof InvalidPersonalCatchRecordCursorError) {
          throw catchReportErrors.invalidCursor();
        }
        throw error;
      }
    }

    const rows = await this.prisma.$queryRaw<RecordRow[]>(
      buildPersonalCatchRecordsQuery(userId, query.limit, cursor),
    );
    const hasNextPage = rows.length > query.limit;
    const pageRows = hasNextPage ? rows.slice(0, query.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => ({
        fish: { id: row.fishId, name: row.fishName, isActive: row.fishIsActive },
        maxWeightGrams: row.maxWeightGrams,
        representativeReport: {
          id: row.reportId,
          createdAt: row.reportCreatedAt,
          fishingBase: { id: row.baseId, name: row.baseName, isActive: row.baseIsActive },
          location: {
            id: row.locationId,
            number: row.locationNumber,
            name: row.locationName,
            isActive: row.locationIsActive,
          },
          bait: { id: row.baitId, name: row.baitName, isActive: row.baitIsActive },
        },
      })),
      nextCursor:
        hasNextPage && last !== undefined
          ? encodePersonalCatchRecordCursor({
              fishNameNormalized: last.fishNameNormalized,
              fishId: last.fishId,
            })
          : null,
    };
  }
}
