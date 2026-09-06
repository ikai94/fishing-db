import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import {
  decodeSpotEvidencePage,
  decodeSpotStatisticsPage,
  listSpotEvidence,
  listSpotStatistics,
} from './spot-statistics-api';

const item = {
  groupKey: 'group-key',
  fishingBase: { id: 'base-1', name: 'База', isActive: true },
  location: { id: 'location-1', number: 2, name: 'Локация', isActive: false },
  holeDepthCm: null,
  spotPosition: 'У блокнота',
  contributorCount: 2,
  reportsCount: 3,
  fishCount: 2,
  topBaits: [
    {
      bait: { id: 'bait-1', name: 'Мотыль', isActive: false },
      contributorCount: 2,
      reportsCount: 3,
    },
  ],
  latestReportCreatedAt: '2026-09-01T00:00:00.000Z',
};

describe('spot statistics API', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('strictly decodes nullable identities, contributor metrics and top baits', () => {
    expect(
      decodeSpotStatisticsPage({
        items: [item],
        totalGroups: 1,
        scopedReportsCount: 4,
        unlocatedReportsCount: 1,
      }),
    ).toEqual({
      items: [item],
      totalGroups: 1,
      scopedReportsCount: 4,
      unlocatedReportsCount: 1,
    });

    expect(() =>
      decodeSpotStatisticsPage({
        items: [{ ...item, contributorKey: 'private' }],
        totalGroups: 1,
        scopedReportsCount: 4,
        unlocatedReportsCount: 1,
      }),
    ).toThrow(/некорректную статистику/u);
  });

  test('builds canonical Fish and Location queries and keeps evidence scope', async () => {
    mocks.apiRequest.mockResolvedValueOnce({
      items: [],
      totalGroups: 0,
      scopedReportsCount: 0,
      unlocatedReportsCount: 0,
    });
    await listSpotStatistics({
      scope: { kind: 'fish', fishId: 'fish-1', baseIds: ['base-b', 'base-a', 'base-a'] },
      limit: 25,
      offset: 50,
    });
    expect(mocks.apiRequest.mock.calls[0]?.[0]).toBe(
      '/catch-reports/statistics/spots?fishId=fish-1&baseIds=base-a%2Cbase-b&limit=25&offset=50',
    );

    mocks.apiRequest.mockResolvedValueOnce({ items: [], nextCursor: null });
    await listSpotEvidence({
      scope: { kind: 'location', locationId: 'location-1', fishIds: ['fish-b', 'fish-a'] },
      groupKey: 'group-key',
      cursor: 'cursor',
    });
    expect(mocks.apiRequest.mock.calls[1]?.[0]).toBe(
      '/catch-reports/statistics/spots/reports?locationId=location-1&fishIds=fish-a%2Cfish-b&groupKey=group-key&cursor=cursor',
    );
  });

  test('reuses the strict public report decoder for evidence', () => {
    expect(() =>
      decodeSpotEvidencePage({
        items: [{ rawSourceText: 'private' }],
        nextCursor: null,
      }),
    ).toThrow();
  });
});
