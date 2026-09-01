import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocation: vi.fn(),
  getLocationObservations: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'location-1' }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getLocation: mocks.getLocation,
}));

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
    data: { observedFish: unknown[]; reports: unknown[] };
  }) => (
    <div
      data-base-id={baseId}
      data-fish-count={data.observedFish.length}
      data-report-count={data.reports.length}
      data-testid="location-observations"
    />
  ),
}));

import LocationPage from './page';

describe('LocationPage', () => {
  beforeEach(() => {
    mocks.getLocation.mockReset();
    mocks.getLocationObservations.mockReset();
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
      reports: [{ id: 'report-1' }],
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
    expect(screen.getByTestId('location-observations')).toHaveAttribute('data-report-count', '1');
    expect(screen.queryByText(/теоретически доступна/i)).not.toBeInTheDocument();
  });
});
