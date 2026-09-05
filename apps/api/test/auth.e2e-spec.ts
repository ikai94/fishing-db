import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnvironmentFile } from 'dotenv';
import request from 'supertest';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const WEB_ORIGIN = 'http://localhost:3000';
const FOREIGN_ORIGIN = 'https://attacker.example';
const COOKIE_NAME = 'fishing_session';
const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another sufficiently long password';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

interface RegistrationInput {
  email: string;
  nickname: string;
  password: string;
}

interface SafeUser {
  id: string;
  email: string;
  nickname: string;
  role: 'USER' | 'ADMIN';
  isBanned: boolean;
  createdAt: string;
}

type PrismaServiceInstance = import('../src/prisma/prisma.service.js').PrismaService;
type AuthEmailTokenCipher =
  import('../src/auth/email/auth-email-token-cipher.service.js').AuthEmailTokenCipher;
type AuthEmailDispatcher =
  import('../src/auth/email/auth-email-dispatcher.service.js').AuthEmailDispatcher;
type SeedAdmin = typeof import('../src/prisma/seed.js').seedAdmin;

const originalRuntimeEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  AUTH_EMAIL_DELIVERY_MODE: process.env.AUTH_EMAIL_DELIVERY_MODE,
  AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: process.env.AUTH_EMAIL_TOKEN_ENCRYPTION_KEY,
};

let app: INestApplication | undefined;
let httpServer: Server;
let prisma: PrismaServiceInstance;
let emailTokenCipher: AuthEmailTokenCipher;
let emailDispatcher: AuthEmailDispatcher;
let seedAdmin: SeedAdmin;
let databaseConfiguration: TestDatabaseConfiguration;
let clearDatabase: (() => Promise<void>) | undefined;

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function api(): ReturnType<typeof request> {
  return request(httpServer);
}

function mutation(path: string): ReturnType<ReturnType<typeof request>['post']> {
  return api().post(path).set('Origin', WEB_ORIGIN);
}

function register(input: RegistrationInput): ReturnType<ReturnType<typeof request>['post']> {
  return mutation('/api/v1/auth/register').send(input);
}

function login(email: string, password: string): ReturnType<ReturnType<typeof request>['post']> {
  return mutation('/api/v1/auth/login').send({ email, password });
}

function getSetCookieHeaders(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];
  if (typeof header === 'string') return [header];
  if (Array.isArray(header) && header.every((value) => typeof value === 'string')) return header;
  return [];
}

function requireCookieHeader(response: { headers: Record<string, unknown> }): string {
  const header = getSetCookieHeaders(response).find((value) => value.startsWith(`${COOKIE_NAME}=`));
  assert.ok(header, `${COOKIE_NAME} Set-Cookie header is required`);
  return header;
}

