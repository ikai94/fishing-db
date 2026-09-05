import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  buildPersonalCatchRecordsQuery,
  buildPersonalNamedRankingQuery,
  PersonalCatchStatisticsService,
} from './personal-catch-statistics.service.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const LOCATION_ID = '70000000-0000-4000-8000-000000000001';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';
const REPORT_ID = '80000000-0000-4000-8000-000000000001';

void describe('PersonalCatchStatisticsService', () => {
  void it('scopes rankings to native reports and orders deterministic top tens', () => {
    const query = buildPersonalNamedRankingQuery(USER_ID, 'fish') as {
      text: string;
      values: unknown[];
    };

    assert.deepEqual(query.values, [USER_ID, `local-user:${USER_ID}`]);
    assert.match(query.text, /report\."userId" = \$1::uuid/);
    assert.match(query.text, /report\."importKey" IS NULL/);
    assert.match(query.text, /report\."contributorKey" = \$2/);
    assert.match(
      query.text,
      /ORDER BY COUNT\(\*\) DESC, fish\."nameNormalized" COLLATE "C" ASC, fish\."id" ASC/,
    );
    assert.match(query.text, /LIMIT 10/);
    assert.equal(query.text.includes('"FishingBaseFish"'), false);
  });

  void it('selects one max-weight report per Fish with the approved stable tie order', () => {
    const query = buildPersonalCatchRecordsQuery(USER_ID, 50) as {
      text: string;
      values: unknown[];
    };

    assert.match(query.text, /PARTITION BY report\."fishId"/);
    assert.match(
      query.text,
      /ORDER BY report\."weightGrams" DESC, report\."createdAt" ASC, report\."id" ASC/,
    );
    assert.match(query.text, /WHERE ranked\.position = 1/);
    assert.match(query.text, /ORDER BY fish\."nameNormalized" COLLATE "C" ASC, fish\."id" ASC/);
    assert.equal(query.text.includes('"FishingBaseFish"'), false);
  });

  void it('maps a consistent snapshot without exposing provenance fields', async () => {
    const queryResults = [
      [{ totalCatches: 3n, uniqueFishCount: 1n }],
      [{ id: FISH_ID, name: 'Карась', isActive: false, reportsCount: 3n }],
      [{ id: BASE_ID, name: 'Озеро', isActive: false, reportsCount: 3n }],
      [
        {
          id: LOCATION_ID,
          name: 'Залив',
          number: 2,
          isActive: false,
          baseId: BASE_ID,
          baseName: 'Озеро',
          baseIsActive: false,
          reportsCount: 3n,
        },
      ],
      [{ id: BAIT_ID, name: 'Червь', isActive: false, reportsCount: 3n }],
    ];
    const prisma = {
      $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
        let position = 0;
        return operation({ $queryRaw: () => Promise.resolve(queryResults[position++]) });
      },
    } as unknown as PrismaService;

    const result = await new PersonalCatchStatisticsService(prisma).getStatistics(USER_ID);
    assert.deepEqual(result, {
      totalCatches: 3,
      uniqueFishCount: 1,
      topFish: [{ item: { id: FISH_ID, name: 'Карась', isActive: false }, reportsCount: 3 }],
      topBases: [{ item: { id: BASE_ID, name: 'Озеро', isActive: false }, reportsCount: 3 }],
      topLocations: [
        {
          location: { id: LOCATION_ID, number: 2, name: 'Залив', isActive: false },
          fishingBase: { id: BASE_ID, name: 'Озеро', isActive: false },
          reportsCount: 3,
        },
      ],
      topBaits: [{ item: { id: BAIT_ID, name: 'Червь', isActive: false }, reportsCount: 3 }],
    });
    assert.equal(JSON.stringify(result).includes('contributorKey'), false);
    assert.equal(JSON.stringify(result).includes('importKey'), false);
  });

  void it('returns deterministic record representatives and cursor pagination', async () => {
    const createdAt = new Date('2026-08-01T10:00:00.000Z');
    const row = {
      fishId: FISH_ID,
      fishName: 'Карась',
      fishNameNormalized: 'карась',
      fishIsActive: false,
      maxWeightGrams: 950,
      reportId: REPORT_ID,
      reportCreatedAt: createdAt,
      baseId: BASE_ID,
      baseName: 'Озеро',
      baseIsActive: false,
      locationId: LOCATION_ID,
      locationNumber: 2,
      locationName: 'Залив',
      locationIsActive: false,
      baitId: BAIT_ID,
      baitName: 'Червь',
      baitIsActive: false,
    };
    const prisma = { $queryRaw: () => Promise.resolve([row, row]) } as unknown as PrismaService;

    const result = await new PersonalCatchStatisticsService(prisma).listRecords(USER_ID, {
      limit: 1,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.representativeReport.id, REPORT_ID);
    assert.equal(result.items[0]?.representativeReport.createdAt, createdAt);
    assert.equal(typeof result.nextCursor, 'string');
    assert.equal(JSON.stringify(result).includes('fishNameNormalized'), false);
  });
});
