import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';
import { BaitStatisticsService } from './bait-statistics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';
const LATEST_REPORT_CREATED_AT = new Date('2026-08-13T12:34:56.000Z');

const QUERY: HoleStatisticsQueryDto = {
  fishId: FISH_ID,
  baseIds: [BASE_ID, OTHER_BASE_ID],
};

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    baitId: BAIT_ID,
    baitName: 'Историческая приманка',
    baitIsActive: false,
    fishingMethod: 'SPINNING',
    uniqueUsersCount: 7n,
    reportsCount: 18n,
    latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
    ...overrides,
  };
}

void describe('BaitStatisticsService', () => {
  void it('groups by Bait ID and stored fishing method in one safely parameterized query', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([databaseRow()]);
      },
    } as unknown as PrismaService;

    const result = await new BaitStatisticsService(prisma).list(QUERY);
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID, BASE_ID, OTHER_BASE_ID]);
    assert.equal(sqlQuery.text.includes(FISH_ID), false);
    assert.equal(sqlQuery.text.includes(BASE_ID), false);
    assert.match(sqlQuery.text, /GROUP BY\s+report\."baitId",\s+report\."fishingMethod"/);
    assert.match(sqlQuery.text, /FROM "baitGroups" AS bait_group\s+INNER JOIN "Bait" AS bait/);
    assert.match(
      sqlQuery.text,
      /ORDER BY\s+bait_group\."uniqueUsersCount" DESC,\s+bait_group\."reportsCount" DESC,\s+bait_group\."latestReportCreatedAt" DESC,\s+bait_group\."baitId" ASC,\s+bait_group\."fishingMethod"::text COLLATE "C" ASC/,
    );
    assert.equal(sqlQuery.text.includes('bait."type"'), false);
    assert.equal(sqlQuery.text.includes('"User"'), false);
    assert.equal(sqlQuery.text.includes('"FishingBaseFish"'), false);
    assert.deepEqual(result, {
      items: [
        {
          bait: { id: BAIT_ID, name: 'Историческая приманка', isActive: false },
          fishingMethod: 'SPINNING',
          uniqueUsersCount: 7,
          reportsCount: 18,
          latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
        },
      ],
    });
  });

  void it('rejects PostgreSQL counts outside the JavaScript safe integer range', async () => {
    for (const field of ['uniqueUsersCount', 'reportsCount'] as const) {
      const prisma = {
        $queryRaw: () =>
          Promise.resolve([databaseRow({ [field]: BigInt(Number.MAX_SAFE_INTEGER) + 1n })]),
      } as unknown as PrismaService;

      await assert.rejects(
        new BaitStatisticsService(prisma).list(QUERY),
        new RegExp(`${field} exceeds the JavaScript safe integer range`),
      );
    }
  });
});
