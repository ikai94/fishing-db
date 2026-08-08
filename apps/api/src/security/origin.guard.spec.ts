import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { OriginGuard } from './origin.guard.js';

const ALLOWED_ORIGIN = 'http://localhost:3000';

function executionContext(method: string, headers: Record<string, string> = {}): ExecutionContext {
  const request = {
    method,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;

  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createGuard(): OriginGuard {
  const configService = {
    getOrThrow: () => ALLOWED_ORIGIN,
  } as unknown as ConfigService;

  return new OriginGuard(configService);
}

void describe('OriginGuard', () => {
  void it('allows safe methods without origin headers', () => {
    assert.equal(createGuard().canActivate(executionContext('GET')), true);
    assert.equal(createGuard().canActivate(executionContext('HEAD')), true);
    assert.equal(createGuard().canActivate(executionContext('OPTIONS')), true);
  });

  void it('allows an unsafe request with the exact configured Origin', () => {
    assert.equal(
      createGuard().canActivate(executionContext('POST', { origin: ALLOWED_ORIGIN })),
      true,
    );
  });

  void it('uses an exact Referer origin only when Origin is absent', () => {
    assert.equal(
      createGuard().canActivate(
        executionContext('POST', { referer: `${ALLOWED_ORIGIN}/register?source=test` }),
      ),
      true,
    );
  });

  void it('never falls back to Referer when an Origin header is present', () => {
    assert.throws(
      () =>
        createGuard().canActivate(
          executionContext('POST', {
            origin: 'https://attacker.example',
            referer: `${ALLOWED_ORIGIN}/login`,
          }),
        ),
      ForbiddenException,
    );
  });

  void it('rejects null, foreign, malformed and missing origins for unsafe methods', () => {
    const contexts = [
      executionContext('POST'),
      executionContext('POST', { origin: 'null' }),
      executionContext('POST', { origin: 'https://attacker.example' }),
      executionContext('POST', { referer: 'not-a-url' }),
    ];

    for (const context of contexts) {
      assert.throws(() => createGuard().canActivate(context), ForbiddenException);
    }
  });
});
