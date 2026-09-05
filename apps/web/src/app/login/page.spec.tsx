import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ login: mocks.login }));

import LoginPage from './page';

async function submitLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), 'angler@example.ru');
  await user.type(screen.getByLabelText('Пароль'), 'long secure password');
  await user.click(screen.getByRole('button', { name: 'Войти' }));
}

describe('LoginPage', () => {
  beforeEach(() => {
    mocks.login.mockReset();
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
  });

  test('shows resend guidance for EMAIL_NOT_VERIFIED', async () => {
    mocks.login.mockRejectedValue(
      new ApiError(403, {
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Подтвердите email перед входом',
      }),
    );
    render(<LoginPage />);

    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { name: 'Вход' }),
    );
    expect(screen.getByRole('link', { name: 'Забыли пароль?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await submitLogin();

    expect(await screen.findByRole('alert')).toHaveTextContent('Подтвердите email');
    expect(screen.getByRole('link', { name: 'Отправить письмо ещё раз' })).toHaveAttribute(
      'href',
      '/verify-email/pending',
    );
  });

  test('preserves successful session navigation', async () => {
    mocks.login.mockResolvedValue({ id: 'user-1' });
    render(<LoginPage />);

    await submitLogin();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/account'));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
