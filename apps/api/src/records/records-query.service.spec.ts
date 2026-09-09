import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessOfficialRecord, RecordsQueryService } from './records-query.service.js';

void describe('official record assessment', () => {
  void it('uses normal max as the headroom percentage denominator', () => {
    assert.deepEqual(assessOfficialRecord(9_000, 10_000), {
      headroomGrams: 1_000,
      headroomPercent: 10,
      status: 'CAN_BEAT',
    });
  });

  void it('classifies the approved gram boundaries', () => {
    assert.equal(assessOfficialRecord(989, 1_000).status, 'CAN_BEAT');
    assert.equal(assessOfficialRecord(990, 1_000).status, 'NEAR_MAX');
    assert.equal(assessOfficialRecord(1_000, 1_000).status, 'NEAR_MAX');
    assert.equal(assessOfficialRecord(1_001, 1_000).status, 'MUTANT');
  });

  void it('keeps missing records and unknown maxima distinct', () => {
    assert.equal(assessOfficialRecord(null, 1_000).status, 'NO_RECORD');
    assert.equal(assessOfficialRecord(900, null).status, 'MAX_UNKNOWN');
  });
});

void describe('public records projection', () => {
  void it('starts from every active Fish and returns all Bases tied for normal max', async () => {
    const prisma = {
      fish: {
        findMany: (query: unknown) => {
          assert.deepEqual((query as { where: unknown }).where, { isActive: true });
          return Promise.resolve([
            {
              id: 'fish-a',
              name: 'А',
              fishingBaseLinks: [
                {
                  maxWeightGrams: 1_000,
                  fishingBase: { id: 'base-b', name: 'База Б', isActive: true },
                },
                {
                  maxWeightGrams: 1_000,
                  fishingBase: { id: 'base-a', name: 'База А', isActive: false },
                },
              ],
            },
            { id: 'fish-b', name: 'Б', fishingBaseLinks: [] },
          ]);
        },
      },
      officialRecordSnapshot: {
        findFirst: () =>
          Promise.resolve({
            fetchedAt: new Date('2026-09-09T10:00:00Z'),
            rows: [
              {
                fishId: 'fish-a',
                weightGrams: 900,
                waterbodyRaw: 'База А',
                playerNameRaw: 'Игрок',
                caughtAt: new Date('2026-09-09T09:00:00Z'),
                fishingBase: null,
              },
            ],
          }),
      },
      officialRecordSyncState: {
        findUnique: () =>
          Promise.resolve({ lastAttemptAt: null, lastSuccessAt: null, lastError: null }),
      },
    };
    const response = await new RecordsQueryService(prisma as never).getPublicRecords(
      new Date('2026-09-09T12:00:00Z'),
    );
    assert.equal(response.items.length, 2);
    assert.equal(response.items[0]?.state, 'RECORD');
    assert.deepEqual(
      response.items[0]?.maxBases.map((base) => base.name),
      ['База А', 'База Б'],
    );
    assert.equal(response.items[1]?.state, 'NO_RECORD');
    assert.equal(response.items[1]?.status, 'NO_RECORD');
  });

  void it('uses UNKNOWN for every Fish before this week has an accepted snapshot', async () => {
    const prisma = {
      fish: {
        findMany: () => Promise.resolve([{ id: 'fish', name: 'Рыба', fishingBaseLinks: [] }]),
      },
      officialRecordSnapshot: { findFirst: () => Promise.resolve(null) },
      officialRecordSyncState: { findUnique: () => Promise.resolve(null) },
    };
    const response = await new RecordsQueryService(prisma as never).getPublicRecords(
      new Date('2026-09-09T12:00:00Z'),
    );
    assert.equal(response.items[0]?.state, 'UNKNOWN');
    assert.equal(response.items[0]?.status, null);
  });
});
