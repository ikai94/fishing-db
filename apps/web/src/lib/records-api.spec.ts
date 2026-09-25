import { describe, expect, test } from 'vitest';
import {
  decodeAdminRecordNotesResponse,
  decodeAdminWrongMaxIssuesResponse,
  decodeRecordsResponse,
} from './records-api';

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
      fish: { id: 'fish', name: 'Рыба', isRarest: true, isNightBiting: true },
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
              bait: 'Червь',
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
              bait: null,
              playerName: 'Игрок',
              caughtAt: '2026-09-09T10:00:00Z',
            },
            normalMaxWeightGrams: 1_000,
            headroomGrams: 0,
            headroomPercent: 0,
            status: 'MAXIMUM',
          },
        ],
      }).items[0]?.record?.bait,
    ).toBeNull();
    expect(() => decodeRecordsResponse({ ...base, items: [{ ...item, state: 'RECORD' }] })).toThrow(
      /Несогласованное/u,
    );
    expect(() =>
      decodeRecordsResponse({ ...base, items: [{ ...item, contributorKey: 'private' }] }),
    ).toThrow(/Некорректный рекорд/u);
  });

  test('keeps the ADMIN notes contract separate and exact', () => {
    expect(
      decodeAdminRecordNotesResponse({ items: [{ fishId: 'fish', note: 'Проверить базу' }] }),
    ).toEqual({ items: [{ fishId: 'fish', note: 'Проверить базу' }] });
    expect(() =>
      decodeAdminRecordNotesResponse({
        items: [{ fishId: 'fish', note: 'Проверить базу', private: true }],
      }),
    ).toThrow(/Некорректный элемент заметок/u);
  });

  test('keeps wrong-max metadata in a strict ADMIN-only contract', () => {
    const issue = {
      fishId: 'fish',
      expectedWeightGrams: 1234,
      note: 'Проверить',
      createdAt: '2026-09-20T00:00:00Z',
      updatedAt: '2026-09-25T00:00:00Z',
    };
    expect(decodeAdminWrongMaxIssuesResponse({ items: [issue] })).toEqual({ items: [issue] });
    expect(() =>
      decodeAdminWrongMaxIssuesResponse({ items: [{ ...issue, updatedByUserId: 'private' }] }),
    ).toThrow(/Некорректный элемент проблемы нашего max/u);
    expect(() =>
      decodeAdminWrongMaxIssuesResponse({
        items: [{ ...issue, expectedWeightGrams: 0 }],
      }),
    ).toThrow(/ожидаемый вес/u);
  });
});
