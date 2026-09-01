import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import { decodeWeightStatistics, listWeightStatistics } from './weight-statistics-api';

const response = {
  counts: {
    'suspicious-low': 1,
    ordinary: 2,
    mutant: 3,
    'suspicious-high': 4,
    unclassified: 5,
  },
};

describe('weight statistics API', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('strictly decodes all classification counts', () => {
    expect(decodeWeightStatistics(response)).toEqual(response.counts);
    expect(() => decodeWeightStatistics({ counts: { ...response.counts, extra: 0 } })).toThrow();
    expect(() => decodeWeightStatistics({ counts: { ...response.counts, mutant: -1 } })).toThrow();
  });

  test('requests canonical Fish/Base scope and propagates cancellation', async () => {
    mocks.apiRequest.mockResolvedValue(response);
    const controller = new AbortController();
    await expect(
      listWeightStatistics({
        fishId: 'fish-a',
        baseIds: ['base-b', 'base-a', 'base-a'],
        signal: controller.signal,
      }),
    ).resolves.toEqual(response.counts);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports/statistics/weights?fishId=fish-a&baseIds=base-a%2Cbase-b',
      { signal: controller.signal },
    );
  });
});
