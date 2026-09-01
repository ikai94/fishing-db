import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { WeightStatisticsService } from './weight-statistics.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';

void describe('WeightStatisticsService', () => {
  void it('left-joins current bounds and counts every report in exactly one class', async () => {
    let capturedQuery: unknown;
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([
          {
            suspiciousLow: 1n,
            ordinary: 2n,
            mutant: 3n,
            suspiciousHigh: 4n,
            unclassified: 5n,
          },
        ]);
      },
    } as unknown as PrismaService;

    const result = await new WeightStatisticsService(prisma).get({
      fishId: FISH_ID,
      baseIds: [BASE_ID],
    });
    const sql = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sql.values, [FISH_ID, BASE_ID]);
    assert.match(sql.text, /LEFT JOIN "FishingBaseFish" AS bounds/);
    assert.match(
      sql.text,
      /report\."weightGrams"::bigint \* 20 <= bounds\."maxWeightGrams"::bigint \* 21/,
    );
    assert.match(sql.text, /ELSE 'unclassified'/);
    assert.equal(sql.text.includes('"isActive"'), false);
    assert.deepEqual(result, {
      counts: {
        'suspicious-low': 1,
        ordinary: 2,
        mutant: 3,
        'suspicious-high': 4,
        unclassified: 5,
      },
    });
  });

  void it('accepts zeroes and rejects unsafe counts', async () => {
    const zeroRow = {
      suspiciousLow: 0n,
      ordinary: 0n,
      mutant: 0n,
      suspiciousHigh: 0n,
      unclassified: 0n,
    };
    const zeroPrisma = { $queryRaw: () => Promise.resolve([zeroRow]) } as unknown as PrismaService;
    assert.deepEqual(
      await new WeightStatisticsService(zeroPrisma).get({ fishId: FISH_ID, baseIds: [BASE_ID] }),
      {
        counts: {
          'suspicious-low': 0,
          ordinary: 0,
          mutant: 0,
          'suspicious-high': 0,
          unclassified: 0,
        },
      },
    );

    const unsafePrisma = {
      $queryRaw: () =>
        Promise.resolve([{ ...zeroRow, mutant: BigInt(Number.MAX_SAFE_INTEGER) + 1n }]),
    } as unknown as PrismaService;
    await assert.rejects(
      new WeightStatisticsService(unsafePrisma).get({ fishId: FISH_ID, baseIds: [BASE_ID] }),
      RangeError,
    );
  });
});
