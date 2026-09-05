import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ register: vi.fn(), replace: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ register: mocks.register }));

import RegisterPage from './page';

describe('RegisterPage', () => {
  beforeEach(() => {
    mocks.register.mockReset();
    mocks.replace.mockReset();
  });

  test('uses ApplicationShell and sends verification-required registration to pending', async () => {
    const user = userEvent.setup();
    mocks.register.mockResolvedValue({ status: 'VERIFICATION_REQUIRED' });
    render(<RegisterPage />);

    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { name: 'Регистрация' }),
    );
    await user.type(screen.getByLabelText('Email'), 'angler@example.ru');
    await user.type(screen.getByLabelText('Никнейм'), 'Angler');
    await user.type(screen.getByLabelText('Пароль'), 'long secure password');
    await user.type(screen.getByLabelText('Повторите пароль'), 'long secure password');
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));

    await waitFor(() =>
      expect(mocks.register).toHaveBeenCalledWith({
        email: 'angler@example.ru',
        nickname: 'Angler',
        password: 'long secure password',
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith('/verify-email/pending');
  });
});
