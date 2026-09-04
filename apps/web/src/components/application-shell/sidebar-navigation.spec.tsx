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

  test('renders the approved destinations and marks Fish current', () => {
    render(<SidebarNavigation />);

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    const links = within(navigation).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Главная',
      'Базы и локации',
      'Рыбы',
      'Добавить рыбу',
      'Наживки',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/bases',
      '/fish',
      '/catches/new',
      '/baits',
    ]);
    expect(within(navigation).getByRole('link', { current: 'page' })).toHaveTextContent('Рыбы');
  });

  test.each(['/bases', '/bases/base-id', '/locations/location-id'])(
    'treats %s as part of Bases and locations',
    (pathname) => {
      mocks.pathname = pathname;
      render(<SidebarNavigation />);

      expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Базы и локации');
    },
  );

  test('marks only the catch-entry destination current on the new catch route', () => {
    mocks.pathname = '/catches/new';
    render(<SidebarNavigation />);

    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Добавить рыбу');
  });
});
