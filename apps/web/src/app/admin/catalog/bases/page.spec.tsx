import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAdminFishingBases: vi.fn(),
  createFishingBase: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/lib/admin-catalog-api', () => ({
  listAdminFishingBases: mocks.listAdminFishingBases,
  createFishingBase: mocks.createFishingBase,
}));

import AdminFishingBasesPage from './page';

describe('AdminFishingBasesPage search', () => {
  beforeEach(() => {
    mocks.listAdminFishingBases.mockReset();
    mocks.createFishingBase.mockReset();
    mocks.routerReplace.mockReset();
  });

  test('finds a Base by the shared catalog token search', async () => {
    const user = userEvent.setup();
    mocks.listAdminFishingBases.mockResolvedValue([
      {
        id: 'base-1',
        name: 'Озёра Танзании',
        isActive: true,
        createdAt: '2026-08-08T12:00:00.000Z',
        updatedAt: '2026-08-08T12:00:00.000Z',
      },
      {
        id: 'base-2',
        name: 'Амур',
        isActive: true,
        createdAt: '2026-08-08T12:00:00.000Z',
        updatedAt: '2026-08-08T12:00:00.000Z',
      },
    ]);

    render(<AdminFishingBasesPage />);
    const search = await screen.findByRole('searchbox', { name: 'Найти базу' });
    await user.type(search, 'танз');

    expect(screen.getByText('Озёра Танзании')).toBeInTheDocument();
    expect(screen.queryByText('Амур')).not.toBeInTheDocument();
  });
});
