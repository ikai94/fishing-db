import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { FishCatchAggregateQueryDto } from './dto/fish-catch-aggregate-query.dto.js';
import {
  FishCatchAggregatesService,
  type FishCatchAggregateDatabaseRow,
} from './fish-catch-aggregates.service.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const LOCATION_ID = '70000000-0000-4000-8000-000000000001';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';

const QUERY: FishCatchAggregateQueryDto = {
  fishId: FISH_ID,
  baseIds: [BASE_ID],
  limit: 1,
};

function databaseRow(
  overrides: Partial<FishCatchAggregateDatabaseRow> = {},
): FishCatchAggregateDatabaseRow {
  return {
    fishId: FISH_ID,
    fishName: 'Сом',
    baseId: BASE_ID,
    baseName: 'Ахтуба',
    baseNameNormalized: 'ахтуба',
    locationId: LOCATION_ID,
    locationNumber: 7,
    locationName: 'Судачий откос',
    baitId: BAIT_ID,
    baitName: 'Мотыль',
    baitNameNormalized: 'мотыль',
    baitIsActive: false,
    intensity: 18n,
    contributorCount: 7n,
    maxObservedWeightGrams: 12_450,
    ...overrides,
  };
}

void describe('FishCatchAggregatesService', () => {
  void it('groups only the approved identity and maps a private-key-free aggregate page', async () => {
    let capturedQuery: unknown;
    const secondBaitId = '50000000-0000-4000-8000-000000000002';
    const prisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([databaseRow(), databaseRow({ baitId: secondBaitId })]);
      },
    } as unknown as PrismaService;

    const result = await new FishCatchAggregatesService(prisma).list(QUERY);
    const sqlQuery = capturedQuery as { text: string; values: unknown[] };

    assert.deepEqual(sqlQuery.values, [FISH_ID, BASE_ID, 2]);
    assert.match(sqlQuery.text, /COUNT\(\*\) AS "intensity"/);
    assert.match(sqlQuery.text, /COUNT\(DISTINCT report\."contributorKey"\) AS "contributorCount"/);
    assert.match(sqlQuery.text, /MAX\(report\."weightGrams"\) AS "maxObservedWeightGrams"/);
    assert.match(
      sqlQuery.text,
      /GROUP BY\s+fish\."id",\s+fishing_base\."id",\s+source_location\."id",\s+bait\."id"/,
    );
    for (const field of [
      'holeDepthCm',
      'spotPositionRaw',
      'fishingNote',
      'fishingMethod',
      'spinningSize',
      'spinningSpeed',
      'userNoteRaw',
      'createdAt',
      'userId',
    ]) {
      assert.equal(sqlQuery.text.includes(field), false, field);
    }
    assert.equal(sqlQuery.text.includes('"FishingBaseFish"'), false);
    assert.match(
      sqlQuery.text,
      /ORDER BY\s+aggregate_row\."baseNameNormalized" COLLATE "C" ASC,\s+aggregate_row\."baseId" ASC,\s+aggregate_row\."locationNumber" ASC,\s+aggregate_row\."locationId" ASC,\s+aggregate_row\."intensity" DESC,\s+aggregate_row\."baitNameNormalized" COLLATE "C" ASC,\s+aggregate_row\."baitId" ASC/,
    );
    assert.deepEqual(result.items, [
      {
        fish: { id: FISH_ID, name: 'Сом' },
        fishingBase: { id: BASE_ID, name: 'Ахтуба' },
        location: { id: LOCATION_ID, number: 7, name: 'Судачий откос' },
        bait: { id: BAIT_ID, name: 'Мотыль', isActive: false },
        intensity: 18,
        contributorCount: 7,
        maxObservedWeightGrams: 12_450,
      },
    ]);
    assert.ok(result.nextCursor);
    assert.equal(JSON.stringify(result).includes('contributorKey'), false);
  });

  void it('uses the complete ordering tuple for the next-page keyset', async () => {
    let capturedQuery: unknown;
    const firstPrisma = {
      $queryRaw: () =>
        Promise.resolve([
          databaseRow(),
          databaseRow({ baitId: '50000000-0000-4000-8000-000000000002' }),
        ]),
    } as unknown as PrismaService;
    const firstPage = await new FishCatchAggregatesService(firstPrisma).list(QUERY);
    assert.ok(firstPage.nextCursor);

    const nextPrisma = {
      $queryRaw: (query: unknown) => {
        capturedQuery = query;
        return Promise.resolve([]);
      },
    } as unknown as PrismaService;
    await new FishCatchAggregatesService(nextPrisma).list({
      ...QUERY,
      cursor: firstPage.nextCursor,
    });
    const sqlQuery = capturedQuery as { text: string };

    assert.match(sqlQuery.text, /"baseNameNormalized" COLLATE "C" >/);
    assert.match(sqlQuery.text, /"baseId" >/);
    assert.match(sqlQuery.text, /"locationNumber" >/);
    assert.match(sqlQuery.text, /"locationId" >/);
    assert.match(sqlQuery.text, /"intensity" </);
    assert.match(sqlQuery.text, /"baitNameNormalized" COLLATE "C" >/);
    assert.match(sqlQuery.text, /"baitId" >/);
  });

  void it('rejects unsafe or inconsistent aggregate counts', async () => {
    for (const row of [
      databaseRow({ intensity: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
      databaseRow({ contributorCount: 19n }),
    ]) {
      const prisma = { $queryRaw: () => Promise.resolve([row]) } as unknown as PrismaService;
      await assert.rejects(new FishCatchAggregatesService(prisma).list(QUERY), RangeError);
    }
  });
});
