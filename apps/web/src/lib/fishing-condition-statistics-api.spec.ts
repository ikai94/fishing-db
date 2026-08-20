import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import {
  decodeFishingConditionStatistic,
  decodeFishingConditionStatisticsResponse,
  listFishingConditionStatistics,
} from './fishing-condition-statistics-api';

const baitFishing = {
  fishingMethod: 'BAIT_FISHING' as const,
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-13T12:34:56.000Z',
};

const spinning = {
  fishingMethod: 'SPINNING' as const,
  fishingNote: 'MIDWATER' as const,
  spinningSize: 'MEDIUM' as const,
  spinningSpeed: 'FAST' as const,
  uniqueUsersCount: 3,
  reportsCount: 5,
  latestReportCreatedAt: '2026-08-12T10:00:00.000Z',
};

describe('fishing condition statistics decoder', () => {
  test('accepts the two method-specific shapes and nullable notes', () => {
    expect(decodeFishingConditionStatisticsResponse({ items: [baitFishing, spinning] })).toEqual([
      baitFishing,
      spinning,
    ]);
    expect(
      decodeFishingConditionStatisticsResponse({
        items: [
          { ...baitFishing, fishingNote: 'FROM_BOTTOM' },
          { ...spinning, fishingNote: null },
        ],
      }),
    ).toEqual([
      { ...baitFishing, fishingNote: 'FROM_BOTTOM' },
      { ...spinning, fishingNote: null },
    ]);
    expect(decodeFishingConditionStatisticsResponse({ items: [] })).toEqual([]);
  });

  test.each([
    { ...baitFishing, spinningSize: 'SMALL' },
    { ...baitFishing, spinningSpeed: 'SLOW' },
    { ...spinning, spinningSize: null },
    { ...spinning, spinningSpeed: null },
    { ...spinning, spinningSize: 'HUGE' },
    { ...spinning, spinningSpeed: 'QUICK' },
  ])('rejects a row that violates its stored fishing method invariant', (value) => {
    expect(() => decodeFishingConditionStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику условий ловли',
    );
  });

  test.each([
    { ...baitFishing, author: { id: 'user-1', nickname: 'Скрытый автор' } },
    { ...baitFishing, userId: 'user-1' },
    { ...baitFishing, rawSourceText: 'исходная строка' },
    { ...baitFishing, userNoteRaw: 'комментарий' },
    { ...baitFishing, holeDepthCm: 600 },
    { ...baitFishing, spotPositionRaw: 'у блокнота' },
    { ...baitFishing, baitId: 'bait-1' },
  ])('rejects fields outside the aggregate allowlist', (value) => {
    expect(() => decodeFishingConditionStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику условий ловли',
    );
  });

  test.each([
    { ...baitFishing, fishingMethod: 'LURE' },
    { ...baitFishing, fishingNote: 'NEAR_REEDS' },
    { ...baitFishing, uniqueUsersCount: 0 },
    { ...baitFishing, uniqueUsersCount: 19 },
    { ...baitFishing, reportsCount: Number.MAX_SAFE_INTEGER + 1 },
    { ...baitFishing, latestReportCreatedAt: 'not-a-date' },
    { ...baitFishing, latestReportCreatedAt: '2026-08-13' },
  ])('rejects malformed aggregate values', (value) => {
    expect(() => decodeFishingConditionStatistic(value)).toThrow(
      'Сервер вернул некорректную статистику условий ловли',
    );
  });

  test('rejects duplicate aggregate identities and malformed wrappers', () => {
    expect(() =>
      decodeFishingConditionStatisticsResponse({
        items: [baitFishing, { ...baitFishing, reportsCount: 19 }],
      }),
    ).toThrow();
    expect(() => decodeFishingConditionStatisticsResponse([])).toThrow();
    expect(() => decodeFishingConditionStatisticsResponse({ items: 'not-an-array' })).toThrow();
    expect(() => decodeFishingConditionStatisticsResponse({ items: [], users: [] })).toThrow();
  });
});

describe('fishing condition statistics request', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ items: [baitFishing] });
  });

  test('serializes one deterministic Fish/Base scope and forwards the abort signal', async () => {
    const controller = new AbortController();

    await expect(
      listFishingConditionStatistics({
        fishId: 'fish id',
        baseIds: ['base-b', 'base-a', 'base-b'],
        signal: controller.signal,
      }),
    ).resolves.toEqual([baitFishing]);

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/conditions?fishId=fish+id&baseIds=base-a%2Cbase-b',
      { signal: controller.signal },
    );
  });

  test('rejects zero and more than 100 unique Bases without sending a request', async () => {
    await expect(listFishingConditionStatistics({ fishId: 'fish-1', baseIds: [] })).rejects.toThrow(
      'хотя бы одну рыболовную базу',
    );
    await expect(
      listFishingConditionStatistics({
        fishId: 'fish-1',
        baseIds: Array.from({ length: 101 }, (_, index) => `base-${index}`),
      }),
    ).rejects.toThrow('не более 100');

    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});
