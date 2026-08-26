import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { BaitStatisticsQueryDto } from './dto/bait-statistics-query.dto.js';

interface BaitStatisticsDatabaseRow {
  baitId: string;
  baitName: string;
  baitIsActive: boolean;
  reportsCount: bigint;
}

function toSafeCount(value: bigint): number {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('reportsCount exceeds the JavaScript safe positive integer range');
  }

  return Number(value);
}

export function buildBaitStatisticsQuery(fishId: string, baseId: string): Prisma.Sql {
  return Prisma.sql`
    WITH "baitGroups" AS (
      SELECT
        report."baitId",
        COUNT(*) AS "reportsCount"
      FROM "CatchReport" AS report
      INNER JOIN "Location" AS source_location
        ON source_location."id" = report."locationId"
      WHERE report."fishId" = ${fishId}::uuid
        AND source_location."fishingBaseId" = ${baseId}::uuid
      GROUP BY report."baitId"
    )
    SELECT
      bait."id" AS "baitId",
      bait."name" AS "baitName",
      bait."isActive" AS "baitIsActive",
      bait_group."reportsCount" AS "reportsCount"
    FROM "baitGroups" AS bait_group
    INNER JOIN "Bait" AS bait
      ON bait."id" = bait_group."baitId"
    ORDER BY
      bait_group."reportsCount" DESC,
      bait."nameNormalized" COLLATE "C" ASC,
      bait_group."baitId" ASC
  `;
}

@Injectable()
export class BaitStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: BaitStatisticsQueryDto) {
    const rows = await this.prisma.$queryRaw<BaitStatisticsDatabaseRow[]>(
      buildBaitStatisticsQuery(query.fishId, query.baseId),
    );

    return {
      items: rows.map((row) => ({
        bait: {
          id: row.baitId,
          name: row.baitName,
          isActive: row.baitIsActive,
        },
        reportsCount: toSafeCount(row.reportsCount),
      })),
    };
  }
}
