import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ forgotPassword: vi.fn() }));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));
vi.mock('@/lib/auth-api', () => ({ forgotPassword: mocks.forgotPassword }));

import ForgotPasswordPage from './page';

describe('ForgotPasswordPage', () => {
  beforeEach(() => mocks.forgotPassword.mockReset());

  test('does not disclose account existence after an accepted request', async () => {
    const user = userEvent.setup();
    mocks.forgotPassword.mockResolvedValue(undefined);
    render(<ForgotPasswordPage />);

    await user.type(screen.getByLabelText('Email'), 'unknown@example.ru');
    await user.click(screen.getByRole('button', { name: 'Получить ссылку для сброса' }));

    await waitFor(() =>
      expect(mocks.forgotPassword).toHaveBeenCalledWith({ email: 'unknown@example.ru' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Если для этого email доступен сброс пароля',
    );
    expect(screen.queryByText(/email не найден/i)).not.toBeInTheDocument();
  });
});
