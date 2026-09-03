import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import {
  decodeFishCatchAggregate,
  decodeFishCatchAggregatePage,
  listFishCatchAggregates,
} from './fish-catch-aggregates-api';

const aggregate = {
  fish: { id: 'fish-a', name: 'Сом' },
  fishingBase: { id: 'base-a', name: 'Ахтуба' },
  location: { id: 'location-a', number: 7, name: 'Судачий откос' },
  bait: { id: 'bait-a', name: 'Мотыль', isActive: false },
  spinningCombinations: [
    { spinningSpeed: 'MEDIUM', spinningSize: 'MEDIUM' },
    { spinningSpeed: 'MEDIUM', spinningSize: 'LARGE' },
    { spinningSpeed: 'MEDIUM', spinningSize: null },
    { spinningSpeed: null, spinningSize: 'LARGE' },
  ],
  holeSpotSummary: {
    distinctCount: 1,
    value: { holeDepthCm: 603, spotPositionRaw: 'над леской' },
  },
  userNoteRawSummary: { distinctCount: 2, value: null },
  intensity: 18,
  contributorCount: 7,
  maxObservedWeightGrams: 12_450,
  maxObservedWeightAssessment: {
    classification: 'mutant',
    minWeightGrams: 100,
    maxWeightGrams: 12_000,
  },
};

describe('Fish catch aggregate decoder', () => {
  test('accepts only the aggregate row/page contract', () => {
    expect(decodeFishCatchAggregatePage({ items: [aggregate], nextCursor: 'next' })).toEqual({
      items: [aggregate],
      nextCursor: 'next',
    });
    expect(decodeFishCatchAggregatePage({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  test.each([
    { ...aggregate, author: { id: 'user-a', nickname: 'Автор' } },
    { ...aggregate, contributorKey: 'private' },
    { ...aggregate, rawSourceText: 'private' },
    { ...aggregate, fishingMethod: 'SPINNING' },
    { ...aggregate, holeDepthCm: 600 },
    { ...aggregate, createdAt: '2026-08-13T12:00:00.000Z' },
    { ...aggregate, bait: { ...aggregate.bait, type: 'BAIT' } },
  ])('rejects report/private fields outside the exact allowlist', (value) => {
    expect(() => decodeFishCatchAggregate(value)).toThrow(
      'Сервер вернул некорректные агрегированные уловы',
    );
  });

  test.each([
    { ...aggregate, intensity: 0 },
    { ...aggregate, contributorCount: 19 },
    { ...aggregate, maxObservedWeightGrams: 0 },
    {
      ...aggregate,
      spinningCombinations: [{ spinningSpeed: null, spinningSize: null }],
    },
    {
      ...aggregate,
      spinningCombinations: [
        { spinningSpeed: 'MEDIUM', spinningSize: 'LARGE' },
        { spinningSpeed: 'MEDIUM', spinningSize: 'LARGE' },
      ],
    },
    {
      ...aggregate,
      spinningCombinations: [{ spinningSpeed: 'INVALID', spinningSize: 'LARGE' }],
    },
    { ...aggregate, holeSpotSummary: { distinctCount: -1, value: null } },
    { ...aggregate, holeSpotSummary: { distinctCount: 19, value: null } },
    {
      ...aggregate,
      holeSpotSummary: {
        distinctCount: 0,
        value: { holeDepthCm: 603, spotPositionRaw: null },
      },
    },
    { ...aggregate, holeSpotSummary: { distinctCount: 1, value: null } },
    {
      ...aggregate,
      holeSpotSummary: {
        distinctCount: 1,
        value: { holeDepthCm: null, spotPositionRaw: null },
      },
    },
    {
      ...aggregate,
      holeSpotSummary: {
        distinctCount: 1,
        value: { holeDepthCm: 0, spotPositionRaw: null },
      },
    },
    {
      ...aggregate,
      holeSpotSummary: {
        distinctCount: 1,
        value: { holeDepthCm: null, spotPositionRaw: '' },
      },
    },
    {
      ...aggregate,
      holeSpotSummary: {
        distinctCount: 2,
        value: { holeDepthCm: 603, spotPositionRaw: null },
      },
    },
    { ...aggregate, userNoteRawSummary: { distinctCount: 1, value: '' } },
    { ...aggregate, userNoteRawSummary: { distinctCount: 2, value: 'комментарий' } },
    { ...aggregate, location: { ...aggregate.location, number: 0 } },
    { ...aggregate, maxObservedWeightAssessment: null },
    {
      ...aggregate,
      maxObservedWeightAssessment: {
        classification: 'ordinary',
        minWeightGrams: 200,
        maxWeightGrams: 100,
      },
    },
  ])('rejects malformed aggregate values', (value) => {
    expect(() => decodeFishCatchAggregate(value)).toThrow();
  });

  test('rejects duplicate composite identities and malformed pages', () => {
    expect(() =>
      decodeFishCatchAggregatePage({ items: [aggregate, aggregate], nextCursor: null }),
    ).toThrow();
    expect(() => decodeFishCatchAggregatePage({ items: [], nextCursor: 7 })).toThrow();
    expect(() => decodeFishCatchAggregatePage({ items: [], nextCursor: null, total: 0 })).toThrow();
  });
});

describe('Fish catch aggregate request', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ items: [aggregate], nextCursor: 'next' });
  });

  test('serializes canonical scope/pagination and validates returned scope', async () => {
    const controller = new AbortController();
    await expect(
      listFishCatchAggregates({
        fishId: 'fish-a',
        baseIds: ['base-b', 'base-a', 'base-a'],
        limit: 20,
        cursor: 'cursor value',
        signal: controller.signal,
      }),
    ).resolves.toEqual({ items: [aggregate], nextCursor: 'next' });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/fish-catches?fishId=fish-a&baseIds=base-a%2Cbase-b&limit=20&cursor=cursor+value',
      { signal: controller.signal },
    );
  });

  test('supports all Bases while rejecting oversized scope, invalid limits, and mismatches', async () => {
    await expect(listFishCatchAggregates({ fishId: 'fish-a', baseIds: [] })).resolves.toEqual({
      items: [aggregate],
      nextCursor: 'next',
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/fish-catches?fishId=fish-a',
      { signal: undefined },
    );

    mocks.apiRequest.mockClear();
    await expect(
      listFishCatchAggregates({
        fishId: 'fish-a',
        baseIds: Array.from({ length: 101 }, (_, index) => `base-${index}`),
      }),
    ).rejects.toThrow();
    await expect(
      listFishCatchAggregates({ fishId: 'fish-a', baseIds: ['base-a'], limit: 0 }),
    ).rejects.toThrow();
    expect(mocks.apiRequest).toHaveBeenCalledTimes(0);

    mocks.apiRequest.mockResolvedValueOnce({
      items: [{ ...aggregate, fishingBase: { id: 'other-base', name: 'Другая' } }],
      nextCursor: null,
    });
    await expect(
      listFishCatchAggregates({ fishId: 'fish-a', baseIds: ['base-a'] }),
    ).rejects.toThrow('Сервер вернул некорректные агрегированные уловы');
  });
});
