import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const COOKIE_NAME = 'fishing_session';
const PASSWORD = 'correct horse battery staple';
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

type PrismaServiceInstance = import('../src/prisma/prisma.service.js').PrismaService;
type HttpTest = ReturnType<ReturnType<typeof request>['post']>;

interface AuthenticatedActor {
  cookie: string;
  email: string;
  userId: string;
}

interface CreatedEntity {
  id: string;
  name: string;
}

interface CreatedLocation extends CreatedEntity {
  fishingBaseId: string;
  number: number;
}

const originalRuntimeEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

let actorSequence = 0;
let app: INestApplication | undefined;
let httpServer: Server;
let prisma: PrismaServiceInstance;
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

function unsafe(httpTest: HttpTest, cookie?: string): HttpTest {
  httpTest.set('Origin', WEB_ORIGIN);

  if (cookie !== undefined) {
    httpTest.set('Cookie', cookie);
  }

  return httpTest;
}

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${field} must be a string`);
  }

  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    assert.fail(`${field} must be a number`);
  }

  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    assert.fail(`${field} must be a boolean`);
  }

  return value;
}

function readEnvelope(body: unknown, key: string): Record<string, unknown> {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), [key]);
  return asObject(payload[key]);
}

function readItems(body: unknown): Record<string, unknown>[] {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['items']);
  return asArray(payload.items).map((item) => asObject(item));
}

function readErrorCode(body: unknown): string {
  return asString(asObject(body).code, 'code');
}

function assertPublicProjection(body: unknown): void {
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('nameNormalized'), false);
  assert.equal(serialized.includes('isActive'), false);
  assert.equal(serialized.includes('createdAt'), false);
  assert.equal(serialized.includes('updatedAt'), false);
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

function requireSessionCookie(response: { headers: Record<string, unknown> }): string {
  const header = getSetCookieHeaders(response).find((value) => value.startsWith(`${COOKIE_NAME}=`));
  assert.ok(header, `${COOKIE_NAME} Set-Cookie header is required`);

  const cookiePair = header.split(';', 1)[0];
  assert.ok(cookiePair);
  assert.equal(new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]{43}$`).test(cookiePair), true);
  return cookiePair;
}

async function createActor(role: 'USER' | 'ADMIN', isBanned = false): Promise<AuthenticatedActor> {
  actorSequence += 1;
  const email = `catalog-actor-${actorSequence}@example.ru`;
  const registration = await unsafe(api().post('/api/v1/auth/register'))
    .send({
      email,
      nickname: `Catalog Actor ${actorSequence}`,
      password: PASSWORD,
    })
    .expect(201);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

  if (role !== user.role || isBanned !== user.isBanned) {
    await prisma.user.update({
      where: { id: user.id },
      data: { role, isBanned },
    });
  }

  return {
    cookie: requireSessionCookie(registration),
    email,
    userId: user.id,
  };
}

async function createBase(cookie: string, name: string): Promise<CreatedEntity> {
  const response = await unsafe(api().post('/api/v1/admin/catalog/bases'), cookie)
    .send({ name })
    .expect(201);
  const base = readEnvelope(response.body as unknown, 'base');

  return {
    id: asString(base.id, 'base.id'),
    name: asString(base.name, 'base.name'),
  };
}

async function createLocation(
  cookie: string,
  fishingBaseId: string,
  number: number,
  name: string,
): Promise<CreatedLocation> {
  const response = await unsafe(
    api().post(`/api/v1/admin/catalog/bases/${fishingBaseId}/locations`),
    cookie,
  )
    .send({ number, name })
    .expect(201);
  const location = readEnvelope(response.body as unknown, 'location');

  return {
    id: asString(location.id, 'location.id'),
    fishingBaseId: asString(location.fishingBaseId, 'location.fishingBaseId'),
    number: asNumber(location.number, 'location.number'),
    name: asString(location.name, 'location.name'),
  };
}

async function createFish(cookie: string, name: string): Promise<CreatedEntity> {
  const response = await unsafe(api().post('/api/v1/admin/catalog/fish'), cookie)
    .send({ name })
    .expect(201);
  const fish = readEnvelope(response.body as unknown, 'fish');

  return {
    id: asString(fish.id, 'fish.id'),
    name: asString(fish.name, 'fish.name'),
  };
}

