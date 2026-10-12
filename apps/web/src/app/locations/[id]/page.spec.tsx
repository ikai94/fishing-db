import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocation: vi.fn(),
  getLocationObservations: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'location-1' }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getLocation: mocks.getLocation,
}));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: mocks.getCurrentUser }));

vi.mock('@/lib/catch-reports-api', () => ({
  getLocationObservations: mocks.getLocationObservations,
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

vi.mock('./_components/location-observations', () => ({
  LocationObservations: ({
    baseId,
    data,
  }: {
    baseId: string;
    data: { observedFish: unknown[] };
  }) => (
    <div
      data-base-id={baseId}
      data-fish-count={data.observedFish.length}
      data-testid="location-observations"
    />
  ),
}));

import LocationPage from './page';

describe('LocationPage', () => {
  beforeEach(() => {
    mocks.getLocation.mockReset();
    mocks.getLocationObservations.mockReset();
    mocks.getCurrentUser.mockReset().mockResolvedValue({ role: 'USER', isBanned: false });
  });

  test('keeps the Location page free of notebook icons for ADMIN', async () => {
    mocks.getLocation.mockResolvedValue({
      id: 'location-1',
      number: 7,
      name: 'Протока',
      fishingBase: { id: 'base-1', name: 'Ахтуба' },
    });
    mocks.getLocationObservations.mockResolvedValue({ observedFish: [] });
    mocks.getCurrentUser.mockResolvedValue({ role: 'ADMIN', isBanned: false });
    render(<LocationPage />);
    expect(await screen.findByRole('heading', { level: 1, name: '7. Протока' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Блокнот рыб базы' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Ахтуба' })).toHaveLength(2);
  });

  test('loads exact-Location observations and keeps the Base catalog as secondary navigation', async () => {
    mocks.getLocation.mockResolvedValue({
      id: 'location-1',
      number: 7,
      name: 'Протока',
      fishingBase: { id: 'base-1', name: 'Ахтуба' },
    });
    mocks.getLocationObservations.mockResolvedValue({
      observedFish: [{ fish: { id: 'fish-1' } }],
      locationId: 'location-1',
    });

    render(<LocationPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '7. Протока' })).toBeVisible();
    expect(screen.getByTestId('application-shell')).toBeVisible();
    expect(mocks.getLocationObservations).toHaveBeenCalledWith(
      'location-1',
      expect.any(AbortSignal),
    );
    const baseLinks = screen.getAllByRole('link', { name: 'Ахтуба' });
    expect(baseLinks).toHaveLength(2);
    expect(baseLinks.every((link) => link.getAttribute('href') === '/bases/base-1')).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Навигация по разделу' })).toHaveTextContent(
      'Базы и локации/Ахтуба/7. Протока',
    );
    expect(screen.getByRole('link', { name: 'Каталог рыб базы «Ахтуба»' })).toHaveAttribute(
      'href',
      '/bases/base-1#fish',
    );
    expect(screen.getByTestId('location-observations')).toHaveAttribute('data-base-id', 'base-1');
    expect(screen.getByTestId('location-observations')).toHaveAttribute('data-fish-count', '1');
    expect(mocks.getLocationObservations).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/теоретически доступна/i)).not.toBeInTheDocument();
  });
});
