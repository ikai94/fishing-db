import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseFishNotebookService } from './base-fish-notebook.service.js';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

void test('all membership rows use one aggregate query and preserve nullable database weights', async () => {
  let aggregateCalls = 0;
  let noteCalls = 0;
  const prisma = {
    baseFishNotebookEntry: {
      findMany: (args: unknown) => {
        noteCalls += 1;
        assert.deepEqual(args, {
          where: { userId: 'admin', fishingBaseId: 'base' },
          select: { fishId: true, noteText: true, isHidden: true },
        });
        return Promise.resolve([{ fishId: 'fish-0', noteText: 'Личная заметка', isHidden: true }]);
      },
    },
    fishingBase: {
      findUnique: () =>
        Promise.resolve({
          id: 'base',
          name: 'База',
          fishLinks: Array.from({ length: 100 }, (_, index) => ({
            fish: {
              id: `fish-${index}`,
              name: `Рыба ${index}`,
              officialFishImageKey: null,
              isRarest: index === 0,
              isNightBiting: index === 0,
            },
            minWeightGrams: null,
            maxWeightGrams: 123,
          })),
        }),
    },
    $queryRaw: () => {
      aggregateCalls += 1;
      return Promise.resolve([
        {
          fishId: 'fish-0',
          id: 'location',
          name: 'Локация',
          number: 1,
          reportsCount: 7n,
          totalCatchReports: 10n,
        },
      ]);
    },
  };
  const result = await new BaseFishNotebookService(
    prisma as unknown as PrismaService,
    new DisabledFishImageDelivery(),
  ).getNotebook('base', 'admin');
  assert.equal(aggregateCalls, 1);
  assert.equal(noteCalls, 1);
  assert.equal(result.rows.length, 100);
  assert.equal(result.rows[0].topLocations[0].reportsCount, 7);
  assert.equal(result.rows[99].minWeightGrams, null);
  assert.equal(result.rows[99].maxWeightGrams, 123);
  assert.equal(result.rows[0].noteText, 'Личная заметка');
  assert.equal(result.rows[99].noteText, null);
  assert.equal(result.rows[0].isHidden, true);
  assert.equal(result.rows[99].isHidden, false);
  assert.equal(result.rows[0].totalCatchReports, 10);
  assert.equal(result.rows[99].totalCatchReports, 0);
  assert.equal(result.rows[0].fish.isRarest, true);
  assert.equal(result.rows[0].fish.isNightBiting, true);
  assert.equal(result.rows[99].fish.isRarest, false);
  assert.equal(result.rows[99].fish.isNightBiting, false);
});

void test('rejects unsafe PostgreSQL bigint counts, including totals with safe location counts', async () => {
  const prisma = {
    baseFishNotebookEntry: { findMany: () => Promise.resolve([]) },
    fishingBase: {
      findUnique: () =>
        Promise.resolve({
          id: 'base',
          name: 'База',
          fishLinks: [
            {
              fish: {
                id: 'fish',
                name: 'Рыба',
                officialFishImageKey: null,
                isRarest: false,
                isNightBiting: false,
              },
              minWeightGrams: null,
              maxWeightGrams: null,
            },
          ],
        }),
    },
    $queryRaw: () =>
      Promise.resolve([
        {
          fishId: 'fish',
          id: 'location',
          name: 'Локация',
          number: 1,
          reportsCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
          totalCatchReports: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        },
      ]),
  };
  for (const reportsCount of [1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    prisma.$queryRaw = () =>
      Promise.resolve([
        {
          fishId: 'fish',
          id: 'location',
          name: 'Локация',
          number: 1,
          reportsCount,
          totalCatchReports: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        },
      ]);
    await assert.rejects(
      new BaseFishNotebookService(
        prisma as unknown as PrismaService,
        new DisabledFishImageDelivery(),
      ).getNotebook('base', 'admin'),
      /безопасного диапазона/u,
    );
  }
});
