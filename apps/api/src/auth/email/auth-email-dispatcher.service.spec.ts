import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { describe, it } from 'node:test';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthEmailDispatcher } from './auth-email-dispatcher.service.js';
import type { AuthEmailMessage, AuthEmailTransport } from './auth-email.transport.js';
import { AuthEmailTokenCipher } from './auth-email-token-cipher.service.js';

function config(): ConfigService {
  return {
    getOrThrow: (key: string) => (key === 'NODE_ENV' ? 'test' : 'https://fishing.example.ru'),
  } as unknown as ConfigService;
}

void describe('AuthEmailDispatcher', () => {
  void it('claims a valid outbox row, builds a fragment URL, and marks it sent', async () => {
    const updates: unknown[] = [];
    const prisma = {
      $executeRaw: () => Promise.resolve(0),
      $queryRaw: () =>
        Promise.resolve([
          {
            id: 'outbox-id',
            recipientEmail: 'angler@example.ru',
            encryptedToken: 'encrypted-token',
            attemptCount: 1,
            purpose: 'EMAIL_VERIFICATION',
            expiresAt: new Date(Date.now() + 60_000),
          },
        ]),
      authEmailOutbox: {
        deleteMany: () => Promise.resolve({ count: 0 }),
        updateMany: (arguments_: unknown) => {
          updates.push(arguments_);
          return Promise.resolve({ count: 1 });
        },
      },
      authToken: { deleteMany: () => Promise.resolve({ count: 0 }) },
    } as unknown as PrismaService;
    const messages: AuthEmailMessage[] = [];
    const transport: AuthEmailTransport = {
      send: (message) => {
        messages.push(message);
        return Promise.resolve();
      },
    };
    const dispatcher = new AuthEmailDispatcher(
      prisma,
      config(),
      { decrypt: () => 'raw-token' } as unknown as AuthEmailTokenCipher,
      transport,
    );

    assert.equal(await dispatcher.dispatchPending(), 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.actionUrl, 'https://fishing.example.ru/verify-email#token=raw-token');
    assert.equal(updates.length, 1);
    assert.deepEqual((updates[0] as { where: unknown }).where, {
      id: 'outbox-id',
      sentAt: null,
      cancelledAt: null,
    });
  });

  void it('releases a failed delivery for retry without logging message secrets', async () => {
    let update: unknown;
    const prisma = {
      $executeRaw: () => Promise.resolve(0),
      $queryRaw: () =>
        Promise.resolve([
          {
            id: 'failed-outbox-id',
            recipientEmail: 'angler@example.ru',
            encryptedToken: 'encrypted-token',
            attemptCount: 1,
            purpose: 'PASSWORD_RESET',
            expiresAt: new Date(Date.now() + 60 * 60_000),
          },
        ]),
      authEmailOutbox: {
        deleteMany: () => Promise.resolve({ count: 0 }),
        updateMany: (arguments_: unknown) => {
          update = arguments_;
          return Promise.resolve({ count: 1 });
        },
      },
      authToken: { deleteMany: () => Promise.resolve({ count: 0 }) },
    } as unknown as PrismaService;
    const dispatcher = new AuthEmailDispatcher(
      prisma,
      config(),
      { decrypt: () => 'raw-token' } as unknown as AuthEmailTokenCipher,
      { send: () => Promise.reject(new Error('provider unavailable')) },
    );

    assert.equal(await dispatcher.dispatchPending(), 1);
    const data = (update as { data: { availableAt: Date; leaseUntil: null } }).data;
    assert.ok(data.availableAt instanceof Date);
    assert.equal(data.leaseUntil, null);
  });
});
