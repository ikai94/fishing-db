import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import {
  decodeBaitStatistic,
  decodeBaitStatisticsResponse,
  listBaitStatistics,
} from './bait-statistics-api';

const statistic = {
  bait: { id: 'bait-a', name: 'Мотыль', isActive: false },
  reportsCount: 18,
};

describe('bait statistics decoder', () => {
  test('accepts one report count per Bait and preserves public values', () => {
    expect(decodeBaitStatisticsResponse({ items: [statistic] })).toEqual([statistic]);
    expect(decodeBaitStatisticsResponse({ items: [] })).toEqual([]);
  });

  test.each([
    { ...statistic, fishingMethod: 'SPINNING' },
    { ...statistic, uniqueUsersCount: 7 },
    { ...statistic, latestReportCreatedAt: '2026-08-13T12:34:56.000Z' },
    { ...statistic, author: { id: 'user-1', nickname: 'Скрытый автор' } },
    { ...statistic, rawSourceText: 'исходная строка' },
    { ...statistic, bait: { ...statistic.bait, type: 'LURE' } },
    { ...statistic, bait: { ...statistic.bait, nameNormalized: 'мотыль' } },
  ])('rejects fields outside the aggregate allowlist', (value) => {
    expect(() => decodeBaitStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику наживок и приманок',
    );
  });

  test.each([
    { ...statistic, reportsCount: 0 },
    { ...statistic, reportsCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...statistic, bait: { ...statistic.bait, id: '' } },
    { ...statistic, bait: { ...statistic.bait, isActive: 'no' } },
  ])('rejects malformed aggregate values', (value) => {
    expect(() => decodeBaitStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику наживок и приманок',
    );
  });

  test('rejects duplicate Baits and malformed wrappers', () => {
    expect(() => decodeBaitStatisticsResponse({ items: [statistic, statistic] })).toThrow();
    expect(() => decodeBaitStatisticsResponse([])).toThrow();
    expect(() => decodeBaitStatisticsResponse({ items: 'not-an-array' })).toThrow();
    expect(() => decodeBaitStatisticsResponse({ items: [], users: [] })).toThrow();
  });
});

describe('bait statistics request', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ items: [statistic] });
  });

  test('serializes a canonical Fish/Base scope and forwards the abort signal', async () => {
    const controller = new AbortController();

    await expect(
      listBaitStatistics({
        fishId: 'fish id',
        baseIds: ['base-b', 'base-a', 'base-b'],
        signal: controller.signal,
      }),
    ).resolves.toEqual([statistic]);

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/baits?fishId=fish+id&baseIds=base-a%2Cbase-b',
      { signal: controller.signal },
    );
  });

  test('omits the Base filter for all Bases and rejects more than 100 unique Bases', async () => {
    await expect(listBaitStatistics({ fishId: 'fish-1', baseIds: [] })).resolves.toEqual([
      statistic,
    ]);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catch-reports/statistics/baits?fishId=fish-1', {
      signal: undefined,
    });

    mocks.apiRequest.mockClear();
    await expect(
      listBaitStatistics({
        fishId: 'fish-1',
        baseIds: Array.from({ length: 101 }, (_, index) => `base-${index}`),
      }),
    ).rejects.toThrow('не более 100');
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
