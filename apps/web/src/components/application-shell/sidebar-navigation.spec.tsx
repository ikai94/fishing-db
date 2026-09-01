import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pathname: '/fish',
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}));

import { SidebarNavigation } from './sidebar-navigation';

describe('SidebarNavigation', () => {
  beforeEach(() => {
    mocks.pathname = '/fish';
  });

  test('renders only the four approved destinations and marks Fish current', () => {
    render(<SidebarNavigation />);

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Главная',
      'Базы и локации',
      'Рыбы',
      'Наживки',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/bases',
      '/fish',
      '/baits',
    ]);
    expect(within(navigation).getByRole('link', { current: 'page' })).toHaveTextContent('Рыбы');
  });

  test('treats a Location detail as part of Bases and locations', () => {
    mocks.pathname = '/locations/location-id';
    render(<SidebarNavigation />);

    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Базы и локации');
  });
});
