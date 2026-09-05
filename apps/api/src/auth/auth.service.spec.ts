import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, it } from 'node:test';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { PreparedAuthToken } from './auth-token.service.js';
import { AuthTokenService } from './auth-token.service.js';
import type { SafeUser } from './auth.types.js';
import { AuthEmailTokenCipher } from './email/auth-email-token-cipher.service.js';
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

const preparedToken: PreparedAuthToken = {
  rawToken: Buffer.alloc(32, 3).toString('base64url'),
  tokenHash: 'a'.repeat(64),
  purpose: 'EMAIL_VERIFICATION',
  createdAt: new Date('2026-08-08T12:00:00.000Z'),
  expiresAt: new Date('2026-08-09T12:00:00.000Z'),
};

function service(
  prisma: PrismaService,
  passwordService: PasswordService,
  sessionService = {} as SessionService,
  tokenService = {
    prepareToken: () => preparedToken,
  } as unknown as AuthTokenService,
): AuthService {
  return new AuthService(prisma, passwordService, sessionService, tokenService, {
    encrypt: () => 'encrypted-token',
  } as unknown as AuthEmailTokenCipher);
}

function exceptionCode(error: unknown): string | undefined {
  if (!(
    error instanceof ConflictException ||
    error instanceof UnauthorizedException ||
    error instanceof ForbiddenException
  )) {
    return undefined;
  }

  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
}

void describe('AuthService', () => {
  void it('transactionally creates an unverified user, verification token, and encrypted outbox record', async () => {
    let userData: unknown;
    let tokenData: unknown;
    let outboxData: unknown;
    const transaction = {
      user: {
        create: (arguments_: { data: unknown }) => {
          userData = arguments_.data;
          return Promise.resolve({ id: safeUser.id });
        },
      },
      authToken: {
        create: (arguments_: { data: unknown }) => {
          tokenData = arguments_.data;
          return Promise.resolve({ id: 'token-id' });
        },
      },
      authEmailOutbox: {
        create: (arguments_: { data: unknown }) => {
          outboxData = arguments_.data;
          return Promise.resolve({ id: 'outbox-id' });
        },
      },
    };
    const authService = service(
      {
        $transaction: (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      } as unknown as PrismaService,
      { hashPassword: () => Promise.resolve('stored-password-hash') } as unknown as PasswordService,
    );

    const result = await authService.register({
      email: ' Angler@Example.RU ',
      nickname: ' BigFish ',
      password: 'correct horse 🐟',
    });

    assert.equal(result, undefined);
    assert.deepEqual(userData, {
      email: 'angler@example.ru',
      nickname: 'BigFish',
      nicknameNormalized: 'bigfish',
      passwordHash: 'stored-password-hash',
      emailVerifiedAt: null,
    });
    assert.deepEqual(tokenData, {
      userId: 'user-id',
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: preparedToken.tokenHash,
      createdAt: preparedToken.createdAt,
      expiresAt: preparedToken.expiresAt,
    });
    assert.deepEqual(outboxData, {
      authTokenId: 'token-id',
      recipientEmail: 'angler@example.ru',
      encryptedToken: 'encrypted-token',
      createdAt: preparedToken.createdAt,
      availableAt: preparedToken.createdAt,
    });
  });

  void it('maps an email uniqueness race to EMAIL_ALREADY_EXISTS', async () => {
    const prismaError = new Error('Unique constraint failed') as Error & {
      code: string;
      meta: { target: string[] };
    };
    prismaError.code = 'P2002';
    prismaError.meta = { target: ['email'] };
    const authService = service(
      { $transaction: () => Promise.reject(prismaError) } as unknown as PrismaService,
      { hashPassword: () => Promise.resolve('stored-password-hash') } as unknown as PasswordService,
    );

    await assert.rejects(
      authService.register({
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
    const unknownService = service(
      { user: { findUnique: () => Promise.resolve(null) } } as unknown as PrismaService,
      passwordService,
    );
    const wrongPasswordService = service(
      {
        user: {
          findUnique: () =>
            Promise.resolve({
              ...safeUser,
              passwordHash: 'stored-password-hash',
              emailVerifiedAt: new Date(),
            }),
        },
      } as unknown as PrismaService,
      passwordService,
    );

    const getLoginError = async (authService: AuthService): Promise<unknown> => {
      try {
        await authService.login({ email: 'angler@example.ru', password: 'wrong password value' });
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

  void it('rejects correct credentials for an unverified user without creating a session', async () => {
    let sessionCreated = false;
    const authService = service(
      {
        user: {
          findUnique: () =>
            Promise.resolve({
              ...safeUser,
              passwordHash: 'stored-password-hash',
              emailVerifiedAt: null,
            }),
        },
      } as unknown as PrismaService,
      { verifyPasswordOrDummy: () => Promise.resolve(true) } as unknown as PasswordService,
      {
        createSession: () => {
          sessionCreated = true;
          return Promise.reject(new Error('must not run'));
        },
      } as unknown as SessionService,
    );

    await assert.rejects(
      authService.login({ email: safeUser.email, password: 'correct horse 🐟' }),
      (error: unknown) => exceptionCode(error) === 'EMAIL_NOT_VERIFIED',
    );
    assert.equal(sessionCreated, false);
  });
});
