import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFishingBase: vi.fn(),
  listBaits: vi.fn(),
  listFishingBases: vi.fn(),
  listScreenAnchors: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  getFishingBase: mocks.getFishingBase,
  listBaits: mocks.listBaits,
  listFishingBases: mocks.listFishingBases,
  listScreenAnchors: mocks.listScreenAnchors,
}));

import {
  CatchReportFormCatalogProvider,
  useSharedCatchReportFormCatalog,
} from './catch-report-form-catalog-context';

function Consumer() {
  const catalog = useSharedCatchReportFormCatalog();
  useEffect(() => {
    if (catalog?.state.kind === 'ready') void catalog.loadBase('base-1');
  }, [catalog]);
  return null;
}

describe('CatchReportFormCatalogProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFishingBases.mockResolvedValue([{ id: 'base-1', name: 'Амур' }]);
    mocks.listBaits.mockResolvedValue([{ id: 'bait-1', name: 'Мотыль', type: 'BAIT' }]);
    mocks.listScreenAnchors.mockResolvedValue([]);
    mocks.getFishingBase.mockResolvedValue({
      id: 'base-1',
      name: 'Амур',
      locations: [],
      fish: [],
    });
  });

  test('loads shared catalogs once and caches Base details across rows', async () => {
    render(
      <CatchReportFormCatalogProvider>
        <Consumer />
        <Consumer />
      </CatchReportFormCatalogProvider>,
    );

    await waitFor(() => expect(mocks.getFishingBase).toHaveBeenCalledTimes(1));
    expect(mocks.listFishingBases).toHaveBeenCalledTimes(1);
    expect(mocks.listBaits).toHaveBeenCalledTimes(1);
    expect(mocks.listScreenAnchors).toHaveBeenCalledTimes(1);
    expect(mocks.getFishingBase).toHaveBeenCalledWith('base-1', expect.any(AbortSignal));
  });
});
