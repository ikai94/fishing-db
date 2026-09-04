import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnvironmentFile } from 'dotenv';
import request from 'supertest';
import { after, before, beforeEach, describe, test } from 'node:test';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const WEB_ORIGIN = 'http://localhost:3000';
const PASSWORD = 'correct horse battery staple';

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

type PrismaServiceInstance = import('../src/prisma/prisma.service.js').PrismaService;

let app: INestApplication | undefined;
let httpServer: Server;
let prisma: PrismaServiceInstance;
let configuration: TestDatabaseConfiguration;

function api() {
  return request(httpServer);
}

function mutation(testRequest: ReturnType<ReturnType<typeof request>['post']>, cookie?: string) {
  testRequest.set('Origin', WEB_ORIGIN);
  if (cookie !== undefined) testRequest.set('Cookie', cookie);
  return testRequest;
}

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function asString(value: unknown): string {
  assert.equal(typeof value, 'string');
  return value as string;
}

function cookie(response: { headers: Record<string, unknown> }): string {
  const value = response.headers['set-cookie'];
  const candidates: unknown[] = Array.isArray(value) ? value : [value];
  const header = candidates.find((item): item is string => typeof item === 'string');
  assert.ok(header);
  const pair = header.split(';', 1)[0];
  assert.ok(pair);
  return pair;
}

async function register(email: string, nickname: string) {
  const response = await mutation(api().post('/api/v1/auth/register'))
    .send({ email, nickname, password: PASSWORD })
    .expect(201);
  return { cookie: cookie(response), userId: asString(asObject(asObject(response.body).user).id) };
}

