import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnvironmentFile } from 'dotenv';
import request from 'supertest';
import { getTestDatabaseConfiguration } from './database.js';

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE_NAME = 'fishing_session';
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const TEST_EMAIL_PREFIX = 'favorite-api-';
const TEST_FISH_PREFIX = 'favorite-api-';

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

type PrismaServiceInstance = import('../src/prisma/prisma.service.js').PrismaService;
type SessionServiceInstance = import('../src/auth/session.service.js').SessionService;

const originalRuntimeEnvironment = {
  BAIT_IMAGE_DELIVERY_MODE: process.env.BAIT_IMAGE_DELIVERY_MODE,
  DATABASE_URL: process.env.DATABASE_URL,
  FISH_IMAGE_DELIVERY_MODE: process.env.FISH_IMAGE_DELIVERY_MODE,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  RECORDS_SYNC_ENABLED: process.env.RECORDS_SYNC_ENABLED,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

let app: INestApplication | undefined;
let httpServer: Server;
let prisma: PrismaServiceInstance;
let sessions: SessionServiceInstance;
let actorSequence = 0;

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function api(): ReturnType<typeof request> {
  return request(httpServer);
}

async function clearFavoritesFixtures(): Promise<void> {
  await prisma.userFavoriteFish.deleteMany({
    where: {
      OR: [
        { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
        { fish: { nameNormalized: { startsWith: TEST_FISH_PREFIX } } },
      ],
    },
  });
  await prisma.session.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_PREFIX } } });
  await prisma.fish.deleteMany({ where: { nameNormalized: { startsWith: TEST_FISH_PREFIX } } });
}

async function createActor(): Promise<{ cookie: string; userId: string }> {
  actorSequence += 1;
  const user = await prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${actorSequence}@example.ru`,
      nickname: `Favorite Actor ${actorSequence}`,
      nicknameNormalized: `favorite actor ${actorSequence}`,
      passwordHash: 'not-used-by-session-test',
      emailVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  const session = await sessions.createSession(user.id);
  return { cookie: `${COOKIE_NAME}=${session.rawToken}`, userId: user.id };
}

async function createFish(sequence: number): Promise<{ id: string }> {
  return prisma.fish.create({
    data: {
      name: `Favorite API Fish ${sequence}`,
      nameNormalized: `${TEST_FISH_PREFIX}${sequence}`,
    },
    select: { id: true },
  });
}

void describe('Fish favorites API (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    const databaseConfiguration = getTestDatabaseConfiguration(process.env);
    process.env.DATABASE_URL = databaseConfiguration.testDatabaseUrl;
    process.env.BAIT_IMAGE_DELIVERY_MODE = 'disabled';
    process.env.FISH_IMAGE_DELIVERY_MODE = 'disabled';
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.RECORDS_SYNC_ENABLED = 'false';
    process.env.WEB_ORIGIN = WEB_ORIGIN;

    const [{ AppModule }, { configureApplication }, prismaModule, sessionModule] =
      await Promise.all([
        import('../src/app.module.js'),
        import('../src/app.setup.js'),
        import('../src/prisma/prisma.service.js'),
        import('../src/auth/session.service.js'),
      ]);
    app = await NestFactory.create(AppModule, { logger: false });
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(prismaModule.PrismaService);
    sessions = app.get(sessionModule.SessionService);
    await clearFavoritesFixtures();
  });

  void beforeEach(async () => {
    await clearFavoritesFixtures();
  });

  void after(async () => {
    try {
      await clearFavoritesFixtures();
      await app?.close();
    } finally {
      for (const [name, value] of Object.entries(originalRuntimeEnvironment)) {
        restoreEnvironmentValue(name, value);
      }
    }
  });

  void test('requires authentication for list, add and remove', async () => {
    const fishId = randomUUID();
    await api().get('/api/v1/me/favorite-fish').expect(401);
    await api().post(`/api/v1/me/favorite-fish/${fishId}`).set('Origin', WEB_ORIGIN).expect(401);
    await api().delete(`/api/v1/me/favorite-fish/${fishId}`).set('Origin', WEB_ORIGIN).expect(401);
  });

  void test('isolates users and keeps add/remove idempotent', async () => {
    const firstActor = await createActor();
    const secondActor = await createActor();
    const firstFish = await createFish(1);
    const secondFish = await createFish(2);

    const firstAdd = () =>
      api()
        .post(`/api/v1/me/favorite-fish/${firstFish.id}`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', firstActor.cookie);
    assert.deepEqual((await firstAdd().expect(201)).body, {
      favorite: { fishId: firstFish.id },
    });
    await firstAdd().expect(201);
    await api()
      .post(`/api/v1/me/favorite-fish/${secondFish.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', secondActor.cookie)
      .expect(201);

    assert.equal(
      await prisma.userFavoriteFish.count({
        where: { userId: firstActor.userId, fishId: firstFish.id },
      }),
      1,
    );
    assert.deepEqual(
      (await api().get('/api/v1/me/favorite-fish').set('Cookie', firstActor.cookie).expect(200))
        .body,
      { items: [{ fishId: firstFish.id }] },
    );
    assert.deepEqual(
      (await api().get('/api/v1/me/favorite-fish').set('Cookie', secondActor.cookie).expect(200))
        .body,
      { items: [{ fishId: secondFish.id }] },
    );

    const firstRemove = () =>
      api()
        .delete(`/api/v1/me/favorite-fish/${firstFish.id}`)
        .set('Origin', WEB_ORIGIN)
        .set('Cookie', firstActor.cookie);
    await firstRemove().expect(204);
    await firstRemove().expect(204);
    assert.deepEqual(
      (await api().get('/api/v1/me/favorite-fish').set('Cookie', firstActor.cookie).expect(200))
        .body,
      { items: [] },
    );
    assert.equal(
      await prisma.userFavoriteFish.count({
        where: { userId: secondActor.userId, fishId: secondFish.id },
      }),
      1,
    );
  });

  void test('rejects an unknown Fish without accepting request-supplied ownership', async () => {
    const firstActor = await createActor();
    const secondActor = await createActor();
    const fish = await createFish(3);

    await api()
      .post(`/api/v1/me/favorite-fish/${fish.id}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', firstActor.cookie)
      .send({ userId: secondActor.userId })
      .expect(201);
    assert.equal(
      await prisma.userFavoriteFish.count({
        where: { userId: firstActor.userId, fishId: fish.id },
      }),
      1,
    );
    assert.equal(
      await prisma.userFavoriteFish.count({
        where: { userId: secondActor.userId, fishId: fish.id },
      }),
      0,
    );

    const missing = await api()
      .post(`/api/v1/me/favorite-fish/${randomUUID()}`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', firstActor.cookie)
      .expect(404);
    assert.equal((missing.body as { code?: string }).code, 'FISH_NOT_FOUND');
  });
});
