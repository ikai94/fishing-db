import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';

interface BaitStatisticsDatabaseRow {
  baitId: string;
  baitName: string;
  baitIsActive: boolean;
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
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

export function buildBaitStatisticsQuery(fishId: string, baseIds: readonly string[]): Prisma.Sql {
  const baseIdParameters = Prisma.join(baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`));

  return Prisma.sql`
    WITH "baitGroups" AS (
      SELECT
        report."baitId",
        report."fishingMethod",
        COUNT(DISTINCT report."userId") AS "uniqueUsersCount",
        COUNT(*) AS "reportsCount",
        MAX(report."createdAt") AS "latestReportCreatedAt"
      FROM "CatchReport" AS report
      INNER JOIN "Location" AS source_location
        ON source_location."id" = report."locationId"
      WHERE report."fishId" = ${fishId}::uuid
        AND source_location."fishingBaseId" IN (${baseIdParameters})
      GROUP BY
        report."baitId",
        report."fishingMethod"
    )
    SELECT
      bait."id" AS "baitId",
      bait."name" AS "baitName",
      bait."isActive" AS "baitIsActive",
      bait_group."fishingMethod" AS "fishingMethod",
      bait_group."uniqueUsersCount" AS "uniqueUsersCount",
      bait_group."reportsCount" AS "reportsCount",
      bait_group."latestReportCreatedAt" AS "latestReportCreatedAt"
    FROM "baitGroups" AS bait_group
    INNER JOIN "Bait" AS bait
      ON bait."id" = bait_group."baitId"
    ORDER BY
      bait_group."uniqueUsersCount" DESC,
      bait_group."reportsCount" DESC,
      bait_group."latestReportCreatedAt" DESC,
      bait_group."baitId" ASC,
      bait_group."fishingMethod"::text COLLATE "C" ASC
  `;
}

@Injectable()
export class BaitStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: HoleStatisticsQueryDto) {
    const rows = await this.prisma.$queryRaw<BaitStatisticsDatabaseRow[]>(
      buildBaitStatisticsQuery(query.fishId, query.baseIds),
    );

    return {
      items: rows.map((row) => ({
        bait: {
          id: row.baitId,
          name: row.baitName,
          isActive: row.baitIsActive,
        },
        fishingMethod: row.fishingMethod,
        uniqueUsersCount: toSafeCount(row.uniqueUsersCount, 'uniqueUsersCount'),
        reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
        latestReportCreatedAt: row.latestReportCreatedAt,
      })),
    };
  }
}
