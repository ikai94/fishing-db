import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import {
  forgotPassword,
  register,
  resendVerification,
  resetPassword,
  verifyEmail,
} from './auth-api';

describe('email auth API client', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('decodes the verification-required registration contract', async () => {
    mocks.apiRequest.mockResolvedValue({ status: 'VERIFICATION_REQUIRED' });

    await expect(
      register({
        email: 'angler@example.ru',
        nickname: 'Angler',
        password: 'long secure password',
      }),
    ).resolves.toEqual({ status: 'VERIFICATION_REQUIRED' });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'angler@example.ru',
        nickname: 'Angler',
        password: 'long secure password',
      }),
    });
  });

  test('rejects an unexpected status response', async () => {
    mocks.apiRequest.mockResolvedValue({ status: 'CREATED' });

    await expect(
      register({
        email: 'angler@example.ru',
        nickname: 'Angler',
        password: 'long secure password',
      }),
    ).rejects.toThrow('Сервер вернул некорректный ответ');
  });

  test('uses the existing REST boundary for verification, resend, forgot and reset', async () => {
    mocks.apiRequest
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ status: 'ACCEPTED' })
      .mockResolvedValueOnce({ status: 'ACCEPTED' })
      .mockResolvedValueOnce(undefined);

    await verifyEmail('verification-token');
    await resendVerification({ email: 'angler@example.ru' });
    await forgotPassword({ email: 'angler@example.ru' });
    await resetPassword({ token: 'reset-token', password: 'new secure password' });

    expect(mocks.apiRequest.mock.calls).toEqual([
      [
        '/auth/verify-email',
        { method: 'POST', body: JSON.stringify({ token: 'verification-token' }) },
      ],
      [
        '/auth/resend-verification',
        { method: 'POST', body: JSON.stringify({ email: 'angler@example.ru' }) },
      ],
      [
        '/auth/forgot-password',
        { method: 'POST', body: JSON.stringify({ email: 'angler@example.ru' }) },
      ],
      [
        '/auth/reset-password',
        {
          method: 'POST',
          body: JSON.stringify({ token: 'reset-token', password: 'new secure password' }),
        },
      ],
    ]);
  });
});
