import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLocation: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'location-1' }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getLocation: mocks.getLocation,
}));

import LocationPage from './page';

describe('LocationPage', () => {
  beforeEach(() => mocks.getLocation.mockReset());

  test('presents its parent Base and Base Fish section as natural entity links', async () => {
    mocks.getLocation.mockResolvedValue({
      id: 'location-1',
      number: 7,
      name: 'Протока',
      fishingBase: { id: 'base-1', name: 'Ахтуба' },
    });

    render(<LocationPage />);

    expect(await screen.findByRole('heading', { level: 1, name: '7. Протока' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Ахтуба' })).toHaveAttribute('href', '/bases/base-1');
    expect(screen.getByRole('link', { name: 'Рыбы базы «Ахтуба»' })).toHaveAttribute(
      'href',
      '/bases/base-1#fish',
    );
    expect(screen.queryByText(/Открыть рыб базы/i)).not.toBeInTheDocument();
  });
});