async function clearDatabase(): Promise<void> {
  await clearTestData(configuration, {
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
}

void describe('Activity API (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    configuration = getTestDatabaseConfiguration(process.env);
    process.env.DATABASE_URL = configuration.testDatabaseUrl;
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
  });

  void beforeEach(clearDatabase);

  void after(async () => {
    try {
      await clearDatabase();
    } finally {
      await app?.close();
    }
  });

  void test('publishes committed report and ADMIN catalog actions with cursor privacy boundaries', async () => {
    const admin = await register('activity-admin@example.ru', 'Private Admin');
    const angler = await register('activity-user@example.ru', 'Рыбак');
    await prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });

    const empty = await api().get('/api/v1/activity').expect(200);
    assert.deepEqual(empty.body, { items: [], nextCursor: null });

    const baseResponse = await mutation(api().post('/api/v1/admin/catalog/bases'), admin.cookie)
      .send({ name: 'Амур' })
      .expect(201);
    const baseId = asString(asObject(asObject(baseResponse.body).base).id);
    const locationResponse = await mutation(
      api().post(`/api/v1/admin/catalog/bases/${baseId}/locations`),
      admin.cookie,
    )
      .send({ number: 7, name: 'Протока' })
      .expect(201);
    const locationId = asString(asObject(asObject(locationResponse.body).location).id);
    const fishResponse = await mutation(api().post('/api/v1/admin/catalog/fish'), admin.cookie)
      .send({ name: 'Кижуч' })
      .expect(201);
    const fishId = asString(asObject(asObject(fishResponse.body).fish).id);
    const baitResponse = await mutation(api().post('/api/v1/admin/catalog/baits'), admin.cookie)
      .send({ name: 'Мотыль', type: 'BAIT' })
      .expect(201);
    const baitId = asString(asObject(asObject(baitResponse.body).bait).id);

    await mutation(api().post(`/api/v1/admin/catalog/bases/${baseId}/fish`), admin.cookie)
      .send({ fishId })
      .expect(201);
    await mutation(
      api().patch(`/api/v1/admin/catalog/bases/${baseId}/fish/${fishId}`),
      admin.cookie,
    )
      .send({ minWeightGrams: 100, maxWeightGrams: 2_000 })
      .expect(200);
    await mutation(api().patch(`/api/v1/admin/catalog/bases/${baseId}`), admin.cookie)
      .send({ name: 'Амурская база' })
      .expect(200);
    await mutation(api().post('/api/v1/admin/catalog/screen-anchors'), admin.cookie)
      .send({ name: 'Рюкзак' })
      .expect(201);

    const reportInput = { locationId, fishId, baitId, weightGrams: 950, rawSourceText: 'private' };
    const createResponse = await mutation(api().post('/api/v1/catch-reports'), angler.cookie)
      .send(reportInput)
      .expect(201);
    const reportId = asString(asObject(asObject(createResponse.body).report).id);
    await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), angler.cookie)
      .send({ weightGrams: 1_000, userNoteRaw: 'also public elsewhere but omitted here' })
      .expect(200);
    const eventCountBeforeNoop = await prisma.activityEvent.count();
    await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), angler.cookie)
      .send({ weightGrams: 1_000 })
      .expect(200);
    assert.equal(await prisma.activityEvent.count(), eventCountBeforeNoop);
    await mutation(api().delete(`/api/v1/catch-reports/${reportId}`), angler.cookie).expect(204);
    await mutation(api().post('/api/v1/catch-reports/batch'), angler.cookie)
      .send({
        reports: [
          { ...reportInput, rawSourceText: undefined },
          { ...reportInput, weightGrams: 1_050, rawSourceText: undefined },
        ],
      })
      .expect(201);
    await mutation(
      api().delete(`/api/v1/admin/catalog/bases/${baseId}/fish/${fishId}`),
      admin.cookie,
    ).expect(204);

    const firstPage = await api().get('/api/v1/activity').query({ limit: 3 }).expect(200);
    const firstItems = asArray(asObject(firstPage.body).items).map(asObject);
    assert.deepEqual(
      firstItems.map((item) => item.type),
      ['FISHING_BASE_FISH_REMOVED', 'CATCH_REPORT_BATCH_CREATED', 'CATCH_REPORT_DELETED'],
    );
    const serialized = JSON.stringify(firstPage.body);
    assert.equal(serialized.includes('Private Admin'), false);
    assert.equal(serialized.includes('actorUserId'), false);
    assert.equal(serialized.includes('rawSourceText'), false);
    assert.equal(serialized.includes('userNoteRaw'), false);
    assert.deepEqual(firstItems[0]?.actor, { kind: 'ADMINISTRATION' });
    assert.deepEqual(firstItems[2]?.actor, { kind: 'ANGLER', nickname: 'Рыбак' });

    const cursorValue = asString(asObject(firstPage.body).nextCursor);
    const secondPage = await api()
      .get('/api/v1/activity')
      .query({ limit: 20, cursor: cursorValue })
      .expect(200);
    const secondItems = asArray(asObject(secondPage.body).items).map(asObject);
    assert.equal(secondItems.length, 9);
    assert.equal(asObject(secondPage.body).nextCursor, null);
    assert.ok(secondItems.some((item) => item.type === 'CATCH_REPORT_UPDATED'));
    assert.ok(secondItems.some((item) => item.type === 'CATCH_REPORT_CREATED'));
    assert.ok(secondItems.some((item) => item.type === 'CATALOG_ITEM_UPDATED'));
    assert.ok(secondItems.some((item) => item.type === 'CATALOG_ITEM_CREATED'));
    assert.ok(secondItems.some((item) => item.type === 'FISHING_BASE_FISH_UPDATED'));
    assert.ok(secondItems.some((item) => item.type === 'FISHING_BASE_FISH_ADDED'));
    const firstIds = new Set(firstItems.map((item) => item.id));
    assert.ok(secondItems.every((item) => !firstIds.has(item.id)));

    const storedPayloads = await prisma.activityEvent.findMany({ select: { payload: true } });
    const storedSerialized = JSON.stringify(storedPayloads);
    assert.equal(storedSerialized.includes('private'), false);
    assert.equal(storedSerialized.includes('also public elsewhere'), false);
    assert.equal(storedSerialized.includes('contributorKey'), false);
    assert.equal(storedSerialized.includes('importKey'), false);

    await assert.rejects(
      prisma.activityEvent.updateMany({ data: { subjectKey: 'changed' } }),
      /ActivityEvent is append-only/u,
    );
    await assert.rejects(prisma.activityEvent.deleteMany(), /ActivityEvent is append-only/u);
  });

  void test('rejects invalid public cursors', async () => {
    const response = await api().get('/api/v1/activity').query({ cursor: 'invalid+' }).expect(400);
    assert.equal(asObject(response.body).code, 'ACTIVITY_CURSOR_INVALID');
  });
});
