import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listFishingBases: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  listFishingBases: mocks.listFishingBases,
}));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

import FishingBasesPage from './page';

describe('FishingBasesPage', () => {
  beforeEach(() => {
    mocks.listFishingBases.mockReset();
    mocks.getCurrentUser.mockReset().mockResolvedValue({ role: 'USER', isBanned: false });
  });

  test('places one ADMIN notebook icon beside each Base name without adding columns or auth requests', async () => {
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Ахтуба', locationsCount: 12, fishCount: 29 },
      { id: 'base-2', name: 'Амазония', locationsCount: 33, fishCount: 97 },
    ]);
    mocks.getCurrentUser.mockResolvedValue({ role: 'ADMIN', isBanned: false });
    render(<FishingBasesPage />);
    const icons = await screen.findAllByRole('link', { name: 'Блокнот рыб базы' });
    expect(icons).toHaveLength(2);
    for (const [index, icon] of icons.entries()) {
      expect(icon).toHaveAttribute('href', `/bases/base-${index + 1}/notebook`);
      expect(icon.previousElementSibling).toHaveAttribute('href', `/bases/base-${index + 1}`);
      expect(icon.closest('td')).toBe(icon.previousElementSibling?.closest('td'));
      expect(icon.closest('tr')?.children).toHaveLength(4);
    }
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(mocks.getCurrentUser).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  test.each([
    ['USER', false],
    ['USER', true],
    ['ADMIN', true],
    ['guest', false],
  ])('hides notebook icons for %s, banned=%s', async (role, isBanned) => {
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Ахтуба', locationsCount: 12, fishCount: 29 },
    ]);
    if (role === 'guest') mocks.getCurrentUser.mockRejectedValue(new Error('unauthorized'));
    else mocks.getCurrentUser.mockResolvedValue({ role, isBanned });
    render(<FishingBasesPage />);
    expect(await screen.findByRole('link', { name: 'Ахтуба' })).toBeVisible();
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('link', { name: 'Блокнот рыб базы' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('shows the public list while access is pending and hides icons on failed lookup', async () => {
    let reject!: (error: Error) => void;
    mocks.getCurrentUser.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Ахтуба', locationsCount: 12, fishCount: 29 },
    ]);
    render(<FishingBasesPage />);
    expect(await screen.findByRole('link', { name: 'Ахтуба' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Блокнот рыб базы' })).not.toBeInTheDocument();
    await act(async () => reject(new Error('network')));
    expect(screen.queryByRole('link', { name: 'Блокнот рыб базы' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('renders a compact semantic table with linked Base names and active counts', async () => {
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Ахтуба', locationsCount: 12, fishCount: 29 },
      { id: 'base-2', name: 'Амазония', locationsCount: 33, fishCount: 97 },
    ]);

    render(<FishingBasesPage />);

    const table = await screen.findByRole('table', { name: 'Базы и локации' });
    expect(screen.getByTestId('application-shell')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Базы и локации' })).toBeVisible();
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
