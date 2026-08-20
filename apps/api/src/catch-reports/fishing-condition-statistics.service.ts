import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';

type FishingMethod = 'BAIT_FISHING' | 'SPINNING';
type FishingNote = 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE';
type SpinningSize = 'SMALL' | 'MEDIUM' | 'LARGE';
type SpinningSpeed = 'SLOW' | 'MEDIUM' | 'FAST';

interface FishingConditionStatisticsDatabaseRow {
  fishingMethod: FishingMethod;
  fishingNote: FishingNote | null;
  spinningSize: SpinningSize | null;
  spinningSpeed: SpinningSpeed | null;
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

function assertMethodSpecificObservation(row: FishingConditionStatisticsDatabaseRow): void {
  if (row.fishingMethod === 'BAIT_FISHING') {
    if (row.spinningSize !== null || row.spinningSpeed !== null) {
      throw new TypeError(
        'BAIT_FISHING statistics row must have null spinningSize and spinningSpeed',
      );
    }

    return;
  }

  if (row.fishingMethod === 'SPINNING') {
    if (row.spinningSize === null || row.spinningSpeed === null) {
      throw new TypeError(
        'SPINNING statistics row must have non-null spinningSize and spinningSpeed',
      );
    }

    return;
  }

  throw new TypeError('Fishing condition statistics row has an unsupported fishingMethod');
}

export function buildFishingConditionStatisticsQuery(
  fishId: string,
  baseIds: readonly string[],
): Prisma.Sql {
  const baseIdParameters = Prisma.join(baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`));

  return Prisma.sql`
    SELECT
      report."fishingMethod" AS "fishingMethod",
      report."fishingNote" AS "fishingNote",
      report."spinningSize" AS "spinningSize",
      report."spinningSpeed" AS "spinningSpeed",
      COUNT(DISTINCT report."userId") AS "uniqueUsersCount",
      COUNT(*) AS "reportsCount",
      MAX(report."createdAt") AS "latestReportCreatedAt"
    FROM "CatchReport" AS report
    INNER JOIN "Location" AS source_location
      ON source_location."id" = report."locationId"
    WHERE report."fishId" = ${fishId}::uuid
      AND source_location."fishingBaseId" IN (${baseIdParameters})
    GROUP BY
      report."fishingMethod",
      report."fishingNote",
      report."spinningSize",
      report."spinningSpeed"
    ORDER BY
      "uniqueUsersCount" DESC,
      "reportsCount" DESC,
      "latestReportCreatedAt" DESC,
      report."fishingMethod"::text COLLATE "C" ASC,
      report."fishingNote"::text COLLATE "C" ASC NULLS FIRST,
      report."spinningSize"::text COLLATE "C" ASC NULLS FIRST,
      report."spinningSpeed"::text COLLATE "C" ASC NULLS FIRST
  `;
}

@Injectable()
export class FishingConditionStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: HoleStatisticsQueryDto) {
    const rows = await this.prisma.$queryRaw<FishingConditionStatisticsDatabaseRow[]>(
      buildFishingConditionStatisticsQuery(query.fishId, query.baseIds),
    );

    return {
      items: rows.map((row) => {
        assertMethodSpecificObservation(row);

        return {
          fishingMethod: row.fishingMethod,
          fishingNote: row.fishingNote,
          spinningSize: row.spinningSize,
          spinningSpeed: row.spinningSpeed,
          uniqueUsersCount: toSafeCount(row.uniqueUsersCount, 'uniqueUsersCount'),
          reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
          latestReportCreatedAt: row.latestReportCreatedAt,
        };
      }),
    };
  }
}
