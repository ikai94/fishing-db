import assert from 'node:assert/strict';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, it } from 'node:test';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { PreparedSession, SafeUser } from './auth.types.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

const safeUser: SafeUser = {
  id: 'user-id',
  email: 'angler@example.ru',
  nickname: 'BigFish',
  role: 'USER',
  isBanned: false,
  createdAt: new Date('2026-08-08T12:00:00.000Z'),
};

const preparedSession: PreparedSession = {
  rawToken: Buffer.alloc(32, 3).toString('base64url'),
  tokenHash: 'a'.repeat(64),
  createdAt: new Date('2026-08-08T12:00:00.000Z'),
  expiresAt: new Date('2026-09-07T12:00:00.000Z'),
};

function exceptionCode(error: unknown): string | undefined {
  if (!(error instanceof ConflictException || error instanceof UnauthorizedException)) {
    return undefined;
  }

  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
}

void describe('AuthService', () => {
  void it('transactionally creates explicitly mapped user and session fields', async () => {
    let userData: unknown;
    let sessionData: unknown;
    const transaction = {
      user: {
        create: (arguments_: { data: unknown }) => {
          userData = arguments_.data;
          return Promise.resolve(safeUser);
        },
      },
      session: {
        create: (arguments_: { data: unknown }) => {
          sessionData = arguments_.data;
          return Promise.resolve({ id: 'session-id' });
        },
      },
    };
    const prisma = {
      $transaction: (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    } as unknown as PrismaService;
    const passwordService = {
      hashPassword: () => Promise.resolve('stored-password-hash'),
    } as unknown as PasswordService;
    const sessionService = {
      prepareSession: () => preparedSession,
    } as unknown as SessionService;
    const service = new AuthService(prisma, passwordService, sessionService);

    const result = await service.register({
      email: ' Angler@Example.RU ',
      nickname: ' BigFish ',
      password: 'correct horse 🐟',
    });

    assert.deepEqual(userData, {
      email: 'angler@example.ru',
      nickname: 'BigFish',
      nicknameNormalized: 'bigfish',
      passwordHash: 'stored-password-hash',
    });
    assert.deepEqual(sessionData, {
      userId: 'user-id',
      tokenHash: preparedSession.tokenHash,
      createdAt: preparedSession.createdAt,
      expiresAt: preparedSession.expiresAt,
    });
    assert.deepEqual(result, {
      user: safeUser,
      session: {
        sessionId: 'session-id',
        rawToken: preparedSession.rawToken,
        expiresAt: preparedSession.expiresAt,
      },
    });
  });

  void it('maps a Prisma email uniqueness race to EMAIL_ALREADY_EXISTS', async () => {
    const prisma = {
      $transaction: () => {
        const error = new Error('Unique constraint failed') as Error & {
          code: string;
          meta: { target: string[] };
        };
        error.code = 'P2002';
        error.meta = { target: ['email'] };
        return Promise.reject(error);
      },
    } as unknown as PrismaService;
    const passwordService = {
      hashPassword: () => Promise.resolve('stored-password-hash'),
    } as unknown as PasswordService;
    const sessionService = {
      prepareSession: () => preparedSession,
    } as unknown as SessionService;
    const service = new AuthService(prisma, passwordService, sessionService);

    await assert.rejects(
      () =>
        service.register({
          email: 'angler@example.ru',
          nickname: 'BigFish',
          password: 'correct horse 🐟',
        }),
      (error: unknown) => exceptionCode(error) === 'EMAIL_ALREADY_EXISTS',
    );
  });

  void it('returns the same public error for an unknown email and a wrong password', async () => {
    const passwordService = {
      verifyPasswordOrDummy: () => Promise.resolve(false),
    } as unknown as PasswordService;
    const sessionService = {} as SessionService;

    const unknownService = new AuthService(
      {
        user: { findUnique: () => Promise.resolve(null) },
      } as unknown as PrismaService,
      passwordService,
      sessionService,
    );
    const wrongPasswordService = new AuthService(
      {
        user: {
          findUnique: () => Promise.resolve({ ...safeUser, passwordHash: 'stored-password-hash' }),
        },
      } as unknown as PrismaService,
      passwordService,
      sessionService,
    );

    const getLoginError = async (service: AuthService): Promise<unknown> => {
      try {
        await service.login({ email: 'angler@example.ru', password: 'wrong password value' });
      } catch (error: unknown) {
        return error;
      }

      assert.fail('Login should have failed');
    };
    const unknownError = await getLoginError(unknownService);
    const wrongPasswordError = await getLoginError(wrongPasswordService);

    assert.equal(exceptionCode(unknownError), 'INVALID_CREDENTIALS');
    assert.equal(exceptionCode(wrongPasswordError), 'INVALID_CREDENTIALS');
    assert.deepEqual(
      (unknownError as UnauthorizedException).getResponse(),
      (wrongPasswordError as UnauthorizedException).getResponse(),
    );
  });
});
