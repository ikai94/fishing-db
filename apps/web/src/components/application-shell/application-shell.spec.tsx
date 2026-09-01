import { render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('./sidebar-navigation', () => ({
  SidebarNavigation: () => <nav aria-label="Основная навигация" />,
}));

vi.mock('./sidebar-statistics', () => ({
  SidebarStatistics: () => <section aria-label="Статистика" />,
}));

vi.mock('./user-header', () => ({
  UserHeader: () => <div>Аккаунт</div>,
}));

import { ApplicationShell } from './application-shell';

describe('ApplicationShell', () => {
  test('provides the sidebar, compact user area, skip target and one main content landmark', () => {
    render(
      <ApplicationShell>
        <h1>Рыбы</h1>
      </ApplicationShell>,
    );

    const sidebar = screen.getByLabelText('Боковая панель');
    expect(within(sidebar).getByLabelText('Основная навигация')).toBeVisible();
    expect(within(sidebar).getByLabelText('Статистика')).toBeVisible();
    expect(within(sidebar).getByText('РЫБНАЯ БАЗА')).toBeVisible();
    expect(within(screen.getByRole('banner')).getByText('Аккаунт')).toBeVisible();
    expect(screen.getByRole('link', { name: 'К содержанию' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByRole('heading', { name: 'Рыбы' })).toBeVisible();
  });
});
