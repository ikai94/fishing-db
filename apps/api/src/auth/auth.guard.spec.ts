import assert from 'node:assert/strict';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, it } from 'node:test';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthenticatedContext, AuthenticatedRequest } from './auth.types.js';
import { SessionService } from './session.service.js';

function httpContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function isAuthRequired(error: unknown): boolean {
  if (!(error instanceof UnauthorizedException)) {
    return false;
  }

  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? response.code === 'AUTH_REQUIRED'
    : false;
}

void describe('AuthGuard', () => {
  void it('attaches the safe authenticated context to the request', async () => {
    const authenticatedContext: AuthenticatedContext = {
      sessionId: 'session-id',
      user: {
        id: 'user-id',
        email: 'angler@example.ru',
        nickname: 'Angler',
        role: 'USER',
        isBanned: true,
        createdAt: new Date('2026-08-08T12:00:00.000Z'),
      },
    };
    const sessionService = {
      findAuthenticatedSession: () => Promise.resolve(authenticatedContext),
    } as unknown as SessionService;
    const guard = new AuthGuard(sessionService);
    const request = {
      cookies: { [SESSION_COOKIE_NAME]: Buffer.alloc(32, 4).toString('base64url') },
    } as unknown as AuthenticatedRequest;

    assert.equal(await guard.canActivate(httpContext(request)), true);
    assert.deepEqual(request.auth, authenticatedContext);
  });

  void it('returns AUTH_REQUIRED for missing, malformed, or expired sessions', async () => {
    const sessionService = {
      findAuthenticatedSession: () => Promise.resolve(null),
    } as unknown as SessionService;
    const guard = new AuthGuard(sessionService);
    const missingCookieRequest = { cookies: {} } as unknown as AuthenticatedRequest;
    const expiredSessionRequest = {
      cookies: { [SESSION_COOKIE_NAME]: Buffer.alloc(32, 5).toString('base64url') },
    } as unknown as AuthenticatedRequest;

    await assert.rejects(
      () => guard.canActivate(httpContext(missingCookieRequest)),
      isAuthRequired,
    );
    await assert.rejects(
      () => guard.canActivate(httpContext(expiredSessionRequest)),
      isAuthRequired,
    );
  });
});
