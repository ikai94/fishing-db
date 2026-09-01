import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import styles from '../../bases-locations.module.css';

const mocks = vi.hoisted(() => ({
  getFishingBase: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'base-1' }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getFishingBase: mocks.getFishingBase,
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

import FishingBasePage from './page';

const base = {
  id: 'base-1',
  name: 'Ахтуба',
  locations: [
    { id: 'location-7', number: 7, name: 'Протока' },
    { id: 'location-1', number: 1, name: 'Деревня' },
    { id: 'location-3', number: 3, name: 'Степной оазис' },
  ],
  fish: [
    { id: 'fish-4', name: 'Сом' },
    { id: 'fish-2', name: 'Амурский Осетр' },
    { id: 'fish-3', name: 'Белуга' },
    { id: 'fish-1', name: 'Амурская Щука' },
  ],
};

describe('FishingBasePage', () => {
  beforeEach(() => mocks.getFishingBase.mockReset());

  test('renders ordered Location and Fish link panes in the reference grid', async () => {
    mocks.getFishingBase.mockResolvedValue(base);

    render(<FishingBasePage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Ахтуба' })).toBeVisible();
    expect(screen.getByTestId('application-shell')).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Навигация по разделу' })).toHaveTextContent(
      'Базы и локации/Ахтуба',
    );
    const locationsHeading = screen.getByRole('heading', { level: 2, name: 'Локации' });
    const fishHeading = screen.getByRole('heading', { level: 2, name: 'Рыбы' });
    const locationsSection = locationsHeading.closest('section');
    const fishSection = fishHeading.closest('section');

    expect(locationsSection).not.toBeNull();
    expect(fishSection).not.toBeNull();
    expect(locationsSection?.parentElement).toBe(fishSection?.parentElement);
    expect(locationsSection?.parentElement).toHaveClass(styles.baseReferenceGrid);
    expect(locationsSection).toHaveClass(styles.baseReferencePane);
    expect(fishSection).toHaveClass(styles.baseReferencePane);

    const locationLinks = within(locationsSection as HTMLElement).getAllByRole('link');
    expect(locationLinks.map((link) => link.textContent)).toEqual([
      'Деревня',
      'Степной оазис',
      'Протока',
    ]);
    expect(locationLinks.map((link) => link.closest('li')?.getAttribute('value'))).toEqual([
      '1',
      '3',
      '7',
    ]);
    expect(locationLinks[0]).toHaveAttribute('href', '/locations/location-1');

    const fishLinks = within(fishSection as HTMLElement).getAllByRole('link');
    expect(fishLinks.map((link) => link.textContent)).toEqual([
      'Амурская Щука',
      'Амурский Осетр',
      'Белуга',
      'Сом',
    ]);
    expect(fishLinks[0]).toHaveAttribute('href', '/fish/fish-1');
    expect(screen.queryByText(/^Открыть/i)).not.toBeInTheDocument();
  });

  test('filters Fish locally with catalog normalization and preserves alphabetical order', async () => {
    const user = userEvent.setup();
    mocks.getFishingBase.mockResolvedValue(base);

    render(<FishingBasePage />);

    const search = await screen.findByRole('searchbox', { name: 'Поиск по рыбам' });
    await user.type(search, '  АМУР  ');

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      expect.arrayContaining(['Амурская Щука', 'Амурский Осетр']),
    );
    const fishSection = screen.getByRole('heading', { level: 2, name: 'Рыбы' }).closest('section');
    expect(
      within(fishSection as HTMLElement)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Амурская Щука', 'Амурский Осетр']);
    expect(screen.getByText('Найдено: 2 из 4')).toBeVisible();

    await user.clear(search);
    await user.type(search, 'карась');

    expect(screen.getByText('Ничего не найдено.')).toBeVisible();
    expect(search).toBeVisible();
    expect(within(fishSection as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  });
});
