import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  decodeAdminRarityReviewsResponse,
  decodeAdminRecordNotesResponse,
  decodeAdminWrongMaxIssuesResponse,
  decodeRecordsResponse,
  updateAdminNightMark,
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
      fish: { id: 'fish', name: 'Рыба', isRarest: true, isNightBiting: true, catchReportsCount: 0 },
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
    for (const catchReportsCount of [0, 12438, Number.MAX_SAFE_INTEGER]) {
      expect(
        decodeRecordsResponse({
          ...base,
          items: [{ ...item, fish: { ...item.fish, catchReportsCount } }],
        }).items[0]?.fish.catchReportsCount,
      ).toBe(catchReportsCount);
    }
    for (const catchReportsCount of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12', null, undefined]) {
      expect(() =>
        decodeRecordsResponse({
          ...base,
          items: [{ ...item, fish: { ...item.fish, catchReportsCount } }],
        }),
      ).toThrow(/количество уловов/u);
    }
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

  test('keeps rarity-review metadata in a minimal strict ADMIN-only contract', () => {
    expect(decodeAdminRarityReviewsResponse({ items: [{ fishId: 'fish' }] })).toEqual({
      items: [{ fishId: 'fish' }],
    });
    expect(() =>
      decodeAdminRarityReviewsResponse({ items: [{ fishId: 'fish', isRarest: true }] }),
    ).toThrow(/Некорректный элемент проверки редкости/u);
  });
});

afterEach(() => vi.unstubAllGlobals());

test('night mark reuses the ADMIN PATCH contract with credentials, no-store and optional cancellation', async () => {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ fish: { fishId: 'fish', isNightBiting: true } }), {
        status: 200,
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  expect(await updateAdminNightMark('fish', true, controller.signal)).toEqual({
    fish: { fishId: 'fish', isNightBiting: true },
  });
  expect(fetchMock).toHaveBeenLastCalledWith(
    expect.stringMatching(/\/api\/v1\/admin\/records\/night-marks\/fish$/),
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ isNightBiting: true }),
      credentials: 'include',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    }),
  );
  // Старые потребители страницы рекордов по-прежнему могут вызывать helper с двумя аргументами.
  await expect(updateAdminNightMark('fish', true)).resolves.toEqual({
    fish: { fishId: 'fish', isNightBiting: true },
  });
});

test.each([
  { fish: { fishId: 'fish', isNightBiting: 'true' } },
  { fish: { fishId: 'fish', isNightBiting: true, noteText: 'private' } },
  { fish: { fishId: 'fish', isNightBiting: true }, userId: 'private' },
])(
  'night mark refuses malformed or excessive fields instead of claiming success (%j)',
  async (payload) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
    );
    await expect(updateAdminNightMark('fish', true)).rejects.toThrow();
  },
);

test('night mark propagates HTTP failures and caller abort without artificial success', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'ADMIN_REQUIRED' }), { status: 403 }),
      ),
  );
  await expect(updateAdminNightMark('fish', true)).rejects.toMatchObject({ status: 403 });
  const controller = new AbortController();
  const fetchMock = vi.fn().mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const pending = updateAdminNightMark('fish', true, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
});
