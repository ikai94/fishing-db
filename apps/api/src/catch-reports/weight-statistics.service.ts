import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';

export interface WeightStatisticsDatabaseRow {
  suspiciousLow: bigint;
  ordinary: bigint;
  mutant: bigint;
  suspiciousHigh: bigint;
  unclassified: bigint;
}

function toSafeCount(value: bigint, field: keyof WeightStatisticsDatabaseRow): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe non-negative integer range`);
  }
  return Number(value);
}

export function buildWeightStatisticsQuery(fishId: string, baseIds: readonly string[]): Prisma.Sql {
  const baseIdParameters = Prisma.join(baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`));

  return Prisma.sql`
    WITH classified AS (
      SELECT CASE
        WHEN bounds."minWeightGrams" IS NOT NULL
          AND report."weightGrams" < bounds."minWeightGrams"
          THEN 'suspicious-low'
        WHEN bounds."maxWeightGrams" IS NOT NULL
          AND report."weightGrams" > bounds."maxWeightGrams"
          AND report."weightGrams"::bigint * 20 <= bounds."maxWeightGrams"::bigint * 21
          THEN 'mutant'
        WHEN bounds."maxWeightGrams" IS NOT NULL
          AND report."weightGrams" > bounds."maxWeightGrams"
          AND report."weightGrams"::bigint * 20 > bounds."maxWeightGrams"::bigint * 21
          THEN 'suspicious-high'
        WHEN bounds."minWeightGrams" IS NOT NULL
          AND bounds."maxWeightGrams" IS NOT NULL
          THEN 'ordinary'
        ELSE 'unclassified'
      END AS classification
      FROM "CatchReport" AS report
      INNER JOIN "Location" AS source_location
        ON source_location."id" = report."locationId"
      LEFT JOIN "FishingBaseFish" AS bounds
        ON bounds."fishingBaseId" = source_location."fishingBaseId"
        AND bounds."fishId" = report."fishId"
      WHERE report."fishId" = ${fishId}::uuid
        AND source_location."fishingBaseId" IN (${baseIdParameters})
    )
    SELECT
      COUNT(*) FILTER (WHERE classification = 'suspicious-low') AS "suspiciousLow",
      COUNT(*) FILTER (WHERE classification = 'ordinary') AS ordinary,
      COUNT(*) FILTER (WHERE classification = 'mutant') AS mutant,
      COUNT(*) FILTER (WHERE classification = 'suspicious-high') AS "suspiciousHigh",
      COUNT(*) FILTER (WHERE classification = 'unclassified') AS unclassified
    FROM classified
  `;
}

@Injectable()
export class WeightStatisticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(query: HoleStatisticsQueryDto) {
    const [row] = await this.prisma.$queryRaw<WeightStatisticsDatabaseRow[]>(
      buildWeightStatisticsQuery(query.fishId, query.baseIds),
    );
    if (row === undefined) throw new RangeError('Weight statistics query returned no row');

    return {
      counts: {
        'suspicious-low': toSafeCount(row.suspiciousLow, 'suspiciousLow'),
        ordinary: toSafeCount(row.ordinary, 'ordinary'),
        mutant: toSafeCount(row.mutant, 'mutant'),
        'suspicious-high': toSafeCount(row.suspiciousHigh, 'suspiciousHigh'),
        unclassified: toSafeCount(row.unclassified, 'unclassified'),
      },
    };
  }
}
