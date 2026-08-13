import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listFishingBases: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  listFishingBases: mocks.listFishingBases,
}));

import FishingBasesPage from './page';

describe('FishingBasesPage', () => {
  beforeEach(() => mocks.listFishingBases.mockReset());

  test('renders a compact semantic table with linked Base names and active counts', async () => {
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Ахтуба', locationsCount: 12, fishCount: 29 },
      { id: 'base-2', name: 'Амазония', locationsCount: 33, fishCount: 97 },
    ]);

    render(<FishingBasesPage />);

    const table = await screen.findByRole('table', { name: /рыболовные базы/i });
    expect(within(table).getByRole('columnheader', { name: 'Локаций' })).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: 'Рыб' })).toBeVisible();

    const baseLink = within(table).getByRole('link', { name: 'Ахтуба' });
    expect(baseLink).toHaveAttribute('href', '/bases/base-1');
    expect(within(baseLink.closest('tr')!).getByText('12')).toBeVisible();
    expect(within(baseLink.closest('tr')!).getByText('29')).toBeVisible();
    expect(screen.queryByText(/открыть базу/i)).not.toBeInTheDocument();
  });

  test('renders the explicit empty catalog state', async () => {
    mocks.listFishingBases.mockResolvedValue([]);

    render(<FishingBasesPage />);

    expect(await screen.findByText(/нет активных рыболовных баз/i)).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
