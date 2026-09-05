import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resendVerification: vi.fn() }));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ resendVerification: mocks.resendVerification }));

import VerificationPendingPage from './page';

describe('VerificationPendingPage', () => {
  beforeEach(() => mocks.resendVerification.mockReset());

  test('uses a generic accepted message after requesting another email', async () => {
    const user = userEvent.setup();
    mocks.resendVerification.mockResolvedValue(undefined);
    render(<VerificationPendingPage />);

    await user.type(screen.getByLabelText('Email'), 'angler@example.ru');
    await user.click(screen.getByRole('button', { name: 'Отправить письмо ещё раз' }));

    await waitFor(() =>
      expect(mocks.resendVerification).toHaveBeenCalledWith({ email: 'angler@example.ru' }),
    );
    expect(screen.getByText(/Если аккаунт с этим email ожидает подтверждения/)).toBeVisible();
  });
});
