import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';
import { describe, it } from 'node:test';
import { SESSION_COOKIE_NAME, SESSION_LIFETIME_MS } from './auth.constants.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest, AuthenticatedResult, SafeUser } from './auth.types.js';

interface CookieCall {
  name: string;
  value: string;
  options: CookieOptions;
}

const user: SafeUser = {
  id: 'user-id',
  email: 'angler@example.ru',
  nickname: 'Angler',
  role: 'USER',
  isBanned: false,
  createdAt: new Date('2026-08-08T12:00:00.000Z'),
};

const authenticatedResult: AuthenticatedResult = {
  user,
  session: {
    sessionId: 'session-id',
    rawToken: Buffer.alloc(32, 6).toString('base64url'),
    expiresAt: new Date('2026-09-07T12:00:00.000Z'),
  },
};

function responseRecorder(calls: CookieCall[]): Response {
  return {
    cookie(name: string, value: string, options: CookieOptions) {
      calls.push({ name, value, options });
      return this;
    },
  } as unknown as Response;
}

function configService(nodeEnv: string): ConfigService {
  return {
    getOrThrow: () => nodeEnv,
  } as unknown as ConfigService;
}

void describe('AuthController', () => {
  void it('registers a pending account without setting a session cookie', async () => {
    const authService = {
      register: () => Promise.resolve(),
    } as unknown as AuthService;
    const controller = new AuthController(authService, configService('development'));

    const response = await controller.register({
      email: 'angler@example.ru',
      nickname: 'Angler',
      password: 'correct horse 🐟',
    });

    assert.deepEqual(response, { status: 'VERIFICATION_REQUIRED' });
  });

  void it('sets only the raw token in the development HttpOnly cookie on login', async () => {
    const authService = {
      login: () => Promise.resolve(authenticatedResult),
    } as unknown as AuthService;
    const controller = new AuthController(authService, configService('development'));
    const cookieCalls: CookieCall[] = [];

    const response = await controller.login(
      { email: 'angler@example.ru', password: 'correct horse 🐟' },
      responseRecorder(cookieCalls),
    );

    assert.deepEqual(response, { user });
    assert.deepEqual(cookieCalls, [
      {
        name: SESSION_COOKIE_NAME,
        value: authenticatedResult.session.rawToken,
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          path: '/',
          maxAge: SESSION_LIFETIME_MS,
          expires: authenticatedResult.session.expiresAt,
        },
      },
    ]);
    assert.equal(JSON.stringify(response).includes(authenticatedResult.session.rawToken), false);
  });

  void it('expires the current browser cookie after a successful password reset', async () => {
    const authService = { resetPassword: () => Promise.resolve() } as unknown as AuthService;
    const controller = new AuthController(authService, configService('production'));
    const cookieCalls: CookieCall[] = [];

    await controller.resetPassword(
      { token: Buffer.alloc(32, 2).toString('base64url'), password: 'new secure password value' },
      responseRecorder(cookieCalls),
    );

    assert.equal(cookieCalls.length, 1);
    assert.equal(cookieCalls[0]?.name, SESSION_COOKIE_NAME);
    assert.equal(cookieCalls[0]?.value, '');
    assert.equal(cookieCalls[0]?.options.maxAge, 0);
    assert.equal(cookieCalls[0]?.options.secure, true);
  });

  void it('deletes only the current session and always expires the cookie', async () => {
    let deletedToken: string | undefined;
    const authService = {
      logout: (rawToken: string | undefined) => {
        deletedToken = rawToken;
        return Promise.resolve();
      },
    } as unknown as AuthService;
    const controller = new AuthController(authService, configService('production'));
    const cookieCalls: CookieCall[] = [];
    const rawToken = authenticatedResult.session.rawToken;

    await controller.logout(
      { cookies: { [SESSION_COOKIE_NAME]: rawToken } } as unknown as AuthenticatedRequest,
      responseRecorder(cookieCalls),
    );

    assert.equal(deletedToken, rawToken);
    assert.deepEqual(cookieCalls, [
      {
        name: SESSION_COOKIE_NAME,
        value: '',
        options: {
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: '/',
          maxAge: 0,
          expires: new Date(0),
        },
      },
    ]);
  });

  void it('expires the browser cookie even when session deletion fails', async () => {
    const authService = {
      logout: () => Promise.reject(new Error('database unavailable')),
    } as unknown as AuthService;
    const controller = new AuthController(authService, configService('development'));
    const cookieCalls: CookieCall[] = [];

    await assert.rejects(
      controller.logout(
        { cookies: {} } as unknown as AuthenticatedRequest,
        responseRecorder(cookieCalls),
      ),
      /database unavailable/,
    );

    assert.equal(cookieCalls.length, 1);
    assert.equal(cookieCalls[0]?.name, SESSION_COOKIE_NAME);
    assert.equal(cookieCalls[0]?.value, '');
    assert.equal(cookieCalls[0]?.options.maxAge, 0);
  });
});
