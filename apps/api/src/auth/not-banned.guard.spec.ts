import assert from 'node:assert/strict';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { AuthenticatedRequest, SafeUser } from './auth.types.js';
import { NotBannedGuard } from './not-banned.guard.js';

function executionContext(user?: SafeUser): ExecutionContext {
  const request = {
    cookies: {},
    auth:
      user === undefined
        ? undefined
        : {
            sessionId: 'session-id',
            user,
          },
  } as unknown as AuthenticatedRequest;

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function user(overrides: Partial<SafeUser> = {}): SafeUser {
  return {
    id: 'user-id',
    email: 'angler@example.ru',
    nickname: 'Angler',
    role: 'USER',
    isBanned: false,
    createdAt: new Date('2026-08-08T12:00:00.000Z'),
    ...overrides,
  };
}

function hasCode(expectedCode: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof HttpException)) {
      return false;
    }

    const response = error.getResponse();
    return typeof response === 'object' && response !== null && 'code' in response
      ? response.code === expectedCode
      : false;
  };
}

void describe('NotBannedGuard', () => {
  const guard = new NotBannedGuard();

  void it('allows an active USER', () => {
    assert.equal(guard.canActivate(executionContext(user())), true);
  });

  void it('allows an active ADMIN', () => {
    assert.equal(guard.canActivate(executionContext(user({ role: 'ADMIN' }))), true);
  });

  void it('rejects a banned user with ACCOUNT_BANNED', () => {
    assert.throws(
      () => guard.canActivate(executionContext(user({ isBanned: true }))),
      hasCode('ACCOUNT_BANNED'),
    );
  });

  void it('fails closed with AUTH_REQUIRED when authentication context is missing', () => {
    assert.throws(() => guard.canActivate(executionContext()), hasCode('AUTH_REQUIRED'));
  });
});
