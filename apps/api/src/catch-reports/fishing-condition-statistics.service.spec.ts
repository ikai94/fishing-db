import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';
import { FishingConditionStatisticsService } from './fishing-condition-statistics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';
const LATEST_REPORT_CREATED_AT = new Date('2026-08-13T12:34:56.000Z');

const QUERY: HoleStatisticsQueryDto = {
  fishId: FISH_ID,
  baseIds: [BASE_ID, OTHER_BASE_ID],
};

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    fishingMethod: 'BAIT_FISHING',
    fishingNote: 'FROM_BOTTOM',
    spinningSize: null,
    spinningSpeed: null,
    uniqueUsersCount: 7n,
    reportsCount: 18n,
    latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
    ...overrides,
  };
}

void describe('FishingConditionStatisticsService', () => {
  void it('groups stored observation settings in one safely parameterized historical query', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([
          databaseRow(),
          databaseRow({
            fishingMethod: 'SPINNING',
            fishingNote: null,
            spinningSize: 'MEDIUM',
            spinningSpeed: 'SLOW',
          }),
        ]);
      },
    } as unknown as PrismaService;

    const result = await new FishingConditionStatisticsService(prisma).list(QUERY);
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID, BASE_ID, OTHER_BASE_ID]);
    assert.equal(sqlQuery.text.includes(FISH_ID), false);
    assert.equal(sqlQuery.text.includes(BASE_ID), false);
    assert.match(
      sqlQuery.text,
      /GROUP BY\s+report\."fishingMethod",\s+report\."fishingNote",\s+report\."spinningSize",\s+report\."spinningSpeed"/,
    );
    assert.match(sqlQuery.text, /COUNT\(DISTINCT report\."contributorKey"\)/);
    assert.equal(sqlQuery.text.includes('report."userId"'), false);
    assert.match(
      sqlQuery.text,
      /ORDER BY\s+"uniqueUsersCount" DESC,\s+"reportsCount" DESC,\s+"latestReportCreatedAt" DESC/,
    );
    assert.match(
      sqlQuery.text,
      /report\."fishingMethod"::text COLLATE "C" ASC,\s+report\."fishingNote"::text COLLATE "C" ASC NULLS FIRST,\s+report\."spinningSize"::text COLLATE "C" ASC NULLS FIRST,\s+report\."spinningSpeed"::text COLLATE "C" ASC NULLS FIRST/,
    );
    assert.equal(sqlQuery.text.includes('report."baitId"'), false);
    assert.equal(sqlQuery.text.includes('report."holeDepthCm"'), false);
    assert.equal(sqlQuery.text.includes('report."spotPositionRaw"'), false);
    assert.equal(sqlQuery.text.includes('bait."type"'), false);
    assert.equal(sqlQuery.text.includes('"Bait"'), false);
    assert.equal(sqlQuery.text.includes('"User"'), false);
    assert.equal(sqlQuery.text.includes('"FishingBaseFish"'), false);
    assert.deepEqual(result, {
      items: [
        {
          fishingMethod: 'BAIT_FISHING',
          fishingNote: 'FROM_BOTTOM',
          spinningSize: null,
          spinningSpeed: null,
          uniqueUsersCount: 7,
          reportsCount: 18,
          latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
        },
        {
          fishingMethod: 'SPINNING',
          fishingNote: null,
          spinningSize: 'MEDIUM',
          spinningSpeed: 'SLOW',
          uniqueUsersCount: 7,
          reportsCount: 18,
          latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
        },
      ],
    });
  });

  void it('enforces method-specific observation invariants at the service boundary', async () => {
    for (const invalidRow of [
      databaseRow({ spinningSize: 'SMALL' }),
      databaseRow({ spinningSpeed: 'FAST' }),
    ]) {
      const prisma = {
        $queryRaw: () => Promise.resolve([invalidRow]),
      } as unknown as PrismaService;

      await assert.rejects(
        new FishingConditionStatisticsService(prisma).list(QUERY),
        /BAIT_FISHING statistics row must have null spinningSize and spinningSpeed/,
      );
    }

    for (const invalidRow of [
      databaseRow({ fishingMethod: 'SPINNING', spinningSize: null, spinningSpeed: 'FAST' }),
      databaseRow({ fishingMethod: 'SPINNING', spinningSize: 'SMALL', spinningSpeed: null }),
    ]) {
      const prisma = {
        $queryRaw: () => Promise.resolve([invalidRow]),
      } as unknown as PrismaService;

      await assert.rejects(
        new FishingConditionStatisticsService(prisma).list(QUERY),
        /SPINNING statistics row must have non-null spinningSize and spinningSpeed/,
      );
    }
  });

  void it('rejects PostgreSQL counts outside the JavaScript safe integer range', async () => {
    for (const field of ['uniqueUsersCount', 'reportsCount'] as const) {
      const prisma = {
        $queryRaw: () =>
          Promise.resolve([databaseRow({ [field]: BigInt(Number.MAX_SAFE_INTEGER) + 1n })]),
      } as unknown as PrismaService;

      await assert.rejects(
        new FishingConditionStatisticsService(prisma).list(QUERY),
        new RegExp(`${field} exceeds the JavaScript safe integer range`),
      );
    }
  });
});