async function createBait(
  cookie: string,
  name: string,
  type: 'BAIT' | 'LURE',
): Promise<CreatedEntity> {
  const response = await unsafe(api().post('/api/v1/admin/catalog/baits'), cookie)
    .send({ name, type })
    .expect(201);
  const bait = readEnvelope(response.body as unknown, 'bait');

  return {
    id: asString(bait.id, 'bait.id'),
    name: asString(bait.name, 'bait.name'),
  };
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

void describe('Catalog API (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    databaseConfiguration = getTestDatabaseConfiguration(process.env);

    process.env.DATABASE_URL = databaseConfiguration.testDatabaseUrl;
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.WEB_ORIGIN = WEB_ORIGIN;

    const [{ AppModule }, { configureApplication }, prismaModule] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/app.setup.js'),
      import('../src/prisma/prisma.service.js'),
    ]);

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

  void test('anonymous users list only active bases in normalized order', async () => {
    const second = await prisma.fishingBase.create({
      data: { name: 'Бета', nameNormalized: 'бета' },
    });
    const first = await prisma.fishingBase.create({
      data: { name: 'Альфа', nameNormalized: 'альфа' },
    });
    await prisma.fishingBase.create({
      data: { name: 'Скрытая база', nameNormalized: 'скрытая база', isActive: false },
    });

    const response = await api().get('/api/v1/catalog/bases').expect(200);

    assert.deepEqual(response.body, {
      items: [
        { id: first.id, name: first.name },
        { id: second.id, name: second.name },
      ],
    });
    assertPublicProjection(response.body);
  });

  void test('public base detail contains only active Locations and Base Fish', async () => {
    const base = await prisma.fishingBase.create({
      data: { name: 'Амур', nameNormalized: 'амур' },
    });
    const second = await prisma.location.create({
      data: {
        fishingBaseId: base.id,
        number: 2,
        name: 'Вторая',
        nameNormalized: 'вторая',
      },
    });
    const first = await prisma.location.create({
      data: {
        fishingBaseId: base.id,
        number: 1,
        name: 'Первая',
        nameNormalized: 'первая',
      },
    });
    const inactive = await prisma.location.create({
      data: {
        fishingBaseId: base.id,
        number: 3,
        name: 'Скрытая',
        nameNormalized: 'скрытая',
        isActive: false,
      },
    });
    const activeFish = await prisma.fish.create({
      data: { name: 'Карась', nameNormalized: 'карась' },
    });
    const inactiveFish = await prisma.fish.create({
      data: { name: 'Щука', nameNormalized: 'щука', isActive: false },
    });
    await prisma.fishingBaseFish.createMany({
      data: [
        { fishingBaseId: base.id, fishId: activeFish.id },
        { fishingBaseId: base.id, fishId: inactiveFish.id },
      ],
    });

    const detail = await api().get(`/api/v1/catalog/bases/${base.id}`).expect(200);
    assert.deepEqual(detail.body, {
      base: {
        id: base.id,
        name: base.name,
        locations: [
          { id: first.id, number: first.number, name: first.name },
          { id: second.id, number: second.number, name: second.name },
        ],
        fish: [{ id: activeFish.id, name: activeFish.name }],
      },
    });
    assertPublicProjection(detail.body);

    const hiddenLocation = await api().get(`/api/v1/catalog/locations/${inactive.id}`).expect(404);
    assert.equal(readErrorCode(hiddenLocation.body as unknown), 'LOCATION_NOT_FOUND');

    await prisma.fishingBase.update({ where: { id: base.id }, data: { isActive: false } });

    const hiddenBase = await api().get(`/api/v1/catalog/bases/${base.id}`).expect(404);
    assert.equal(readErrorCode(hiddenBase.body as unknown), 'FISHING_BASE_NOT_FOUND');
    const hiddenByParent = await api().get(`/api/v1/catalog/locations/${first.id}`).expect(404);
    assert.equal(readErrorCode(hiddenByParent.body as unknown), 'LOCATION_NOT_FOUND');
  });

  void test('public Location detail returns its active Base without a Fish list', async () => {
    const base = await prisma.fishingBase.create({
      data: { name: 'Озёра', nameNormalized: 'озёра' },
    });
    const location = await prisma.location.create({
      data: {
        fishingBaseId: base.id,
        number: 1,
        name: 'Берег',
        nameNormalized: 'берег',
      },
    });
    const response = await api().get(`/api/v1/catalog/locations/${location.id}`).expect(200);

    assert.deepEqual(response.body, {
      location: {
        id: location.id,
        number: location.number,
        name: location.name,
        fishingBase: { id: base.id, name: base.name },
      },
    });
    assertPublicProjection(response.body);

    await prisma.location.update({ where: { id: location.id }, data: { isActive: false } });
    const hidden = await api().get(`/api/v1/catalog/locations/${location.id}`).expect(404);
    assert.equal(readErrorCode(hidden.body as unknown), 'LOCATION_NOT_FOUND');
  });

  void test('public Fish and Bait lists hide inactive rows and expose BaitType safely', async () => {
    const firstFish = await prisma.fish.create({
      data: { name: 'Карась', nameNormalized: 'карась' },
    });
    const secondFish = await prisma.fish.create({
      data: { name: 'Щука', nameNormalized: 'щука' },
    });
    await prisma.fish.create({
      data: { name: 'Скрытая рыба', nameNormalized: 'скрытая рыба', isActive: false },
    });
    const bait = await prisma.bait.create({
      data: { name: 'Мотыль', nameNormalized: 'мотыль', type: 'BAIT' },
    });
    const lure = await prisma.bait.create({
      data: { name: 'Блесна', nameNormalized: 'блесна', type: 'LURE' },
    });
    await prisma.bait.create({
      data: {
        name: 'Скрытая наживка',
        nameNormalized: 'скрытая наживка',
        type: 'BAIT',
        isActive: false,
      },
    });

    const fishResponse = await api().get('/api/v1/catalog/fish').expect(200);
    assert.deepEqual(fishResponse.body, {
      items: [
        { id: firstFish.id, name: firstFish.name },
        { id: secondFish.id, name: secondFish.name },
      ],
    });
    assertPublicProjection(fishResponse.body);

    const baitResponse = await api().get('/api/v1/catalog/baits').expect(200);
    assert.deepEqual(baitResponse.body, {
      items: [
        { id: lure.id, name: lure.name, type: lure.type },
        { id: bait.id, name: bait.name, type: bait.type },
      ],
    });
    assertPublicProjection(baitResponse.body);
  });

  void test('public detail validates UUIDs and distinguishes missing resources', async () => {
    const malformed = await api().get('/api/v1/catalog/bases/not-a-uuid').expect(400);
    assert.equal(readErrorCode(malformed.body as unknown), 'VALIDATION_ERROR');

    const missingBase = await api().get(`/api/v1/catalog/bases/${randomUUID()}`).expect(404);
    assert.equal(readErrorCode(missingBase.body as unknown), 'FISHING_BASE_NOT_FOUND');
    const missingLocation = await api()
      .get(`/api/v1/catalog/locations/${randomUUID()}`)
      .expect(404);
    assert.equal(readErrorCode(missingLocation.body as unknown), 'LOCATION_NOT_FOUND');
  });

  void test('admin mutations require an active ADMIN session', async () => {
    const anonymous = await unsafe(api().post('/api/v1/admin/catalog/bases'))
      .send({ name: 'Anonymous Base' })
      .expect(401);
    assert.equal(readErrorCode(anonymous.body as unknown), 'AUTH_REQUIRED');

    const actor = await createActor('USER');
    const forbidden = await unsafe(api().post('/api/v1/admin/catalog/bases'), actor.cookie)
      .send({ name: 'User Base' })
      .expect(403);
    assert.equal(readErrorCode(forbidden.body as unknown), 'ADMIN_REQUIRED');

    await prisma.user.update({ where: { id: actor.userId }, data: { role: 'ADMIN' } });
    await unsafe(api().post('/api/v1/admin/catalog/bases'), actor.cookie)
      .send({ name: 'Admin Base' })
      .expect(201);

    await prisma.user.update({ where: { id: actor.userId }, data: { isBanned: true } });
    const banned = await unsafe(api().post('/api/v1/admin/catalog/bases'), actor.cookie)
      .send({ name: 'Banned Admin Base' })
      .expect(403);
    assert.equal(readErrorCode(banned.body as unknown), 'ACCOUNT_BANNED');
    const bannedRead = await api()
      .get('/api/v1/admin/catalog/bases?status=all')
      .set('Cookie', actor.cookie)
      .expect(403);
    assert.equal(readErrorCode(bannedRead.body as unknown), 'ACCOUNT_BANNED');
    assert.equal(await prisma.fishingBase.count(), 1);
  });

  void test('admin creates, normalizes, filters and deactivates a FishingBase without deleting it', async () => {
    const admin = await createActor('ADMIN');
    const created = await createBase(admin.cookie, '  Озера   Танзании  ');
    assert.equal(created.name, 'Озера   Танзании');

    const stored = await prisma.fishingBase.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(stored.nameNormalized, 'озера танзании');
    assert.equal(stored.isActive, true);

    const forbiddenCreateFields = await unsafe(
      api().post('/api/v1/admin/catalog/bases'),
      admin.cookie,
    )
      .send({ name: 'Системная база', nameNormalized: 'системная база', isActive: false })
      .expect(400);
    assert.equal(readErrorCode(forbiddenCreateFields.body as unknown), 'VALIDATION_ERROR');

    const duplicate = await unsafe(api().post('/api/v1/admin/catalog/bases'), admin.cookie)
      .send({ name: 'озера\u00a0танзании' })
      .expect(409);
    assert.equal(readErrorCode(duplicate.body as unknown), 'FISHING_BASE_NAME_ALREADY_EXISTS');

    const emptyUpdate = await unsafe(
      api().patch(`/api/v1/admin/catalog/bases/${created.id}`),
      admin.cookie,
    )
      .send({})
      .expect(400);
    assert.equal(readErrorCode(emptyUpdate.body as unknown), 'VALIDATION_ERROR');

    const deactivated = await unsafe(
      api().patch(`/api/v1/admin/catalog/bases/${created.id}`),
      admin.cookie,
    )
      .send({ isActive: false })
      .expect(200);
    assert.equal(
      asBoolean(readEnvelope(deactivated.body as unknown, 'base').isActive, 'isActive'),
      false,
    );

    const publicList = await api().get('/api/v1/catalog/bases').expect(200);
    assert.deepEqual(publicList.body, { items: [] });

    const inactiveList = await api()
      .get('/api/v1/admin/catalog/bases?status=inactive')
      .set('Cookie', admin.cookie)
      .expect(200);
    const inactiveItems = readItems(inactiveList.body as unknown);
    assert.equal(inactiveItems.length, 1);
    assert.equal(asString(inactiveItems[0]?.id, 'base.id'), created.id);
    assert.equal(asBoolean(inactiveItems[0]?.isActive, 'base.isActive'), false);
    assert.equal(await prisma.fishingBase.count({ where: { id: created.id } }), 1);

    const invalidStatus = await api()
      .get('/api/v1/admin/catalog/bases?status=unknown')
      .set('Cookie', admin.cookie)
      .expect(400);
    assert.equal(readErrorCode(invalidStatus.body as unknown), 'VALIDATION_ERROR');
  });

  void test('Location constraints are scoped to Base and inactive Base blocks create and activation', async () => {
    const admin = await createActor('ADMIN');
    const firstBase = await createBase(admin.cookie, 'Первая база');
    const secondBase = await createBase(admin.cookie, 'Вторая база');
    const firstLocation = await createLocation(
      admin.cookie,
      firstBase.id,
      1,
      '  Протока   Бешеная  ',
    );
    await createLocation(admin.cookie, secondBase.id, 1, 'Протока Бешеная');

    const stored = await prisma.location.findUniqueOrThrow({ where: { id: firstLocation.id } });
    assert.equal(stored.nameNormalized, 'протока бешеная');
    assert.equal(stored.number, 1);

    const duplicateNumber = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${firstBase.id}/locations`),
      admin.cookie,
    )
      .send({ number: 1, name: 'Другое место' })
      .expect(409);
    assert.equal(readErrorCode(duplicateNumber.body as unknown), 'LOCATION_NUMBER_ALREADY_EXISTS');

    const duplicateName = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${firstBase.id}/locations`),
      admin.cookie,
    )
      .send({ number: 2, name: 'протока\u00a0бешеная' })
      .expect(409);
    assert.equal(readErrorCode(duplicateName.body as unknown), 'LOCATION_NAME_ALREADY_EXISTS');

    const invalidNumber = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${firstBase.id}/locations`),
      admin.cookie,
    )
      .send({ number: 0, name: 'Нулевая' })
      .expect(400);
    assert.equal(readErrorCode(invalidNumber.body as unknown), 'VALIDATION_ERROR');

    const attemptedMove = await unsafe(
      api().patch(`/api/v1/admin/catalog/locations/${firstLocation.id}`),
      admin.cookie,
    )
      .send({ fishingBaseId: secondBase.id })
      .expect(400);
    assert.equal(readErrorCode(attemptedMove.body as unknown), 'VALIDATION_ERROR');

    await unsafe(api().patch(`/api/v1/admin/catalog/locations/${firstLocation.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);
    await unsafe(api().patch(`/api/v1/admin/catalog/bases/${firstBase.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);

    const createUnderInactive = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${firstBase.id}/locations`),
      admin.cookie,
    )
      .send({ number: 3, name: 'Поздняя локация' })
      .expect(409);
    assert.equal(readErrorCode(createUnderInactive.body as unknown), 'FISHING_BASE_INACTIVE');

    const activateUnderInactive = await unsafe(
      api().patch(`/api/v1/admin/catalog/locations/${firstLocation.id}`),
      admin.cookie,
    )
      .send({ isActive: true })
      .expect(409);
    assert.equal(readErrorCode(activateUnderInactive.body as unknown), 'FISHING_BASE_INACTIVE');

    const adminDetail = await api()
      .get(`/api/v1/admin/catalog/bases/${firstBase.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    const locations = asArray(readEnvelope(adminDetail.body as unknown, 'base').locations);
    assert.equal(locations.length, 1);
    assert.equal(asString(asObject(locations[0]).id, 'location.id'), firstLocation.id);
  });

  void test('Fish names are globally normalized and deactivation preserves the row', async () => {
    const admin = await createActor('ADMIN');
    const fish = await createFish(admin.cookie, '  БЕЛЫЙ   АМУР  ');
    const stored = await prisma.fish.findUniqueOrThrow({ where: { id: fish.id } });
    assert.equal(stored.nameNormalized, 'белый амур');

    const duplicate = await unsafe(api().post('/api/v1/admin/catalog/fish'), admin.cookie)
      .send({ name: 'белый\u00a0амур' })
      .expect(409);
    assert.equal(readErrorCode(duplicate.body as unknown), 'FISH_NAME_ALREADY_EXISTS');

    const retiredCreate = await unsafe(api().post('/api/v1/admin/catalog/fish'), admin.cookie)
      .send({ name: 'Сайда (спиннинг)' })
      .expect(400);
    assert.equal(readErrorCode(retiredCreate.body as unknown), 'VALIDATION_ERROR');

    const retiredRename = await unsafe(
      api().patch(`/api/v1/admin/catalog/fish/${fish.id}`),
      admin.cookie,
    )
      .send({ name: 'Жерех-лысач (спиннинг)' })
      .expect(400);
    assert.equal(readErrorCode(retiredRename.body as unknown), 'VALIDATION_ERROR');
    assert.equal(
      (await prisma.fish.findUniqueOrThrow({ where: { id: fish.id } })).name,
      'БЕЛЫЙ   АМУР',
    );

    await unsafe(api().patch(`/api/v1/admin/catalog/fish/${fish.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);
    assert.deepEqual((await api().get('/api/v1/catalog/fish').expect(200)).body, { items: [] });
    assert.equal(await prisma.fish.count({ where: { id: fish.id, isActive: false } }), 1);
  });

  void test('Bait requires a valid type and its normalized name is unique across types', async () => {
    const admin = await createActor('ADMIN');
    const bait = await createBait(admin.cookie, '  МОТЫЛЬ  ', 'BAIT');
    const lure = await createBait(admin.cookie, 'Блесна', 'LURE');
    const stored = await prisma.bait.findUniqueOrThrow({ where: { id: bait.id } });
    assert.equal(stored.nameNormalized, 'мотыль');
    assert.equal(stored.type, 'BAIT');

    const duplicateAcrossType = await unsafe(
      api().post('/api/v1/admin/catalog/baits'),
      admin.cookie,
    )
      .send({ name: 'мотыль', type: 'LURE' })
      .expect(409);
    assert.equal(readErrorCode(duplicateAcrossType.body as unknown), 'BAIT_NAME_ALREADY_EXISTS');

    const invalidType = await unsafe(api().post('/api/v1/admin/catalog/baits'), admin.cookie)
      .send({ name: 'Неизвестная наживка', type: 'UNKNOWN' })
      .expect(400);
    assert.equal(readErrorCode(invalidType.body as unknown), 'VALIDATION_ERROR');

    const adminList = await api()
      .get('/api/v1/admin/catalog/baits?status=all')
      .set('Cookie', admin.cookie)
      .expect(200);
    const items = readItems(adminList.body as unknown);
    assert.equal(items.length, 2);
    assert.deepEqual(
      new Set(items.map((item) => asString(item.type, 'bait.type'))),
      new Set(['BAIT', 'LURE']),
    );
    assert.equal(lure.name, 'Блесна');
  });

  void test('ScreenAnchor public/admin APIs normalize names and preserve inactive rows', async () => {
    const admin = await createActor('ADMIN');
    const created = await unsafe(api().post('/api/v1/admin/catalog/screen-anchors'), admin.cookie)
      .send({ name: '  Удочка  ' })
      .expect(201);
    const anchor = readEnvelope(created.body as unknown, 'screenAnchor');
    const anchorId = asString(anchor.id, 'screenAnchor.id');

    assert.equal(
      (await prisma.screenAnchor.findUniqueOrThrow({ where: { id: anchorId } })).nameNormalized,
      'удочка',
    );
    assert.deepEqual((await api().get('/api/v1/catalog/screen-anchors').expect(200)).body, {
      items: [{ id: anchorId, name: 'Удочка' }],
    });

    const duplicate = await unsafe(api().post('/api/v1/admin/catalog/screen-anchors'), admin.cookie)
      .send({ name: 'УДОЧКА' })
      .expect(409);
    assert.equal(readErrorCode(duplicate.body as unknown), 'SCREEN_ANCHOR_NAME_ALREADY_EXISTS');

    await unsafe(api().patch(`/api/v1/admin/catalog/screen-anchors/${anchorId}`), admin.cookie)
      .send({ name: 'События', isActive: false })
      .expect(200);
    assert.deepEqual((await api().get('/api/v1/catalog/screen-anchors').expect(200)).body, {
      items: [],
    });
    const inactive = await api()
      .get('/api/v1/admin/catalog/screen-anchors?status=inactive')
      .set('Cookie', admin.cookie)
      .expect(200);
    assert.equal(readItems(inactive.body as unknown).length, 1);
  });

  void test('FishingBaseFish add/remove enforces active participants and is shared by all Base Locations', async () => {
    const admin = await createActor('ADMIN');
    const base = await createBase(admin.cookie, 'База связей');
    const firstLocation = await createLocation(admin.cookie, base.id, 1, 'Первая локация');
    await createLocation(admin.cookie, base.id, 2, 'Вторая локация');
    const firstFish = await createFish(admin.cookie, 'Первая рыба');
    const secondFish = await createFish(admin.cookie, 'Вторая рыба');
    const thirdFish = await createFish(admin.cookie, 'Третья рыба');

    const relation = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`),
      admin.cookie,
    )
      .send({ fishId: firstFish.id })
      .expect(201);
    const relationBody = readEnvelope(relation.body as unknown, 'fishingBaseFish');
    assert.deepEqual(Object.keys(relationBody).sort(), ['createdAt', 'fishId', 'fishingBaseId']);
    assert.equal(asString(relationBody.fishingBaseId, 'fishingBaseId'), base.id);
    assert.equal(asString(relationBody.fishId, 'fishId'), firstFish.id);
    assert.equal(await prisma.fishingBaseFish.count(), 1);

    const publicBase = await api().get(`/api/v1/catalog/bases/${base.id}`).expect(200);
    const publicBaseBody = readEnvelope(publicBase.body as unknown, 'base');
    assert.equal(asArray(publicBaseBody.locations).length, 2);
    assert.deepEqual(publicBaseBody.fish, [{ id: firstFish.id, name: firstFish.name }]);
    const publicLocation = await api()
      .get(`/api/v1/catalog/locations/${firstLocation.id}`)
      .expect(200);
    assert.equal('fish' in readEnvelope(publicLocation.body as unknown, 'location'), false);

    const duplicate = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`),
      admin.cookie,
    )
      .send({ fishId: firstFish.id })
      .expect(409);
    assert.equal(readErrorCode(duplicate.body as unknown), 'FISHING_BASE_FISH_ALREADY_EXISTS');

    await unsafe(api().patch(`/api/v1/admin/catalog/fish/${firstFish.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);
    assert.equal(await prisma.fishingBaseFish.count(), 1);
    const hiddenFromPublicBase = await api().get(`/api/v1/catalog/bases/${base.id}`).expect(200);
    assert.deepEqual(readEnvelope(hiddenFromPublicBase.body as unknown, 'base').fish, []);
    const adminBase = await api()
      .get(`/api/v1/admin/catalog/bases/${base.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    assert.equal(asArray(readEnvelope(adminBase.body as unknown, 'base').fish).length, 1);

    const inactiveFish = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`),
      admin.cookie,
    )
      .send({ fishId: firstFish.id })
      .expect(409);
    assert.equal(readErrorCode(inactiveFish.body as unknown), 'FISH_INACTIVE');

    await unsafe(
      api().delete(`/api/v1/admin/catalog/bases/${base.id}/fish/${firstFish.id}`),
      admin.cookie,
    ).expect(204);
    assert.equal(await prisma.fishingBaseFish.count(), 0);

    const missingRelation = await unsafe(
      api().delete(`/api/v1/admin/catalog/bases/${base.id}/fish/${firstFish.id}`),
      admin.cookie,
    ).expect(404);
    assert.equal(readErrorCode(missingRelation.body as unknown), 'FISHING_BASE_FISH_NOT_FOUND');

    await unsafe(api().patch(`/api/v1/admin/catalog/fish/${firstFish.id}`), admin.cookie)
      .send({ isActive: true })
      .expect(200);
    await unsafe(api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`), admin.cookie)
      .send({ fishId: firstFish.id })
      .expect(201);
    await unsafe(api().patch(`/api/v1/admin/catalog/locations/${firstLocation.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);
    assert.equal(await prisma.fishingBaseFish.count(), 1);
    await unsafe(api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`), admin.cookie)
      .send({ fishId: secondFish.id })
      .expect(201);

    await unsafe(api().patch(`/api/v1/admin/catalog/locations/${firstLocation.id}`), admin.cookie)
      .send({ isActive: true })
      .expect(200);
    await unsafe(api().patch(`/api/v1/admin/catalog/bases/${base.id}`), admin.cookie)
      .send({ isActive: false })
      .expect(200);
    const inactiveBase = await unsafe(
      api().post(`/api/v1/admin/catalog/bases/${base.id}/fish`),
      admin.cookie,
    )
      .send({ fishId: thirdFish.id })
      .expect(409);
    assert.equal(readErrorCode(inactiveBase.body as unknown), 'FISHING_BASE_INACTIVE');
  });

  void test('PostgreSQL enforces FishingBaseFish composite identity and foreign keys', async () => {
    const base = await prisma.fishingBase.create({
      data: { name: 'DB база', nameNormalized: 'db база' },
    });
    const fish = await prisma.fish.create({
      data: { name: 'DB рыба', nameNormalized: 'db рыба' },
    });
    await prisma.fishingBaseFish.create({
      data: { fishingBaseId: base.id, fishId: fish.id },
    });

    await assert.rejects(
      prisma.fishingBaseFish.create({
        data: { fishingBaseId: base.id, fishId: fish.id },
      }),
      (error: unknown) => prismaErrorCode(error) === 'P2002',
    );
    await assert.rejects(
      prisma.fishingBaseFish.create({
        data: { fishingBaseId: base.id, fishId: randomUUID() },
      }),
      (error: unknown) => prismaErrorCode(error) === 'P2003',
    );
    await assert.rejects(
      prisma.fish.delete({ where: { id: fish.id } }),
      (error: unknown) => prismaErrorCode(error) === 'P2003',
    );
    assert.equal(await prisma.fishingBaseFish.count(), 1);
  });

  void test('credentialed CORS advertises PATCH and DELETE for the admin API', async () => {
    const response = await api()
      .options(`/api/v1/admin/catalog/bases/${randomUUID()}`)
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'PATCH')
      .expect(204)
      .expect('Access-Control-Allow-Origin', WEB_ORIGIN)
      .expect('Access-Control-Allow-Credentials', 'true');
    const methods = asString(response.headers['access-control-allow-methods'], 'allow-methods');

    assert.match(methods, /PATCH/);
    assert.match(methods, /DELETE/);
  });
});
