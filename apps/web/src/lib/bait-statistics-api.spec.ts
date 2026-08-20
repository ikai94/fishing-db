import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import {
  decodeBaitStatistic,
  decodeBaitStatisticsResponse,
  listBaitStatistics,
} from './bait-statistics-api';

const statistic = {
  bait: { id: 'bait-a', name: 'Мотыль', isActive: false },
  fishingMethod: 'BAIT_FISHING' as const,
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-13T12:34:56.000Z',
};

describe('bait statistics decoder', () => {
  test('accepts both historical methods for one Bait ID and preserves the public values', () => {
    const spinning = { ...statistic, fishingMethod: 'SPINNING' as const };

    expect(decodeBaitStatisticsResponse({ items: [statistic, spinning] })).toEqual([
      statistic,
      spinning,
    ]);
    expect(decodeBaitStatisticsResponse({ items: [] })).toEqual([]);
  });

  test.each([
    { ...statistic, author: { id: 'user-1', nickname: 'Скрытый автор' } },
    { ...statistic, userId: 'user-1' },
    { ...statistic, rawSourceText: 'исходная строка' },
    { ...statistic, userNoteRaw: 'личный комментарий' },
    { ...statistic, bait: { ...statistic.bait, type: 'LURE' } },
    { ...statistic, bait: { ...statistic.bait, nameNormalized: 'мотыль' } },
  ])('rejects fields outside the aggregate allowlist', (value) => {
    expect(() => decodeBaitStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику наживок и приманок',
    );
  });

  test.each([
    { ...statistic, fishingMethod: 'LURE' },
    { ...statistic, uniqueUsersCount: 0 },
    { ...statistic, uniqueUsersCount: 19 },
    { ...statistic, reportsCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...statistic, latestReportCreatedAt: 'not-a-date' },
    { ...statistic, latestReportCreatedAt: '2026-08-13' },
    { ...statistic, bait: { ...statistic.bait, id: '' } },
    { ...statistic, bait: { ...statistic.bait, isActive: 'no' } },
  ])('rejects malformed aggregate values', (value) => {
    expect(() => decodeBaitStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику наживок и приманок',
    );
  });

  test('rejects duplicate aggregate identities and malformed wrappers', () => {
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

  test('serializes one deterministic Fish/Base scope and forwards the abort signal', async () => {
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

  test('rejects zero and more than 100 unique Bases without sending a request', async () => {
    await expect(listBaitStatistics({ fishId: 'fish-1', baseIds: [] })).rejects.toThrow(
      'хотя бы одну рыболовную базу',
    );
    await expect(
      listBaitStatistics({
        fishId: 'fish-1',
        baseIds: Array.from({ length: 101 }, (_, index) => `base-${index}`),
      }),
    ).rejects.toThrow('не более 100');

    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
