import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/auth-api', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import { classifyCurrentUserError, UserHeader } from './user-header';

const user = {
  id: 'user-id',
  email: 'angler@example.ru',
  nickname: 'Рыбак',
  role: 'USER' as const,
  isBanned: false,
  createdAt: '2026-08-08T12:00:00.000Z',
};

describe('UserHeader', () => {
  beforeEach(() => mocks.getCurrentUser.mockReset());

  test('shows the authenticated nickname without exposing email', async () => {
    mocks.getCurrentUser.mockResolvedValue(user);
    render(<UserHeader />);

    const account = await screen.findByRole('link', { name: 'Рыбак' });
    expect(account).toHaveAttribute('href', '/account');
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    expect(mocks.getCurrentUser).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  test('classifies an unauthenticated response as the guest/login state', () => {
    expect(classifyCurrentUserError(new ApiError(401, { message: 'Требуется вход' }))).toBe(
      'guest',
    );
    expect(classifyCurrentUserError(new Error('offline'))).toBe('error');
  });

  test('retries a non-authentication failure', async () => {
    const tester = userEvent.setup();
    mocks.getCurrentUser.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(user);
    render(<UserHeader />);

    await tester.click(await screen.findByRole('button', { name: 'Проверить вход' }));
    expect(await screen.findByRole('link', { name: 'Рыбак' })).toBeVisible();
    expect(mocks.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});
