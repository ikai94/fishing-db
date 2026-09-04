import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => {
  const router = { replace: mocks.replace, refresh: mocks.refresh };
  return { useRouter: () => router };
});

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

vi.mock('@/lib/auth-api', () => ({
  getCurrentUser: mocks.getCurrentUser,
  logout: mocks.logout,
}));

import AccountPage from './page';

const admin = {
  id: 'user-1',
  email: 'admin@example.ru',
  nickname: 'Администратор',
  role: 'ADMIN' as const,
  isBanned: false,
  createdAt: '2026-08-08T12:00:00.000Z',
};

describe('AccountPage', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockReset();
    mocks.logout.mockReset();
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
  });

  test('renders the compact profile and existing ADMIN actions inside ApplicationShell', async () => {
    mocks.getCurrentUser.mockResolvedValue(admin);
    render(<AccountPage />);

    expect(await screen.findByText('admin@example.ru')).toBeVisible();
    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Аккаунт' }),
    );
    expect(screen.getByRole('link', { name: 'Мои уловы' })).toHaveAttribute('href', '/my/catches');
    expect(screen.getByRole('link', { name: 'Управлять игровым каталогом' })).toHaveAttribute(
      'href',
      '/admin/catalog',
    );
    expect(screen.queryByRole('link', { name: /на главную/i })).not.toBeInTheDocument();
  });

  test('preserves logout and redirects to login', async () => {
    const tester = userEvent.setup();
    mocks.getCurrentUser.mockResolvedValue(admin);
    mocks.logout.mockResolvedValue(undefined);
    render(<AccountPage />);

    await tester.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(mocks.replace).toHaveBeenCalledWith('/login');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  test('preserves the banned state and hides forbidden ADMIN catalog access', async () => {
    mocks.getCurrentUser.mockResolvedValue({ ...admin, isBanned: true });
    render(<AccountPage />);

    expect(await screen.findByText('Заблокирован')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('изменение и удаление');
    expect(
      screen.queryByRole('link', { name: 'Управлять игровым каталогом' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeEnabled();
  });
});
