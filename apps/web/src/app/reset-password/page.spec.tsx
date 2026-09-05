import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resetPassword: vi.fn() }));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ resetPassword: mocks.resetPassword }));

import ResetPasswordPage from './page';

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    mocks.resetPassword.mockReset();
    window.history.replaceState({}, '', '/reset-password');
  });

  test('clears the fragment and requires matching password confirmation', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/reset-password#token=reset-token');
    mocks.resetPassword.mockImplementation(async (input: { token: string; password: string }) => {
      expect(window.location.hash).toBe('');
      expect(input).toEqual({ token: 'reset-token', password: 'new secure password' });
    });
    render(<ResetPasswordPage />);

    const password = await screen.findByLabelText('Новый пароль', { selector: 'input' });
    const confirmation = screen.getByLabelText('Повторите пароль');
    await user.type(password, 'new secure password');
    await user.type(confirmation, 'different password');
    await user.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }));

    expect(await screen.findByText('Пароли не совпадают.')).toBeVisible();
    expect(mocks.resetPassword).not.toHaveBeenCalled();

    await user.clear(confirmation);
    await user.type(confirmation, 'new secure password');
    await user.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }));

    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('Все прежние сеансы завершены');
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
  });

  test('does not render the form without a fragment token', async () => {
    render(<ResetPasswordPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ссылка сброса недействительна');
    expect(screen.queryByLabelText('Новый пароль', { selector: 'input' })).not.toBeInTheDocument();
    expect(mocks.resetPassword).not.toHaveBeenCalled();
  });
});
