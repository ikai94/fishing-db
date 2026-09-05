import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import {
  decodePersonalCatchRecordPage,
  decodePersonalCatchStatistics,
  listPersonalCatchRecords,
} from './personal-catch-statistics-api';

const item = { id: 'fish-1', name: 'Кижуч', isActive: false };

describe('personal catch statistics API', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('strictly decodes historical rankings and rejects provenance additions', () => {
    const payload = {
      totalCatches: 3,
      uniqueFishCount: 1,
      topFish: [{ item, reportsCount: 3 }],
      topBases: [],
      topLocations: [],
      topBaits: [],
    };
    expect(decodePersonalCatchStatistics(payload)).toEqual(payload);
    expect(() => decodePersonalCatchStatistics({ ...payload, contributorKey: 'private' })).toThrow(
      'некорректную личную статистику',
    );
  });

  test('decodes records and carries the opaque cursor in the request', async () => {
    const payload = {
      items: [
        {
          fish: item,
          maxWeightGrams: 950,
          representativeReport: {
            id: 'report-1',
            createdAt: '2026-08-12T22:30:00.000Z',
            fishingBase: { id: 'base-1', name: 'Амур', isActive: true },
            location: { id: 'location-1', number: 7, name: 'Протока', isActive: true },
            bait: { id: 'bait-1', name: 'Мотыль', isActive: true },
          },
        },
      ],
      nextCursor: 'next',
    };
    expect(decodePersonalCatchRecordPage(payload)).toEqual(payload);
    mocks.apiRequest.mockResolvedValue(payload);
    await listPersonalCatchRecords({ limit: 50, cursor: 'opaque' });
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/me/catch-reports/records?limit=50&cursor=opaque',
      { signal: undefined },
    );
  });
});