function requireSessionCookie(response: { headers: Record<string, unknown> }): string {
  const cookiePair = requireCookieHeader(response).split(';', 1)[0];
  assert.ok(cookiePair);
  assert.match(cookiePair, new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}$`));
  return cookiePair;
}

function rawSessionToken(cookiePair: string): string {
  return cookiePair.slice(cookiePair.indexOf('=') + 1);
}

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') assert.fail(`${field} must be a string`);
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') assert.fail(`${field} must be a boolean`);
  return value;
}

function readErrorCode(body: unknown): string {
  return asString(asObject(body).code, 'code');
}

function readSafeUser(body: unknown): SafeUser {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['user']);
  const user = asObject(payload.user);
  assert.deepEqual(Object.keys(user).sort(), [
    'createdAt',
    'email',
    'id',
    'isBanned',
    'nickname',
    'role',
  ]);
  assert.ok(user.role === 'USER' || user.role === 'ADMIN');
  return {
    id: asString(user.id, 'id'),
    email: asString(user.email, 'email'),
    nickname: asString(user.nickname, 'nickname'),
    role: user.role,
    isBanned: asBoolean(user.isBanned, 'isBanned'),
    createdAt: asString(user.createdAt, 'createdAt'),
  };
}

async function latestRawToken(
  email: string,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
): Promise<{ rawToken: string; tokenId: string }> {
  const outbox = await prisma.authEmailOutbox.findFirstOrThrow({
    where: { recipientEmail: email, authToken: { purpose } },
    orderBy: { createdAt: 'desc' },
    select: { encryptedToken: true, authToken: { select: { id: true } } },
  });
  return {
    rawToken: emailTokenCipher.decrypt(outbox.encryptedToken),
    tokenId: outbox.authToken.id,
  };
}

async function verifyRegisteredAccount(email: string): Promise<void> {
  const { rawToken } = await latestRawToken(email, 'EMAIL_VERIFICATION');
  await mutation('/api/v1/auth/verify-email').send({ token: rawToken }).expect(204);
}

async function registerAndVerify(input: RegistrationInput): Promise<void> {
  await register(input).expect(201);
  await verifyRegisteredAccount(input.email.toLowerCase());
}

void describe('Auth API (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    databaseConfiguration = getTestDatabaseConfiguration(process.env);
    process.env.DATABASE_URL = databaseConfiguration.testDatabaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.WEB_ORIGIN = WEB_ORIGIN;
    process.env.AUTH_EMAIL_DELIVERY_MODE = 'console';
    process.env.AUTH_EMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64url');

    const [
      { AppModule },
      { configureApplication },
      prismaModule,
      seedModule,
      cipherModule,
      dispatcherModule,
    ] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/app.setup.js'),
      import('../src/prisma/prisma.service.js'),
      import('../src/prisma/seed.js'),
      import('../src/auth/email/auth-email-token-cipher.service.js'),
      import('../src/auth/email/auth-email-dispatcher.service.js'),
    ]);

    seedAdmin = seedModule.seedAdmin;
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(prismaModule.PrismaService);
    emailTokenCipher = app.get(cipherModule.AuthEmailTokenCipher);
    emailDispatcher = app.get(dispatcherModule.AuthEmailDispatcher);
    clearDatabase = async () => {
      await clearTestData(databaseConfiguration, {
        truncateActivityEvents: () =>
          prisma.$executeRawUnsafe('TRUNCATE TABLE "ActivityEvent" RESTART IDENTITY'),
        deleteCatchReports: () => prisma.catchReport.deleteMany(),
        deleteFishingBaseFish: () => prisma.fishingBaseFish.deleteMany(),
        deleteLocations: () => prisma.location.deleteMany(),
        deleteFishingBases: () => prisma.fishingBase.deleteMany(),
        deleteFish: () => prisma.fish.deleteMany(),
        deleteBaits: () => prisma.bait.deleteMany(),
        deleteScreenAnchors: () => prisma.screenAnchor.deleteMany(),
        deleteSessions: () => prisma.session.deleteMany(),
        deleteUsers: () => prisma.user.deleteMany(),
      });
    };
    await clearDatabase();
  });

  void beforeEach(async () => {
    assert.ok(clearDatabase);
    await clearDatabase();
  });

  void after(async () => {
    try {
      await clearDatabase?.();
      await app?.close();
    } finally {
      for (const [name, value] of Object.entries(originalRuntimeEnvironment)) {
        restoreEnvironmentValue(name, value);
      }
    }
  });

  void test('registers unverified without a session, verifies once, then logs in with hashed storage', async () => {
    const response = await register({
      email: 'first@example.ru',
      nickname: 'First Angler',
      password: PASSWORD,
    }).expect(201);

    assert.deepEqual(response.body, { status: 'VERIFICATION_REQUIRED' });
    assert.deepEqual(getSetCookieHeaders(response), []);
    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'first@example.ru' },
    });
    assert.equal(storedUser.emailVerifiedAt, null);
    assert.equal(storedUser.passwordHash.startsWith('$scrypt$v=1$'), true);
    assert.equal(storedUser.passwordHash.includes(PASSWORD), false);
    assert.equal(await prisma.session.count(), 0);

    const issued = await latestRawToken('first@example.ru', 'EMAIL_VERIFICATION');
    const storedToken = await prisma.authToken.findUniqueOrThrow({ where: { id: issued.tokenId } });
    assert.equal(storedToken.tokenHash, createHash('sha256').update(issued.rawToken).digest('hex'));
    assert.equal(storedToken.tokenHash === issued.rawToken, false);
    const outbox = await prisma.authEmailOutbox.findUniqueOrThrow({
      where: { authTokenId: issued.tokenId },
    });
    assert.equal(outbox.encryptedToken.includes(issued.rawToken), false);
    assert.equal(
      JSON.stringify({ storedUser, storedToken, outbox }).includes(issued.rawToken),
      false,
    );

    const verified = await mutation('/api/v1/auth/verify-email')
      .send({ token: issued.rawToken })
      .expect(204);
    assert.deepEqual(getSetCookieHeaders(verified), []);
    assert.equal(await prisma.session.count(), 0);
    const consumed = await prisma.authToken.findUniqueOrThrow({ where: { id: issued.tokenId } });
    assert.ok(consumed.consumedAt);
    assert.equal(consumed.invalidatedAt, null);
    assert.ok(
      (await prisma.user.findUniqueOrThrow({ where: { id: storedUser.id } })).emailVerifiedAt,
    );
    const replay = await mutation('/api/v1/auth/verify-email')
      .send({ token: issued.rawToken })
      .expect(400);
    assert.equal(readErrorCode(replay.body as unknown), 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN');

    const loginResponse = await login('FIRST@EXAMPLE.RU', PASSWORD).expect(200);
    assert.equal(readSafeUser(loginResponse.body as unknown).email, 'first@example.ru');
    const cookieHeader = requireCookieHeader(loginResponse);
    const cookiePair = requireSessionCookie(loginResponse);
    const sessionToken = rawSessionToken(cookiePair);
    const storedSession = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: createHash('sha256').update(sessionToken).digest('hex') },
    });
    assert.equal(storedSession.tokenHash === sessionToken, false);
    assert.match(cookieHeader, /;\s*HttpOnly/i);
    assert.match(cookieHeader, /;\s*SameSite=Lax/i);
    assert.match(cookieHeader, /;\s*Path=\//i);
    assert.match(cookieHeader, new RegExp(`;\\s*Max-Age=${SESSION_MAX_AGE_SECONDS}(?:;|$)`, 'i'));
    assert.doesNotMatch(cookieHeader, /;\s*Secure/i);
  });

  void test('resend is enumeration-safe and supersedes rather than consumes the previous token', async () => {
    await register({ email: 'pending@example.ru', nickname: 'Pending', password: PASSWORD }).expect(
      201,
    );
    const first = await latestRawToken('pending@example.ru', 'EMAIL_VERIFICATION');
    await mutation('/api/v1/auth/resend-verification')
      .send({ email: 'pending@example.ru' })
      .expect(202);
    assert.equal(
      await prisma.authToken.count({
        where: { user: { email: 'pending@example.ru' }, purpose: 'EMAIL_VERIFICATION' },
      }),
      1,
    );
    await prisma.authToken.update({
      where: { id: first.tokenId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });

    const known = await mutation('/api/v1/auth/resend-verification')
      .send({ email: 'PENDING@EXAMPLE.RU' })
      .expect(202);
    const unknown = await mutation('/api/v1/auth/resend-verification')
      .send({ email: 'unknown@example.ru' })
      .expect(202);
    assert.deepEqual(known.body, { status: 'ACCEPTED' });
    assert.deepEqual(unknown.body, known.body);

    const second = await latestRawToken('pending@example.ru', 'EMAIL_VERIFICATION');
    assert.notEqual(second.tokenId, first.tokenId);
    const superseded = await prisma.authToken.findUniqueOrThrow({ where: { id: first.tokenId } });
    assert.equal(superseded.consumedAt, null);
    assert.ok(superseded.invalidatedAt);
    assert.ok(
      (await prisma.authEmailOutbox.findUniqueOrThrow({ where: { authTokenId: first.tokenId } }))
        .cancelledAt,
    );
    await mutation('/api/v1/auth/verify-email').send({ token: first.rawToken }).expect(400);
    await mutation('/api/v1/auth/verify-email').send({ token: second.rawToken }).expect(204);

    const before = await prisma.authToken.count();
    await mutation('/api/v1/auth/resend-verification')
      .send({ email: 'pending@example.ru' })
      .expect(202);
    assert.equal(await prisma.authToken.count(), before);
  });

  void test('claims and completes encrypted outbox delivery through PostgreSQL', async () => {
    await register({
      email: 'dispatch@example.ru',
      nickname: 'Dispatch',
      password: PASSWORD,
    }).expect(201);
    const before = await prisma.authEmailOutbox.findFirstOrThrow({
      where: { recipientEmail: 'dispatch@example.ru' },
    });
    assert.equal(before.sentAt, null);
    assert.equal(before.cancelledAt, null);

    assert.equal(await emailDispatcher.dispatchPending(1), 1);
    const after = await prisma.authEmailOutbox.findUniqueOrThrow({ where: { id: before.id } });
    assert.ok(after.sentAt);
    assert.equal(after.cancelledAt, null);
    assert.equal(after.attemptCount, 1);
    assert.equal(after.leaseUntil, null);
  });

  void test('rejects unverified login and unverified sessions while preserving credential privacy', async () => {
    await register({
      email: 'credentials@example.ru',
      nickname: 'Credentials',
      password: PASSWORD,
    }).expect(201);

    const unverified = await login('credentials@example.ru', PASSWORD).expect(403);
    assert.equal(readErrorCode(unverified.body as unknown), 'EMAIL_NOT_VERIFIED');
    assert.deepEqual(getSetCookieHeaders(unverified), []);
    const unknown = await login('unknown@example.ru', OTHER_PASSWORD).expect(401);
    const wrong = await login('credentials@example.ru', OTHER_PASSWORD).expect(401);
    assert.deepEqual(wrong.body, unknown.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'credentials@example.ru' },
    });
    const rawToken = Buffer.alloc(32, 21).toString('base64url');
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: createHash('sha256').update(rawToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await api().get('/api/v1/auth/me').set('Cookie', `${COOKIE_NAME}=${rawToken}`).expect(401);
    await api()
      .get('/api/v1/me/catch-reports')
      .set('Cookie', `${COOKIE_NAME}=${rawToken}`)
      .expect(401);
    await mutation('/api/v1/catch-reports')
      .set('Cookie', `${COOKIE_NAME}=${rawToken}`)
      .send({})
      .expect(401);
  });

  void test('forgot/reset is enumeration-safe, supersedes tokens, resets the hash, and revokes all sessions', async () => {
    await registerAndVerify({
      email: 'reset@example.ru',
      nickname: 'Reset Angler',
      password: PASSWORD,
    });
    await register({
      email: 'unverified-reset@example.ru',
      nickname: 'Unverified Reset',
      password: PASSWORD,
    }).expect(201);
    const firstLogin = await login('reset@example.ru', PASSWORD).expect(200);
    const secondLogin = await login('reset@example.ru', PASSWORD).expect(200);
    assert.equal(await prisma.session.count(), 2);

    const known = await mutation('/api/v1/auth/forgot-password')
      .send({ email: 'reset@example.ru' })
      .expect(202);
    const unknown = await mutation('/api/v1/auth/forgot-password')
      .send({ email: 'absent@example.ru' })
      .expect(202);
    const unverified = await mutation('/api/v1/auth/forgot-password')
      .send({ email: 'unverified-reset@example.ru' })
      .expect(202);
    assert.deepEqual(known.body, { status: 'ACCEPTED' });
    assert.deepEqual(unknown.body, known.body);
    assert.deepEqual(unverified.body, known.body);
    assert.equal(
      await prisma.authToken.count({
        where: { purpose: 'PASSWORD_RESET', user: { email: 'unverified-reset@example.ru' } },
      }),
      0,
    );

    const firstReset = await latestRawToken('reset@example.ru', 'PASSWORD_RESET');
    await prisma.authToken.update({
      where: { id: firstReset.tokenId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await mutation('/api/v1/auth/forgot-password').send({ email: 'reset@example.ru' }).expect(202);
    const secondReset = await latestRawToken('reset@example.ru', 'PASSWORD_RESET');
    assert.notEqual(secondReset.tokenId, firstReset.tokenId);
    const invalidated = await prisma.authToken.findUniqueOrThrow({
      where: { id: firstReset.tokenId },
    });
    assert.equal(invalidated.consumedAt, null);
    assert.ok(invalidated.invalidatedAt);
    await mutation('/api/v1/auth/reset-password')
      .send({ token: firstReset.rawToken, password: OTHER_PASSWORD })
      .expect(400);

    const reset = await mutation('/api/v1/auth/reset-password')
      .send({ token: secondReset.rawToken, password: OTHER_PASSWORD })
      .set('Cookie', requireSessionCookie(firstLogin))
      .expect(204);
    assert.match(requireCookieHeader(reset), new RegExp(`^${COOKIE_NAME}=;`));
    assert.equal(await prisma.session.count(), 0);
    const consumed = await prisma.authToken.findUniqueOrThrow({
      where: { id: secondReset.tokenId },
    });
    assert.ok(consumed.consumedAt);
    assert.equal(consumed.invalidatedAt, null);
    await api().get('/api/v1/auth/me').set('Cookie', requireSessionCookie(secondLogin)).expect(401);
    await login('reset@example.ru', PASSWORD).expect(401);
    await login('reset@example.ru', OTHER_PASSWORD).expect(200);
    await mutation('/api/v1/auth/reset-password')
      .send({ token: secondReset.rawToken, password: PASSWORD })
      .expect(400);
  });

  void test('does not create a session from an old password check that overlaps reset', async (context) => {
    await registerAndVerify({
      email: 'reset-race@example.ru',
      nickname: 'Reset Race',
      password: PASSWORD,
    });
    await mutation('/api/v1/auth/forgot-password')
      .send({ email: 'reset-race@example.ru' })
      .expect(202);
    const token = await latestRawToken('reset-race@example.ru', 'PASSWORD_RESET');
    const { PasswordService } = await import('../src/auth/password.service.js');
    assert.ok(app);
    const passwords = app.get(PasswordService);
    const verify = passwords.verifyPasswordOrDummy.bind(passwords);
    let markChecked!: () => void;
    let resumeLogin!: () => void;
    const checked = new Promise<void>((resolve) => {
      markChecked = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      resumeLogin = resolve;
    });
    context.mock.method(
      passwords,
      'verifyPasswordOrDummy',
      async (...args: Parameters<typeof verify>) => {
        const matches = await verify(...args);
        markChecked();
        await resume;
        return matches;
      },
    );
    const pendingLogin = login('reset-race@example.ru', PASSWORD).then((response) => response);
    try {
      await checked;
      await mutation('/api/v1/auth/reset-password')
        .send({ token: token.rawToken, password: OTHER_PASSWORD })
        .expect(204);
    } finally {
      resumeLogin();
    }
    assert.equal((await pendingLogin).status, 401);
    assert.equal(await prisma.session.count(), 0);
  });

  void test('serializes concurrent consumption and resend without consuming superseded tokens', async () => {
    const email = 'concurrent-tokens@example.ru';
    await register({ email, nickname: 'Concurrent Tokens', password: PASSWORD }).expect(201);
    const first = await latestRawToken(email, 'EMAIL_VERIFICATION');
    await prisma.authToken.update({
      where: { id: first.tokenId },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    const [verification, resend] = await Promise.all([
      mutation('/api/v1/auth/verify-email').send({ token: first.rawToken }),
      mutation('/api/v1/auth/resend-verification').send({ email }),
    ]);
    assert.equal(resend.status, 202);
    assert.ok(verification.status === 204 || verification.status === 400);
    if (verification.status === 400) {
      const current = await latestRawToken(email, 'EMAIL_VERIFICATION');
      const statuses = (
        await Promise.all([
          mutation('/api/v1/auth/verify-email').send({ token: current.rawToken }),
          mutation('/api/v1/auth/verify-email').send({ token: current.rawToken }),
        ])
      )
        .map(({ status }) => status)
        .sort();
      assert.deepEqual(statuses, [204, 400]);
    }
    assert.equal(await prisma.session.count(), 0);
    await mutation('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const reset = await latestRawToken(email, 'PASSWORD_RESET');
    const stored = await prisma.authToken.findUniqueOrThrow({
      where: { id: reset.tokenId },
      include: { emailOutbox: true },
    });
    assert.equal(JSON.stringify(stored).includes(reset.rawToken), false);
    const statuses = (
      await Promise.all([
        mutation('/api/v1/auth/reset-password').send({
          token: reset.rawToken,
          password: OTHER_PASSWORD,
        }),
        mutation('/api/v1/auth/reset-password').send({
          token: reset.rawToken,
          password: OTHER_PASSWORD,
        }),
      ])
    )
      .map(({ status }) => status)
      .sort();
    assert.deepEqual(statuses, [204, 400]);
  });

  void test('preserves current-session logout, independent sessions, and session expiry', async () => {
    const email = 'session-boundaries@example.ru';
    await registerAndVerify({ email, nickname: 'Session Boundaries', password: PASSWORD });
    const first = requireSessionCookie(await login(email, PASSWORD).expect(200));
    const second = requireSessionCookie(await login(email, PASSWORD).expect(200));
    await api().get('/api/v1/auth/me').expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', first).expect(200);
    const logout = await mutation('/api/v1/auth/logout').set('Cookie', first).expect(204);
    assert.match(requireCookieHeader(logout), new RegExp(`^${COOKIE_NAME}=;`));
    await mutation('/api/v1/auth/logout').set('Cookie', first).expect(204);
    await api().get('/api/v1/auth/me').set('Cookie', first).expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', second).expect(200);
    assert.equal(await prisma.session.count(), 1);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1_000) } });
    await api().get('/api/v1/auth/me').set('Cookie', second).expect(401);
  });

  void test('rejects expired reset tokens and tokens used for the wrong purpose', async () => {
    const email = 'expired-reset@example.ru';
    await register({ email, nickname: 'Expired Reset', password: PASSWORD }).expect(201);
    const verification = await latestRawToken(email, 'EMAIL_VERIFICATION');
    await mutation('/api/v1/auth/reset-password')
      .send({ token: verification.rawToken, password: OTHER_PASSWORD })
      .expect(400);
    await verifyRegisteredAccount(email);
    await mutation('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const reset = await latestRawToken(email, 'PASSWORD_RESET');
    await mutation('/api/v1/auth/verify-email').send({ token: reset.rawToken }).expect(400);
    await prisma.authToken.update({
      where: { id: reset.tokenId },
      data: {
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });
    await mutation('/api/v1/auth/reset-password')
      .send({ token: reset.rawToken, password: OTHER_PASSWORD })
      .expect(400);
    const stored = await prisma.authToken.findUniqueOrThrow({ where: { id: reset.tokenId } });
    assert.equal(stored.consumedAt, null);
    assert.equal(stored.invalidatedAt, null);
    await login(email, PASSWORD).expect(200);
  });

  void test('rejects expired verification tokens', async () => {
    await register({ email: 'expired@example.ru', nickname: 'Expired', password: PASSWORD }).expect(
      201,
    );
    const token = await latestRawToken('expired@example.ru', 'EMAIL_VERIFICATION');
    await prisma.authToken.update({
      where: { id: token.tokenId },
      data: {
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60_000),
      },
    });
    const response = await mutation('/api/v1/auth/verify-email')
      .send({ token: token.rawToken })
      .expect(400);
    assert.equal(readErrorCode(response.body as unknown), 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN');
  });

  void test('preserves validation, duplicate, origin, CORS, and concurrency boundaries', async () => {
    const invalid = await register({
      email: 'angler@example.com',
      nickname: 'Wrong Domain',
      password: PASSWORD,
    }).expect(400);
    assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');

    await register({ email: 'mixed@example.ru', nickname: 'Original', password: PASSWORD }).expect(
      201,
    );
    const duplicate = await register({
      email: 'MIXED@EXAMPLE.RU',
      nickname: 'Different',
      password: OTHER_PASSWORD,
    }).expect(409);
    assert.equal(readErrorCode(duplicate.body as unknown), 'EMAIL_ALREADY_EXISTS');

    const allowed = await register({
      email: 'allowed@example.ru',
      nickname: 'Allowed',
      password: PASSWORD,
    })
      .expect(201)
      .expect('Access-Control-Allow-Origin', WEB_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true');
    assert.deepEqual(getSetCookieHeaders(allowed), []);
    await api()
      .post('/api/v1/auth/register')
      .set('Origin', FOREIGN_ORIGIN)
      .send({ email: 'foreign@example.ru', nickname: 'Foreign', password: PASSWORD })
      .expect(403);

    const raceInput = {
      email: 'race@example.ru',
      nickname: 'Registration Race',
      password: PASSWORD,
    };
    const statuses = (await Promise.all([register(raceInput), register(raceInput)]))
      .map(({ status }) => status)
      .sort();
    assert.deepEqual(statuses, [201, 409]);
    assert.equal(await prisma.session.count(), 0);
  });

  void test('keeps banned verified login and trusted ADMIN seed verification semantics', async () => {
    await registerAndVerify({
      email: 'banned@example.ru',
      nickname: 'Banned Angler',
      password: PASSWORD,
    });
    await prisma.user.update({
      where: { email: 'banned@example.ru' },
      data: { isBanned: true },
    });
    assert.equal(
      readSafeUser((await login('banned@example.ru', PASSWORD).expect(200)).body).isBanned,
      true,
    );

    const created = await seedAdmin(prisma, {
      email: 'new.admin@example.ru',
      nickname: 'Test Admin',
      password: PASSWORD,
    });
    assert.equal(created, 'created');
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'new.admin@example.ru' } });
    assert.equal(admin.role, 'ADMIN');
    assert.ok(admin.emailVerifiedAt);
    assert.equal(await prisma.session.count({ where: { userId: admin.id } }), 0);

    await register({
      email: 'pending-admin@example.ru',
      nickname: 'Pending Admin',
      password: PASSWORD,
    }).expect(201);
    const pendingBefore = await prisma.user.findUniqueOrThrow({
      where: { email: 'pending-admin@example.ru' },
    });
    const pendingVerification = await prisma.authToken.findFirstOrThrow({
      where: { userId: pendingBefore.id, purpose: 'EMAIL_VERIFICATION' },
    });
    const promoted = await seedAdmin(prisma, { email: 'pending-admin@example.ru' });
    assert.equal(promoted, 'promoted');
    const pendingAfter = await prisma.user.findUniqueOrThrow({ where: { id: pendingBefore.id } });
    assert.equal(pendingAfter.role, 'ADMIN');
    assert.ok(pendingAfter.emailVerifiedAt);
    assert.equal(pendingAfter.passwordHash, pendingBefore.passwordHash);
    assert.equal(pendingAfter.nickname, pendingBefore.nickname);
    const invalidatedVerification = await prisma.authToken.findUniqueOrThrow({
      where: { id: pendingVerification.id },
    });
    assert.equal(invalidatedVerification.consumedAt, null);
    assert.ok(invalidatedVerification.invalidatedAt);
    assert.equal(await seedAdmin(prisma, { email: 'pending-admin@example.ru' }), 'unchanged');
  });
});
