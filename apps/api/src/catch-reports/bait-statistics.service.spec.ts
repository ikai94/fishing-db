import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { BaitStatisticsQueryDto } from './dto/bait-statistics-query.dto.js';
import { BaitStatisticsService } from './bait-statistics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';

const QUERY: BaitStatisticsQueryDto = { fishId: FISH_ID, baseId: BASE_ID };

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    baitId: BAIT_ID,
    baitName: 'Историческая приманка',
    baitIsActive: false,
    reportsCount: 18n,
    ...overrides,
  };
}

void describe('BaitStatisticsService', () => {
  void it('groups a Fish and exactly one Base only by Bait in one parameterized query', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([databaseRow()]);
      },
    } as unknown as PrismaService;

    const result = await new BaitStatisticsService(prisma).list(QUERY);
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID, BASE_ID]);
    assert.equal(sqlQuery.text.includes(FISH_ID), false);
    assert.equal(sqlQuery.text.includes(BASE_ID), false);
    assert.match(sqlQuery.text, /source_location\."fishingBaseId" = \$2::uuid/);
    assert.match(sqlQuery.text, /GROUP BY report\."baitId"/);
    assert.equal(sqlQuery.text.includes('report."fishingMethod"'), false);
    assert.equal(sqlQuery.text.includes('report."contributorKey"'), false);
    assert.equal(sqlQuery.text.includes('report."userId"'), false);
    assert.match(sqlQuery.text, /FROM "baitGroups" AS bait_group\s+INNER JOIN "Bait" AS bait/);
    assert.match(
      sqlQuery.text,
      /ORDER BY\s+bait_group\."reportsCount" DESC,\s+bait\."nameNormalized" COLLATE "C" ASC,\s+bait_group\."baitId" ASC/,
    );
    assert.equal(sqlQuery.text.includes('bait."type"'), false);
    assert.equal(sqlQuery.text.includes('"User"'), false);
    assert.equal(sqlQuery.text.includes('"FishingBaseFish"'), false);
    assert.deepEqual(result, {
      items: [
        {
          bait: { id: BAIT_ID, name: 'Историческая приманка', isActive: false },
          reportsCount: 18,
        },
      ],
    });
  });

  void it('rejects PostgreSQL counts outside the JavaScript safe integer range', async () => {
    const prisma = {
      $queryRaw: () =>
        Promise.resolve([databaseRow({ reportsCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n })]),
    } as unknown as PrismaService;

    await assert.rejects(
      new BaitStatisticsService(prisma).list(QUERY),
      /reportsCount exceeds the JavaScript safe positive integer range/,
    );
  });
});
