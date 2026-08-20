import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';

interface HoleStatisticsDatabaseRow {
  fishingBaseId: string;
  fishingBaseName: string;
  fishingBaseIsActive: boolean;
  locationId: string;
  locationNumber: number;
  locationName: string;
  locationIsActive: boolean;
  holeDepthCm: number;
  spotPosition: string | null;
  uniqueUsersCount: bigint;
  reportsCount: bigint;
  latestReportCreatedAt: Date;
}

function toSafeCount(value: bigint, field: 'uniqueUsersCount' | 'reportsCount'): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe integer range`);
  }

  return Number(value);
}

export function buildHoleStatisticsQuery(fishId: string, baseIds: readonly string[]): Prisma.Sql {
  const baseIdParameters = Prisma.join(baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`));

  return Prisma.sql`
    WITH "candidateReports" AS (
      SELECT
        report."locationId",
        report."holeDepthCm",
        report."spotPositionRaw",
        report."contributorKey",
        report."createdAt",
        (
          NULLIF(
            lower(
              btrim(
                regexp_replace(
                  normalize(report."spotPositionRaw", NFKC),
                  '[[:space:]]+',
                  ' ',
                  'g'
                )
              )
            ),
            ''
          ) COLLATE "C"
        ) AS "normalizedSpotKey"
      FROM "CatchReport" AS report
      INNER JOIN "Location" AS source_location
        ON source_location."id" = report."locationId"
      WHERE report."fishId" = ${fishId}::uuid
        AND source_location."fishingBaseId" IN (${baseIdParameters})
        AND report."holeDepthCm" IS NOT NULL
    ),
    "holeGroups" AS (
      SELECT
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        COUNT(*) AS "reportsCount",
        COUNT(DISTINCT candidate."contributorKey") AS "uniqueUsersCount",
        MAX(candidate."createdAt") AS "latestReportCreatedAt"
      FROM "candidateReports" AS candidate
      GROUP BY
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey"
    ),
    "rawVariants" AS (
      SELECT
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        candidate."spotPositionRaw" COLLATE "C" AS "spotPositionRaw",
        COUNT(DISTINCT candidate."contributorKey") AS "variantUniqueUsersCount",
        COUNT(*) AS "variantReportsCount",
        MAX(candidate."createdAt") AS "variantLatestReportCreatedAt"
      FROM "candidateReports" AS candidate
      WHERE candidate."normalizedSpotKey" IS NOT NULL
      GROUP BY
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        candidate."spotPositionRaw" COLLATE "C"
    ),
    "rankedVariants" AS (
      SELECT
        variant.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            variant."locationId",
            variant."holeDepthCm",
            variant."normalizedSpotKey"
          ORDER BY
            variant."variantUniqueUsersCount" DESC,
            variant."variantReportsCount" DESC,
            variant."variantLatestReportCreatedAt" DESC,
            variant."spotPositionRaw" COLLATE "C" ASC
        ) AS "variantRank"
      FROM "rawVariants" AS variant
    )
    SELECT
      fishing_base."id" AS "fishingBaseId",
      fishing_base."name" AS "fishingBaseName",
      fishing_base."isActive" AS "fishingBaseIsActive",
      location."id" AS "locationId",
      location."number" AS "locationNumber",
      location."name" AS "locationName",
      location."isActive" AS "locationIsActive",
      hole_group."holeDepthCm" AS "holeDepthCm",
      representative."spotPositionRaw" AS "spotPosition",
      hole_group."uniqueUsersCount" AS "uniqueUsersCount",
      hole_group."reportsCount" AS "reportsCount",
      hole_group."latestReportCreatedAt" AS "latestReportCreatedAt"
    FROM "holeGroups" AS hole_group
    INNER JOIN "Location" AS location
      ON location."id" = hole_group."locationId"
    INNER JOIN "FishingBase" AS fishing_base
      ON fishing_base."id" = location."fishingBaseId"
    LEFT JOIN "rankedVariants" AS representative
      ON representative."locationId" = hole_group."locationId"
      AND representative."holeDepthCm" = hole_group."holeDepthCm"
      AND representative."normalizedSpotKey" = hole_group."normalizedSpotKey"
      AND representative."variantRank" = 1
    ORDER BY
      hole_group."uniqueUsersCount" DESC,
      hole_group."reportsCount" DESC,
      hole_group."latestReportCreatedAt" DESC,
      hole_group."locationId" ASC,
      hole_group."holeDepthCm" ASC,
      hole_group."normalizedSpotKey" COLLATE "C" ASC NULLS FIRST
  `;
}

@Injectable()
export class HoleStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: HoleStatisticsQueryDto) {
    const rows = await this.prisma.$queryRaw<HoleStatisticsDatabaseRow[]>(
      buildHoleStatisticsQuery(query.fishId, query.baseIds),
    );

    return {
      items: rows.map((row) => ({
        fishingBase: {
          id: row.fishingBaseId,
          name: row.fishingBaseName,
          isActive: row.fishingBaseIsActive,
        },
        location: {
          id: row.locationId,
          number: row.locationNumber,
          name: row.locationName,
          isActive: row.locationIsActive,
        },
        holeDepthCm: row.holeDepthCm,
        spotPosition: row.spotPosition,
        uniqueUsersCount: toSafeCount(row.uniqueUsersCount, 'uniqueUsersCount'),
        reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
        latestReportCreatedAt: row.latestReportCreatedAt,
      })),
    };
  }
}
