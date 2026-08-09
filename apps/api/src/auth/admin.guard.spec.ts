import assert from 'node:assert/strict';
import { type ExecutionContext, HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import { AdminGuard } from './admin.guard.js';
import type { AuthenticatedRequest, SafeUser } from './auth.types.js';

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
    email: 'admin@example.ru',
    nickname: 'Administrator',
    role: 'ADMIN',
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

void describe('AdminGuard', () => {
  const guard = new AdminGuard();

  void it('allows an active ADMIN', () => {
    assert.equal(guard.canActivate(executionContext(user())), true);
  });

  void it('rejects a USER with ADMIN_REQUIRED', () => {
    assert.throws(
      () => guard.canActivate(executionContext(user({ role: 'USER' }))),
      hasCode('ADMIN_REQUIRED'),
    );
  });

  void it('rejects a banned ADMIN with ACCOUNT_BANNED', () => {
    assert.throws(
      () => guard.canActivate(executionContext(user({ isBanned: true }))),
      hasCode('ACCOUNT_BANNED'),
    );
  });

  void it('fails closed with AUTH_REQUIRED when authentication context is missing', () => {
    assert.throws(() => guard.canActivate(executionContext()), hasCode('AUTH_REQUIRED'));
  });
});
