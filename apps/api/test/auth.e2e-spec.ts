import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
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

// Explicit shell variables win. Local files make the documented copy-to-test/.env flow convenient.
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
type SeedAdmin = typeof import('../src/prisma/seed.js').seedAdmin;

const originalRuntimeEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

let app: INestApplication | undefined;
let httpServer: Server;
let prisma: PrismaServiceInstance;
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

function register(input: RegistrationInput): ReturnType<ReturnType<typeof request>['post']> {
  return api().post('/api/v1/auth/register').set('Origin', WEB_ORIGIN).send(input);
}

function login(email: string, password: string): ReturnType<ReturnType<typeof request>['post']> {
  return api().post('/api/v1/auth/login').set('Origin', WEB_ORIGIN).send({ email, password });
}

function getSetCookieHeaders(response: { headers: Record<string, unknown> }): string[] {
  const header = response.headers['set-cookie'];

  if (typeof header === 'string') {
    return [header];
  }

  if (Array.isArray(header) && header.every((value) => typeof value === 'string')) {
    return header;
  }

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
  assert.equal(new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}$`).test(cookiePair), true);
  return cookiePair;
}

function getCookieAttributes(cookieHeader: string): string {
  const firstAttributeIndex = cookieHeader.indexOf(';');
  assert.notEqual(firstAttributeIndex, -1);
  return cookieHeader.slice(firstAttributeIndex);
}

function getRawSessionToken(cookiePair: string): string {
  const separatorIndex = cookiePair.indexOf('=');
  assert.notEqual(separatorIndex, -1);
  const token = cookiePair.slice(separatorIndex + 1);
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(token), true);
  return token;
}

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${field} must be a string`);
  }

  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    assert.fail(`${field} must be a boolean`);
  }

  return value;
}

function asRole(value: unknown): SafeUser['role'] {
  if (value !== 'USER' && value !== 'ADMIN') {
    assert.fail('role must be USER or ADMIN');
  }

  return value;
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

  return {
    id: asString(user.id, 'id'),
    email: asString(user.email, 'email'),
    nickname: asString(user.nickname, 'nickname'),
    role: asRole(user.role),
    isBanned: asBoolean(user.isBanned, 'isBanned'),
    createdAt: asString(user.createdAt, 'createdAt'),
  };
}

function readErrorCode(body: unknown): string {
  const payload = asObject(body);
  return asString(payload.code, 'code');
}

