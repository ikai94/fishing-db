import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';
import { HoleStatisticsService } from './hole-statistics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';
const LOCATION_ID = '30000000-0000-4000-8000-000000000001';
const LATEST_REPORT_CREATED_AT = new Date('2026-08-13T12:34:56.000Z');

const QUERY: HoleStatisticsQueryDto = {
  fishId: FISH_ID,
  baseIds: [BASE_ID, OTHER_BASE_ID],
};

function databaseRow(overrides: Record<string, unknown> = {}) {
  return {
    fishingBaseId: BASE_ID,
    fishingBaseName: 'База',
    fishingBaseIsActive: true,
    locationId: LOCATION_ID,
    locationNumber: 12,
    locationName: 'Судачий откос',
    locationIsActive: false,
    holeDepthCm: 600,
    spotPosition: 'у блокнота',
    uniqueUsersCount: 7n,
    reportsCount: 18n,
    latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
    ...overrides,
  };
}

void describe('HoleStatisticsService', () => {
  void it('uses one safely parameterized PostgreSQL query and maps only aggregate fields', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([databaseRow()]);
      },
    } as unknown as PrismaService;
    const service = new HoleStatisticsService(prisma);

    const result = await service.list(QUERY);
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID, BASE_ID, OTHER_BASE_ID]);
    assert.equal(sqlQuery.text.includes(FISH_ID), false);
    assert.equal(sqlQuery.text.includes(BASE_ID), false);
    assert.match(sqlQuery.text, /normalize\(report\."spotPositionRaw", NFKC\)/);
    assert.match(sqlQuery.text, /'\[\[:space:\]\]\+'/);
    assert.match(sqlQuery.text, /NULLIF\([\s\S]+\) COLLATE "C"/);
    assert.match(sqlQuery.text, /report\."contributorKey"/);
    assert.equal(sqlQuery.text.match(/COUNT\(DISTINCT candidate\."contributorKey"\)/g)?.length, 2);
    assert.equal(sqlQuery.text.includes('"userId"'), false);
    assert.equal(sqlQuery.text.includes('"User"'), false);
    assert.equal(sqlQuery.text.includes('"Bait"'), false);
    assert.equal(sqlQuery.text.includes('"FishingBaseFish"'), false);
    assert.deepEqual(result, {
      items: [
        {
          fishingBase: { id: BASE_ID, name: 'База', isActive: true },
          location: {
            id: LOCATION_ID,
            number: 12,
            name: 'Судачий откос',
            isActive: false,
          },
          holeDepthCm: 600,
          spotPosition: 'у блокнота',
          uniqueUsersCount: 7,
          reportsCount: 18,
          latestReportCreatedAt: LATEST_REPORT_CREATED_AT,
        },
      ],
    });
  });

  void it('keeps a missing representative position null', async () => {
    const prisma = {
      $queryRaw: () => Promise.resolve([databaseRow({ spotPosition: null })]),
    } as unknown as PrismaService;

    const result = await new HoleStatisticsService(prisma).list(QUERY);

    assert.equal(result.items[0]?.spotPosition, null);
  });

  void it('omits the Base predicate for an empty all-Bases scope', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([]);
      },
    } as unknown as PrismaService;

    await new HoleStatisticsService(prisma).list({ fishId: FISH_ID, baseIds: [] });
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID]);
    assert.equal(sqlQuery.text.includes('source_location."fishingBaseId" IN'), false);
  });

  void it('rejects PostgreSQL counts outside the JavaScript safe integer range', async () => {
    const prisma = {
      $queryRaw: () =>
        Promise.resolve([databaseRow({ uniqueUsersCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n })]),
    } as unknown as PrismaService;

    await assert.rejects(
      new HoleStatisticsService(prisma).list(QUERY),
      /uniqueUsersCount exceeds the JavaScript safe integer range/,
    );
  });
});
