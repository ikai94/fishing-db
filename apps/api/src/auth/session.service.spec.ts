import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { PrismaService } from '../prisma/prisma.service.js';
import { SESSION_LIFETIME_MS } from './auth.constants.js';
import { hashSessionToken, isCanonicalSessionToken, SessionService } from './session.service.js';

interface CreateSessionArguments {
  data: {
    userId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  };
}

interface FindSessionArguments {
  where: {
    tokenHash: string;
    expiresAt: { gt: Date };
  };
  select: unknown;
}

void describe('SessionService', () => {
  void it('creates a canonical 256-bit token, SHA-256 hash and fixed 30-day expiry', () => {
    const service = new SessionService({} as unknown as PrismaService);
    const now = new Date('2026-08-08T12:00:00.000Z');
    const prepared = service.prepareSession(now);

    assert.equal(prepared.rawToken.length, 43);
    assert.equal(isCanonicalSessionToken(prepared.rawToken), true);
    assert.equal(Buffer.from(prepared.rawToken, 'base64url').length, 32);
    assert.equal(
      prepared.tokenHash,
      createHash('sha256').update(prepared.rawToken, 'utf8').digest('hex'),
    );
    assert.equal(prepared.tokenHash.length, 64);
    assert.equal(prepared.createdAt, now);
    assert.equal(prepared.expiresAt.getTime() - now.getTime(), SESSION_LIFETIME_MS);
  });

  void it('allows multiple independent sessions for one user', async () => {
    const persistedHashes: string[] = [];
    const prisma = {
      session: {
        create: (arguments_: CreateSessionArguments) => {
          persistedHashes.push(arguments_.data.tokenHash);
          return Promise.resolve({ id: `session-${persistedHashes.length}` });
        },
      },
    } as unknown as PrismaService;
    const service = new SessionService(prisma);

    const first = await service.createSession('user-id');
    const second = await service.createSession('user-id');

    assert.notEqual(first.rawToken, second.rawToken);
    assert.notEqual(persistedHashes[0], persistedHashes[1]);
    assert.equal(persistedHashes.includes(first.rawToken), false);
    assert.equal(persistedHashes.includes(second.rawToken), false);
  });

  void it('looks up only an unexpired hash and returns safe user fields', async () => {
    const rawToken = Buffer.alloc(32, 7).toString('base64url');
    let query: unknown;
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const prisma = {
      session: {
        findFirst: (arguments_: unknown) => {
          query = arguments_;
          return Promise.resolve({
            id: 'session-id',
            user: {
              id: 'user-id',
              email: 'angler@example.ru',
              nickname: 'Angler',
              role: 'USER',
              isBanned: true,
              createdAt,
            },
          });
        },
      },
    } as unknown as PrismaService;
    const service = new SessionService(prisma);

    const authenticated = await service.findAuthenticatedSession(rawToken);

    assert.deepEqual(authenticated, {
      sessionId: 'session-id',
      user: {
        id: 'user-id',
        email: 'angler@example.ru',
        nickname: 'Angler',
        role: 'USER',
        isBanned: true,
        createdAt,
      },
    });
    assert.notEqual(query, undefined);
    const typedQuery = query as FindSessionArguments;
    assert.equal(typedQuery.where.tokenHash, hashSessionToken(rawToken));
    assert.equal(typedQuery.where.expiresAt.gt instanceof Date, true);
    assert.deepEqual(typedQuery.select, {
      id: true,
      user: {
        select: {
          id: true,
          email: true,
          nickname: true,
          role: true,
          isBanned: true,
          createdAt: true,
        },
      },
    });
  });

  void it('ignores malformed tokens during idempotent deletion', async () => {
    let deleteCalls = 0;
    const prisma = {
      session: {
        deleteMany: () => {
          deleteCalls += 1;
          return Promise.resolve({ count: 0 });
        },
      },
    } as unknown as PrismaService;
    const service = new SessionService(prisma);

    await service.deleteSession(undefined);
    await service.deleteSession('malformed');
    assert.equal(deleteCalls, 0);

    await service.deleteSession(Buffer.alloc(32, 1).toString('base64url'));
    assert.equal(deleteCalls, 1);
  });
});