void describe('Auth API (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    // This check must happen before DATABASE_URL is replaced for the Nest test process.
    databaseConfiguration = getTestDatabaseConfiguration(process.env);

    process.env.DATABASE_URL = databaseConfiguration.testDatabaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.WEB_ORIGIN = WEB_ORIGIN;

    const [{ AppModule }, { configureApplication }, prismaModule, seedModule] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/app.setup.js'),
      import('../src/prisma/prisma.service.js'),
      import('../src/prisma/seed.js'),
    ]);

    seedAdmin = seedModule.seedAdmin;
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    await app.init();

    httpServer = app.getHttpServer() as Server;
    prisma = app.get(prismaModule.PrismaService);
    clearDatabase = async () => {
      await clearTestData(databaseConfiguration, {
        deleteCatchReports: async () => {
          await prisma.catchReport.deleteMany();
        },
        deleteFishingBaseFish: async () => {
          await prisma.fishingBaseFish.deleteMany();
        },
        deleteLocations: async () => {
          await prisma.location.deleteMany();
        },
        deleteFishingBases: async () => {
          await prisma.fishingBase.deleteMany();
        },
        deleteFish: async () => {
          await prisma.fish.deleteMany();
        },
        deleteBaits: async () => {
          await prisma.bait.deleteMany();
        },
        deleteScreenAnchors: async () => {
          await prisma.screenAnchor.deleteMany();
        },
        deleteSessions: async () => {
          await prisma.session.deleteMany();
        },
        deleteUsers: async () => {
          await prisma.user.deleteMany();
        },
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
      restoreEnvironmentValue('DATABASE_URL', originalRuntimeEnvironment.DATABASE_URL);
      restoreEnvironmentValue('NODE_ENV', originalRuntimeEnvironment.NODE_ENV);
      restoreEnvironmentValue('PORT', originalRuntimeEnvironment.PORT);
      restoreEnvironmentValue('WEB_ORIGIN', originalRuntimeEnvironment.WEB_ORIGIN);
    }
  });

  void test('registers a user, authenticates automatically, and stores only hashes', async () => {
    const response = await register({
      email: 'first@example.ru',
      nickname: 'First Angler',
      password: PASSWORD,
    }).expect(201);

    const responseUser = readSafeUser(response.body as unknown);
    assert.equal(responseUser.email, 'first@example.ru');
    assert.equal(responseUser.nickname, 'First Angler');
    assert.equal(responseUser.role, 'USER');
    assert.equal(responseUser.isBanned, false);

    const cookieAttributes = getCookieAttributes(requireCookieHeader(response));
    assert.match(cookieAttributes, /;\s*HttpOnly/i);
    assert.match(cookieAttributes, /;\s*SameSite=Lax/i);
    assert.match(cookieAttributes, /;\s*Path=\//i);
    assert.match(
      cookieAttributes,
      new RegExp(`;\\s*Max-Age=${SESSION_MAX_AGE_SECONDS}(?:;|$)`, 'i'),
    );
    assert.match(cookieAttributes, /;\s*Expires=/i);
    assert.doesNotMatch(cookieAttributes, /;\s*Secure/i);

    const cookiePair = requireSessionCookie(response);
    const rawToken = getRawSessionToken(cookiePair);
    const expectedTokenHash = createHash('sha256').update(rawToken).digest('hex');

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'first@example.ru' },
    });
    assert.equal(storedUser.passwordHash === PASSWORD, false);
    assert.equal(storedUser.passwordHash.includes(PASSWORD), false);
    assert.equal(storedUser.passwordHash.startsWith('$scrypt$v=1$'), true);

    const storedSession = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: expectedTokenHash },
    });
    assert.equal(storedSession.userId, storedUser.id);
    assert.equal(storedSession.tokenHash === expectedTokenHash, true);
    assert.equal(storedSession.tokenHash === rawToken, false);
    assert.equal(/^[a-f0-9]{64}$/.test(storedSession.tokenHash), true);
    assert.equal(JSON.stringify(storedSession).includes(rawToken), false);
    assert.equal(
      storedSession.expiresAt.getTime() - storedSession.createdAt.getTime(),
      SESSION_MAX_AGE_SECONDS * 1_000,
    );

    const serializedBody = JSON.stringify(response.body);
    assert.equal(serializedBody.includes(rawToken), false);
    assert.equal(serializedBody.includes('passwordHash'), false);
    assert.equal(serializedBody.includes('nicknameNormalized'), false);
    assert.equal(serializedBody.includes('tokenHash'), false);

    const meResponse = await api().get('/api/v1/auth/me').set('Cookie', cookiePair).expect(200);
    assert.deepEqual(readSafeUser(meResponse.body as unknown), responseUser);
  });

  void test('accepts .ru case-insensitively and stores normalized email and nickname', async () => {
    const response = await register({
      email: '  CAPS@Sub.Example.RU  ',
      nickname: '  Рыбак  ',
      password: PASSWORD,
    }).expect(201);

    const user = readSafeUser(response.body as unknown);
    assert.equal(user.email, 'caps@sub.example.ru');
    assert.equal(user.nickname, 'Рыбак');

    const storedUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'caps@sub.example.ru' },
    });
    assert.equal(storedUser.nickname, 'Рыбак');
    assert.equal(storedUser.nicknameNormalized, 'рыбак');
  });

  void test('rejects non-.ru email and forbidden DTO fields', async () => {
    const invalidDomain = await register({
      email: 'angler@example.com',
      nickname: 'Wrong Domain',
      password: PASSWORD,
    }).expect(400);
    assert.equal(readErrorCode(invalidDomain.body as unknown), 'VALIDATION_ERROR');

    const forbiddenField = await api()
      .post('/api/v1/auth/register')
      .set('Origin', WEB_ORIGIN)
      .send({
        email: 'admin-attempt@example.ru',
        nickname: 'Admin Attempt',
        password: PASSWORD,
        role: 'ADMIN',
        isBanned: false,
      })
      .expect(400);
    assert.equal(readErrorCode(forbiddenField.body as unknown), 'VALIDATION_ERROR');
    assert.equal(await prisma.user.count(), 0);
  });

  void test('rejects a case-insensitive duplicate email', async () => {
    await register({
      email: 'Mixed@Example.ru',
      nickname: 'Original Email',
      password: PASSWORD,
    }).expect(201);

    const duplicate = await register({
      email: 'mixed@EXAMPLE.RU',
      nickname: 'Second Email',
      password: OTHER_PASSWORD,
    }).expect(409);

    assert.equal(readErrorCode(duplicate.body as unknown), 'EMAIL_ALREADY_EXISTS');
    assert.equal(await prisma.user.count(), 1);
  });

  void test('rejects a case-insensitive duplicate normalized nickname', async () => {
    await register({
      email: 'nickname-one@example.ru',
      nickname: 'BigFish',
      password: PASSWORD,
    }).expect(201);

    const duplicate = await register({
      email: 'nickname-two@example.ru',
      nickname: 'bigfish',
      password: OTHER_PASSWORD,
    }).expect(409);

    assert.equal(readErrorCode(duplicate.body as unknown), 'NICKNAME_ALREADY_EXISTS');
    assert.equal(await prisma.user.count(), 1);
  });

  void test('logs in successfully and permits multiple independent sessions', async () => {
    const registration = await register({
      email: 'sessions@example.ru',
      nickname: 'Many Sessions',
      password: PASSWORD,
    }).expect(201);
    const registrationCookie = requireSessionCookie(registration);

    const firstLogin = await login('SESSIONS@EXAMPLE.RU', PASSWORD).expect(200);
    const secondLogin = await login('sessions@example.ru', PASSWORD).expect(200);
    const firstLoginCookie = requireSessionCookie(firstLogin);
    const secondLoginCookie = requireSessionCookie(secondLogin);

    assert.equal(firstLoginCookie === registrationCookie, false);
    assert.equal(secondLoginCookie === registrationCookie, false);
    assert.equal(firstLoginCookie === secondLoginCookie, false);
    assert.equal(await prisma.session.count(), 3);

    for (const cookie of [registrationCookie, firstLoginCookie, secondLoginCookie]) {
      const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      assert.equal(readSafeUser(me.body as unknown).email, 'sessions@example.ru');
    }
  });

  void test('returns the same invalid-credentials response for unknown email and wrong password', async () => {
    await register({
      email: 'credentials@example.ru',
      nickname: 'Credentials',
      password: PASSWORD,
    }).expect(201);

    const unknownEmail = await login('unknown@example.ru', OTHER_PASSWORD).expect(401);
    const wrongPassword = await login('credentials@example.ru', OTHER_PASSWORD).expect(401);

    assert.equal(readErrorCode(unknownEmail.body as unknown), 'INVALID_CREDENTIALS');
    assert.deepEqual(wrongPassword.body, unknownEmail.body);
  });

  void test('/auth/me requires a valid session', async () => {
    const response = await api().get('/api/v1/auth/me').expect(401);
    assert.equal(readErrorCode(response.body as unknown), 'AUTH_REQUIRED');
  });

  void test('logout is idempotent, removes only the current session, and clears its cookie', async () => {
    const registration = await register({
      email: 'logout@example.ru',
      nickname: 'Logout Angler',
      password: PASSWORD,
    }).expect(201);
    const cookiePair = requireSessionCookie(registration);
    const otherSession = await login('logout@example.ru', PASSWORD).expect(200);
    const otherSessionCookie = requireSessionCookie(otherSession);
    assert.equal(await prisma.session.count(), 2);

    const logout = await api()
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookiePair)
      .expect(204);

    const clearCookieHeader = requireCookieHeader(logout);
    assert.match(clearCookieHeader, new RegExp(`^${COOKIE_NAME}=;`));
    assert.match(clearCookieHeader, /;\s*Max-Age=0(?:;|$)/i);
    assert.match(clearCookieHeader, /;\s*Expires=/i);
    assert.match(clearCookieHeader, /;\s*HttpOnly/i);
    assert.match(clearCookieHeader, /;\s*SameSite=Lax/i);
    assert.match(clearCookieHeader, /;\s*Path=\//i);
    assert.doesNotMatch(clearCookieHeader, /;\s*Secure/i);
    assert.equal(await prisma.session.count(), 1);

    await api().get('/api/v1/auth/me').set('Cookie', cookiePair).expect(401);
    await api().get('/api/v1/auth/me').set('Cookie', otherSessionCookie).expect(200);
    await api()
      .post('/api/v1/auth/logout')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', cookiePair)
      .expect(204);
  });

  void test('rejects an expired session without relying on database cleanup', async () => {
    const registration = await register({
      email: 'expired@example.ru',
      nickname: 'Expired Session',
      password: PASSWORD,
    }).expect(201);
    const cookiePair = requireSessionCookie(registration);
    const tokenHash = createHash('sha256').update(getRawSessionToken(cookiePair)).digest('hex');

    await prisma.session.update({
      where: { tokenHash },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await api().get('/api/v1/auth/me').set('Cookie', cookiePair).expect(401);
    assert.equal(await prisma.session.count(), 1);
  });

  void test('allows a banned user to log in and read /auth/me', async () => {
    await register({
      email: 'banned@example.ru',
      nickname: 'Banned Angler',
      password: PASSWORD,
    }).expect(201);
    await prisma.user.update({
      where: { email: 'banned@example.ru' },
      data: { isBanned: true },
    });

    const loginResponse = await login('banned@example.ru', PASSWORD).expect(200);
    assert.equal(readSafeUser(loginResponse.body as unknown).isBanned, true);

    const me = await api()
      .get('/api/v1/auth/me')
      .set('Cookie', requireSessionCookie(loginResponse))
      .expect(200);
    assert.equal(readSafeUser(me.body as unknown).isBanned, true);
  });

  void test('enforces allowed Origin, Referer fallback, and credentialed CORS', async () => {
    const allowed = await api()
      .post('/api/v1/auth/register')
      .set('Origin', WEB_ORIGIN)
      .send({
        email: 'allowed-origin@example.ru',
        nickname: 'Allowed Origin',
        password: PASSWORD,
      })
      .expect(201)
      .expect('Access-Control-Allow-Origin', WEB_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true');
    assert.ok(requireSessionCookie(allowed));

    await api()
      .post('/api/v1/auth/register')
      .set('Referer', `${WEB_ORIGIN}/register`)
      .send({
        email: 'referer-origin@example.ru',
        nickname: 'Referer Origin',
        password: PASSWORD,
      })
      .expect(201);

    for (const origin of [FOREIGN_ORIGIN, 'null']) {
      const rejected = await api()
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({
          email: `rejected-${origin.length}@example.ru`,
          nickname: `Rejected ${origin.length}`,
          password: PASSWORD,
        })
        .expect(403);
      assert.equal(readErrorCode(rejected.body as unknown), 'INVALID_REQUEST_ORIGIN');
    }

    const missingOrigin = await api()
      .post('/api/v1/auth/register')
      .send({
        email: 'missing-origin@example.ru',
        nickname: 'Missing Origin',
        password: PASSWORD,
      })
      .expect(403);
    assert.equal(readErrorCode(missingOrigin.body as unknown), 'INVALID_REQUEST_ORIGIN');

    await api()
      .options('/api/v1/auth/register')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .expect(204)
      .expect('Access-Control-Allow-Origin', WEB_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true');
  });

  void test('resolves a concurrent registration uniqueness race without a 500 response', async () => {
    const input = {
      email: 'race@example.ru',
      nickname: 'Registration Race',
      password: PASSWORD,
    };
    const responses = await Promise.all([register(input), register(input)]);
    const statuses = responses
      .map((response) => response.status)
      .sort((left, right) => left - right);

    assert.deepEqual(statuses, [201, 409]);
    assert.equal(await prisma.user.count(), 1);
    assert.equal(await prisma.session.count(), 1);

    const conflict = responses.find((response) => response.status === 409);
    assert.ok(conflict);
    assert.ok(
      ['EMAIL_ALREADY_EXISTS', 'NICKNAME_ALREADY_EXISTS'].includes(
        readErrorCode(conflict.body as unknown),
      ),
    );
  });

  void test('ADMIN seed creates a normalized admin without a session', async () => {
    const result = await seedAdmin(prisma, {
      email: '  NEW.ADMIN@Example.RU  ',
      nickname: '  Test Admin  ',
      password: PASSWORD,
    });

    assert.equal(result, 'created');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: 'new.admin@example.ru' },
    });
    assert.equal(admin.nickname, 'Test Admin');
    assert.equal(admin.nicknameNormalized, 'test admin');
    assert.equal(admin.role, 'ADMIN');
    assert.equal(admin.isBanned, false);
    assert.equal(admin.passwordHash === PASSWORD, false);
    assert.equal(admin.passwordHash.startsWith('$scrypt$v=1$'), true);
    assert.equal(await prisma.session.count(), 0);
  });

  void test('ADMIN seed promotes idempotently and preserves credentials, profile, ban, and sessions', async () => {
    await register({
      email: 'seed-existing@example.ru',
      nickname: 'Existing User',
      password: PASSWORD,
    }).expect(201);
    await prisma.user.update({
      where: { email: 'seed-existing@example.ru' },
      data: { isBanned: true },
    });

    const beforePromotion = await prisma.user.findUniqueOrThrow({
      where: { email: 'seed-existing@example.ru' },
    });
    const sessionIdsBefore = (
      await prisma.session.findMany({
        where: { userId: beforePromotion.id },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map(({ id }) => id);

    const promoted = await seedAdmin(prisma, { email: ' SEED-EXISTING@EXAMPLE.RU ' });
    assert.equal(promoted, 'promoted');

    const afterPromotion = await prisma.user.findUniqueOrThrow({
      where: { id: beforePromotion.id },
    });
    assert.equal(afterPromotion.role, 'ADMIN');
    assert.equal(afterPromotion.nickname, beforePromotion.nickname);
    assert.equal(afterPromotion.nicknameNormalized, beforePromotion.nicknameNormalized);
    assert.equal(afterPromotion.passwordHash === beforePromotion.passwordHash, true);
    assert.equal(afterPromotion.isBanned, true);
    assert.deepEqual(
      (
        await prisma.session.findMany({
          where: { userId: beforePromotion.id },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      ).map(({ id }) => id),
      sessionIdsBefore,
    );

    const unchanged = await seedAdmin(prisma, { email: 'seed-existing@example.ru' });
    assert.equal(unchanged, 'unchanged');
    const afterIdempotentRun = await prisma.user.findUniqueOrThrow({
      where: { id: beforePromotion.id },
    });
    assert.equal(afterIdempotentRun.updatedAt.getTime(), afterPromotion.updatedAt.getTime());
    assert.equal(afterIdempotentRun.passwordHash === beforePromotion.passwordHash, true);
  });

  void test('ADMIN seed reports a stable conflict when the configured nickname is occupied', async () => {
    await register({
      email: 'nickname-owner@example.ru',
      nickname: 'Reserved Admin Name',
      password: PASSWORD,
    }).expect(201);

    await assert.rejects(
      seedAdmin(prisma, {
        email: 'another-admin@example.ru',
        nickname: 'reserved admin name',
        password: OTHER_PASSWORD,
      }),
      /ADMIN_NICKNAME_ALREADY_EXISTS/,
    );

    assert.equal(await prisma.user.count({ where: { email: 'another-admin@example.ru' } }), 0);
    assert.equal(
      (
        await prisma.user.findUniqueOrThrow({
          where: { email: 'nickname-owner@example.ru' },
          select: { role: true },
        })
      ).role,
      'USER',
    );
  });
});
