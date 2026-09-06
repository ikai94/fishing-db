import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SpotAnalyticsService } from './spot-analytics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const LOCATION_ID = '30000000-0000-4000-8000-000000000001';
const BAIT_ID = '70000000-0000-4000-8000-000000000001';

void describe('SpotAnalyticsService', () => {
  void it('loads metadata, aggregate page and top baits in one repeatable-read snapshot', async () => {
    const sqlQueries: Array<{ text: string; values: unknown[] }> = [];
    let transactionOptions: unknown;
    const responses = [
      [{ scopedReportsCount: 4n, unlocatedReportsCount: 1n, totalGroups: 1n }],
      [
        {
          fishingBaseId: BASE_ID,
          fishingBaseName: 'База',
          fishingBaseIsActive: true,
          locationId: LOCATION_ID,
          locationNumber: 3,
          locationName: 'Локация',
          locationIsActive: false,
          holeDepthCm: null,
          normalizedSpotKey: 'у блокнота',
          spotPosition: 'У БЛОКНОТА',
          contributorCount: 2n,
          reportsCount: 3n,
          fishCount: 1n,
          latestReportCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
      [
        {
          locationId: LOCATION_ID,
          holeDepthCm: null,
          normalizedSpotKey: 'у блокнота',
          baitId: BAIT_ID,
          baitName: 'Мотыль',
          baitIsActive: false,
          contributorCount: 2n,
          reportsCount: 3n,
        },
      ],
    ];
    const tx = {
      fish: { findFirst: () => Promise.resolve({ id: FISH_ID }) },
      fishingBase: { findMany: () => Promise.resolve([{ id: BASE_ID }]) },
      $queryRaw: (query: { text: string; values: unknown[] }) => {
        sqlQueries.push(query);
        return Promise.resolve(responses.shift());
      },
    };
    const prisma = {
      $transaction: async (
        operation: (transaction: typeof tx) => Promise<unknown>,
        options: unknown,
      ) => {
        transactionOptions = options;
        return operation(tx);
      },
    } as unknown as PrismaService;

    const result = await new SpotAnalyticsService(prisma).list({
      fishId: FISH_ID,
      baseIds: [BASE_ID],
      limit: 25,
      offset: 0,
    });

    assert.deepEqual(transactionOptions, { isolationLevel: 'RepeatableRead' });
    assert.equal(sqlQueries.length, 3);
    assert.ok(
      sqlQueries.every((query) => query.text.includes('normalize(report."spotPositionRaw", NFKC)')),
    );
    assert.equal(JSON.stringify(result).includes('normalizedSpotKey'), false);
    assert.equal(result.items[0]?.contributorCount, 2);
    assert.equal(result.items[0]?.topBaits[0]?.reportsCount, 3);
    assert.equal(result.unlocatedReportsCount, 1);
  });
});
