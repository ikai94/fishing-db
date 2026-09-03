import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import {
  decodeHoleStatistic,
  decodeHoleStatisticsResponse,
  listHoleStatistics,
} from './hole-statistics-api';

const statistic = {
  fishingBase: { id: 'base-a', name: 'Амур', isActive: true },
  location: {
    id: 'location-a',
    number: 12,
    name: 'Судачий откос',
    isActive: false,
  },
  holeDepthCm: 600,
  spotPosition: 'у блокнота',
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-13T12:34:56.000Z',
};

describe('hole statistics decoder', () => {
  test('accepts only the explicit aggregate response and preserves its public values', () => {
    expect(decodeHoleStatisticsResponse({ items: [statistic] })).toEqual([statistic]);
    expect(decodeHoleStatisticsResponse({ items: [] })).toEqual([]);
  });

  test.each([
    { ...statistic, author: { id: 'user-1', nickname: 'Скрытый автор' } },
    { ...statistic, userId: 'user-1' },
    { ...statistic, normalizedSpotKey: 'у блокнота' },
    { ...statistic, userNoteRaw: 'личный комментарий' },
    { ...statistic, rawSourceText: 'исходная строка' },
    { ...statistic, fishingBase: { ...statistic.fishingBase, isBanned: false } },
    { ...statistic, location: { ...statistic.location, fishingBaseId: 'base-a' } },
  ])('rejects fields outside the aggregate allowlist', (value) => {
    expect(() => decodeHoleStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику рыболовных точек',
    );
  });

  test.each([
    { ...statistic, holeDepthCm: null },
    { ...statistic, holeDepthCm: 600.5 },
    { ...statistic, spotPosition: '' },
    { ...statistic, uniqueUsersCount: 0 },
    { ...statistic, uniqueUsersCount: 19 },
    { ...statistic, reportsCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...statistic, latestReportCreatedAt: 'not-a-date' },
    { ...statistic, latestReportCreatedAt: '2026-08-13' },
    { ...statistic, fishingBase: { ...statistic.fishingBase, isActive: 'yes' } },
    { ...statistic, location: { ...statistic.location, number: 1.5 } },
  ])('rejects malformed aggregate values', (value) => {
    expect(() => decodeHoleStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику рыболовных точек',
    );
  });

  test('rejects malformed or expanded response wrappers', () => {
    expect(() => decodeHoleStatisticsResponse([])).toThrow();
    expect(() => decodeHoleStatisticsResponse({ items: 'not-an-array' })).toThrow();
    expect(() => decodeHoleStatisticsResponse({ items: [], users: [] })).toThrow();
  });
});

describe('hole statistics request', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ items: [statistic] });
  });

  test('serializes one deterministic Fish/Base scope and forwards the abort signal', async () => {
    const controller = new AbortController();

    await expect(
      listHoleStatistics({
        fishId: 'fish id',
        baseIds: ['base-b', 'base-a', 'base-b'],
        signal: controller.signal,
      }),
    ).resolves.toEqual([statistic]);

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/holes?fishId=fish+id&baseIds=base-a%2Cbase-b',
      { signal: controller.signal },
    );
  });

  test('omits the Base filter for all Bases and rejects more than 100 unique Bases', async () => {
    await expect(listHoleStatistics({ fishId: 'fish-1', baseIds: [] })).resolves.toEqual([
      statistic,
    ]);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catch-reports/statistics/holes?fishId=fish-1', {
      signal: undefined,
    });

    mocks.apiRequest.mockClear();
    await expect(
      listHoleStatistics({
        fishId: 'fish-1',
        baseIds: Array.from({ length: 101 }, (_, index) => `base-${index}`),
      }),
    ).rejects.toThrow('не более 100');

    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
