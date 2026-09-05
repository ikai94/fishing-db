import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifyEmail: vi.fn() }));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ verifyEmail: mocks.verifyEmail }));

import VerifyEmailPage from './page';

describe('VerifyEmailPage', () => {
  beforeEach(() => {
    mocks.verifyEmail.mockReset();
    window.history.replaceState({}, '', '/verify-email');
  });

  test('clears the fragment before automatically confirming exactly once in Strict Mode', async () => {
    window.history.replaceState({}, '', '/verify-email#token=verification-token');
    mocks.verifyEmail.mockImplementation(async (token: string) => {
      expect(token).toBe('verification-token');
      expect(window.location.hash).toBe('');
    });

    render(
      <StrictMode>
        <VerifyEmailPage />
      </StrictMode>,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Email подтверждён');
    expect(window.location.pathname).toBe('/verify-email');
    expect(mocks.verifyEmail).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
  });

  test('does not call the API when the fragment token is missing', async () => {
    render(<VerifyEmailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('нет токена');
    expect(mocks.verifyEmail).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Отправить письмо ещё раз' })).toHaveAttribute(
      'href',
      '/verify-email/pending',
    );
  });
});
