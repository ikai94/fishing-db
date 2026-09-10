import { describe, expect, test } from 'vitest';
import { decodeRecordsResponse } from './records-api';

describe('records API decoder', () => {
  test('accepts distinct no-record and unknown states and rejects a record without payload', () => {
    const base = {
      week: {
        startsAt: '2026-09-06T19:00:00Z',
        endsAt: '2026-09-13T19:00:00Z',
        timezone: 'Europe/Moscow',
        serverNow: '2026-09-09T12:00:00Z',
      },
      sync: { status: 'WAITING', observedAt: null, lastAttemptAt: null, lastSuccessAt: null },
    };
    const item = {
      fish: { id: 'fish', name: 'Рыба', isRarest: true },
      state: 'UNKNOWN',
      record: null,
      normalMaxWeightGrams: null,
      maxBases: [],
      headroomGrams: null,
      headroomPercent: null,
      status: null,
    };
    expect(decodeRecordsResponse({ ...base, items: [item] }).items[0]?.state).toBe('UNKNOWN');
    expect(decodeRecordsResponse({ ...base, items: [item] }).items[0]?.fish.isRarest).toBe(true);
    expect(
      decodeRecordsResponse({
        ...base,
        items: [
          {
            ...item,
            state: 'RECORD',
            record: {
              weightGrams: 1_000,
              waterbody: 'База',
              fishingBase: null,
              playerName: 'Игрок',
              caughtAt: '2026-09-09T10:00:00Z',
            },
            normalMaxWeightGrams: 1_000,
            headroomGrams: 0,
            headroomPercent: 0,
            status: 'MAXIMUM',
          },
        ],
      }).items[0]?.status,
    ).toBe('MAXIMUM');
    expect(() => decodeRecordsResponse({ ...base, items: [{ ...item, state: 'RECORD' }] })).toThrow(
      /Несогласованное/u,
    );
    expect(() =>
      decodeRecordsResponse({ ...base, items: [{ ...item, contributorKey: 'private' }] }),
    ).toThrow(/Некорректный рекорд/u);
  });
});
