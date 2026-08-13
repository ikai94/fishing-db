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
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

type PrismaServiceInstance = import('../src/prisma/prisma.service.js').PrismaService;
type HttpTest = ReturnType<ReturnType<typeof request>['post']>;

interface AuthenticatedActor {
  cookie: string;
  email: string;
  nickname: string;
  userId: string;
}

interface CatalogEntity {
  id: string;
  name: string;
}

interface CatalogLocation extends CatalogEntity {
  fishingBaseId: string;
  number: number;
}

interface CatalogFixture {
  base: CatalogEntity;
  location: CatalogLocation;
  fish: CatalogEntity;
  bait: CatalogEntity & { type: 'BAIT' | 'LURE' };
}

interface CreateCatalogOptions {
  baseActive?: boolean;
  locationActive?: boolean;
  fishActive?: boolean;
  baitActive?: boolean;
  baitType?: 'BAIT' | 'LURE';
  withFishingBaseFish?: boolean;
}

interface CatchReportInput {
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  holeDepthCm?: number | null;
  spotPositionRaw?: string | null;
  fishingNote?: string | null;
  spinningSize?: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed?: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  userNoteRaw?: string | null;
  rawSourceText?: string | null;
}

const originalRuntimeEnvironment = {
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

let actorSequence = 0;
let catalogSequence = 0;
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

function mutation(httpTest: HttpTest, cookie?: string): HttpTest {
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

function readErrorCode(body: unknown): string {
  return asString(asObject(body).code, 'code');
}

function readReport(body: unknown): Record<string, unknown> {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['report']);
  return asObject(payload.report);
}

function readReportList(body: unknown): {
  items: Record<string, unknown>[];
  nextCursor: string | null;
} {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload).sort(), ['items', 'nextCursor']);
  const nextCursor = payload.nextCursor;

  assert.ok(nextCursor === null || typeof nextCursor === 'string');

  return {
    items: asArray(payload.items).map((item) => asObject(item)),
    nextCursor,
  };
}

function assertPublicReportProjection(report: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(report).sort(), [
    'author',
    'bait',
    'createdAt',
    'fish',
    'fishingBase',
    'fishingMethod',
    'fishingNote',
    'holeDepthCm',
    'id',
    'location',
    'spinningSize',
    'spinningSpeed',
    'spotPositionRaw',
    'updatedAt',
    'userNoteRaw',
    'weightGrams',
  ]);
  assert.deepEqual(Object.keys(asObject(report.author)).sort(), ['id', 'nickname']);
  assert.deepEqual(Object.keys(asObject(report.fishingBase)).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(asObject(report.location)).sort(), ['id', 'name', 'number']);
  assert.deepEqual(Object.keys(asObject(report.fish)).sort(), ['id', 'name']);
  assert.deepEqual(Object.keys(asObject(report.bait)).sort(), ['id', 'name']);

  const serialized = JSON.stringify(report);
  for (const forbiddenField of [
    'email',
    'passwordHash',
    'nicknameNormalized',
    'role',
    'isBanned',
    'nameNormalized',
    'tokenHash',
    'sessions',
    'rawSourceText',
  ]) {
    assert.equal(serialized.includes(`"${forbiddenField}"`), false);
  }
}

function assertOwnerReportProjection(report: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(report).sort(), [
    'author',
    'bait',
    'createdAt',
    'fish',
    'fishingBase',
    'fishingMethod',
    'fishingNote',
    'holeDepthCm',
    'id',
    'location',
    'rawSourceText',
    'spinningSize',
    'spinningSpeed',
    'spotPositionRaw',
    'updatedAt',
    'userNoteRaw',
    'weightGrams',
  ]);

  const publicFields = { ...report };
  delete publicFields.rawSourceText;
  assertPublicReportProjection(publicFields);
}

function publicPartOfOwnerReport(report: Record<string, unknown>): Record<string, unknown> {
  const publicFields = { ...report };
  delete publicFields.rawSourceText;
  return publicFields;
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

async function createActor(
  role: 'USER' | 'ADMIN' = 'USER',
  isBanned = false,
): Promise<AuthenticatedActor> {
  actorSequence += 1;
  const email = `catch-actor-${actorSequence}@example.ru`;
  const nickname = `Catch Actor ${actorSequence}`;
  const registration = await mutation(api().post('/api/v1/auth/register'))
    .send({ email, nickname, password: PASSWORD })
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
    nickname,
    userId: user.id,
  };
}

async function createCatalog(options: CreateCatalogOptions = {}): Promise<CatalogFixture> {
  catalogSequence += 1;
  const suffix = catalogSequence;
  const base = await prisma.fishingBase.create({
    data: {
      name: `Catch Base ${suffix}`,
      nameNormalized: `catch base ${suffix}`,
      isActive: options.baseActive ?? true,
    },
  });
  const location = await prisma.location.create({
    data: {
      fishingBaseId: base.id,
      number: 1,
      name: `Catch Location ${suffix}`,
      nameNormalized: `catch location ${suffix}`,
      isActive: options.locationActive ?? true,
    },
  });
  const fish = await prisma.fish.create({
    data: {
      name: `Catch Fish ${suffix}`,
      nameNormalized: `catch fish ${suffix}`,
      isActive: options.fishActive ?? true,
    },
  });
  const bait = await prisma.bait.create({
    data: {
      name: `Catch Bait ${suffix}`,
      nameNormalized: `catch bait ${suffix}`,
      type: options.baitType ?? 'BAIT',
      isActive: options.baitActive ?? true,
    },
  });

  if (options.withFishingBaseFish ?? true) {
    await prisma.fishingBaseFish.create({
      data: { fishingBaseId: base.id, fishId: fish.id },
    });
  }

  return {
    base: { id: base.id, name: base.name },
    location: {
      id: location.id,
      fishingBaseId: base.id,
      number: location.number,
      name: location.name,
    },
    fish: { id: fish.id, name: fish.name },
    bait: { id: bait.id, name: bait.name, type: bait.type },
  };
}

async function createBait(type: 'BAIT' | 'LURE'): Promise<CatalogFixture['bait']> {
  catalogSequence += 1;
  const suffix = catalogSequence;
  const bait = await prisma.bait.create({
    data: {
      name: `Catch ${type} ${suffix}`,
      nameNormalized: `catch ${type.toLowerCase()} ${suffix}`,
      type,
    },
  });

  return { id: bait.id, name: bait.name, type: bait.type };
}

function createInput(
  catalog: CatalogFixture,
  overrides: Partial<CatchReportInput> = {},
): CatchReportInput {
  return {
    locationId: catalog.location.id,
    fishId: catalog.fish.id,
    baitId: catalog.bait.id,
    weightGrams: 40,
    holeDepthCm: 600,
    ...overrides,
  };
}

async function createReport(
  actor: AuthenticatedActor,
  catalog: CatalogFixture,
  overrides: Partial<CatchReportInput> = {},
): Promise<Record<string, unknown>> {
  const response = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
    .send(createInput(catalog, overrides))
    .expect(201);

  return readReport(response.body as unknown);
}

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

void describe('CatchReport API (PostgreSQL e2e)', { concurrency: false }, () => {
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

  void test('requires authentication for create and derives owner only from the Session', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();
    const otherActor = await createActor();

    const anonymous = await mutation(api().post('/api/v1/catch-reports'))
      .send(createInput(catalog))
      .expect(401);
    assert.equal(readErrorCode(anonymous.body as unknown), 'AUTH_REQUIRED');

    await prisma.user.update({ where: { id: otherActor.userId }, data: { isBanned: true } });
    const banned = await mutation(api().post('/api/v1/catch-reports'), otherActor.cookie)
      .send(createInput(catalog))
      .expect(403);
    assert.equal(readErrorCode(banned.body as unknown), 'ACCOUNT_BANNED');

    for (const forbiddenData of [
      { userId: otherActor.userId },
      { fishingBaseId: catalog.base.id },
      { fishingMethod: 'SPINNING' },
      { rawSourceText: 'spoofed', unexpected: true },
      { id: randomUUID() },
      { createdAt: new Date(0).toISOString() },
      { updatedAt: new Date(0).toISOString() },
    ]) {
      const forbidden = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
        .send({ ...createInput(catalog), ...forbiddenData })
        .expect(400);
      assert.equal(readErrorCode(forbidden.body as unknown), 'VALIDATION_ERROR');
    }

    assert.equal(await prisma.catchReport.count(), 0);

    const beforeCreate = Date.now();
    const report = await createReport(actor, catalog, {
      weightGrams: 1_240,
      holeDepthCm: 763,
      spotPositionRaw: 'уда-леска надпись нахлыст',
      fishingNote: 'MIDWATER',
      userNoteRaw: '  ямка 7,63 вполводы!  ',
      rawSourceText: '  исходная\nстрока\tточно  ',
    });
    const afterCreate = Date.now();

    assertOwnerReportProjection(report);
    assert.equal(asString(asObject(report.author).id, 'author.id'), actor.userId);
    assert.equal(asString(asObject(report.author).nickname, 'author.nickname'), actor.nickname);
    assert.equal(asString(asObject(report.fishingBase).id, 'fishingBase.id'), catalog.base.id);
    assert.equal(asString(asObject(report.location).id, 'location.id'), catalog.location.id);
    assert.equal(asString(asObject(report.fish).id, 'fish.id'), catalog.fish.id);
    assert.equal(asString(asObject(report.bait).id, 'bait.id'), catalog.bait.id);
    assert.equal(asNumber(report.weightGrams, 'weightGrams'), 1_240);
    assert.equal(asNumber(report.holeDepthCm, 'holeDepthCm'), 763);
    assert.equal(report.fishingMethod, 'BAIT_FISHING');
    assert.equal(report.spotPositionRaw, 'уда-леска надпись нахлыст');
    assert.equal(report.fishingNote, 'MIDWATER');
    assert.equal(report.userNoteRaw, '  ямка 7,63 вполводы!  ');

    const stored = await prisma.catchReport.findUniqueOrThrow({
      where: { id: asString(report.id, 'report.id') },
    });
    assert.equal(stored.userId, actor.userId);
    assert.equal(stored.userId === otherActor.userId, false);
    assert.equal(stored.weightGrams, 1_240);
    assert.equal(stored.holeDepthCm, 763);
    assert.equal(stored.fishingMethod, 'BAIT_FISHING');
    assert.equal(stored.rawSourceText, '  исходная\nстрока\tточно  ');
    assert.equal(stored.userNoteRaw, '  ямка 7,63 вполводы!  ');
    assert.ok(stored.createdAt.getTime() >= beforeCreate);
    assert.ok(stored.createdAt.getTime() <= afterCreate);
  });

  void test('validates integer observations, exact enums and raw-note preservation rules', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();

    const invalidBodies: Record<string, unknown>[] = [
      { ...createInput(catalog), weightGrams: 0 },
      { ...createInput(catalog), weightGrams: -1 },
      { ...createInput(catalog), weightGrams: 1.5 },
      { ...createInput(catalog), weightGrams: MAX_POSTGRES_INTEGER + 1 },
      { ...createInput(catalog), weightGrams: '40' },
      { ...createInput(catalog), holeDepthCm: 0 },
      { ...createInput(catalog), holeDepthCm: -1 },
      { ...createInput(catalog), holeDepthCm: 7.63 },
      { ...createInput(catalog), holeDepthCm: MAX_POSTGRES_INTEGER + 1 },
      { ...createInput(catalog), spotPositionRaw: '   ' },
      { ...createInput(catalog), spotPositionRaw: '\u200b' },
      { ...createInput(catalog), spinningSize: 'HUGE' },
      { ...createInput(catalog), spinningSpeed: 'QUICK' },
      { ...createInput(catalog), fishingNote: 'ROD' },
      { ...createInput(catalog), userNoteRaw: '   ' },
      { ...createInput(catalog), userNoteRaw: '\u200b' },
      { ...createInput(catalog), userNoteRaw: `a${String.fromCharCode(7)}b` },
      { ...createInput(catalog), userNoteRaw: 'a'.repeat(1_001) },
      { ...createInput(catalog), rawSourceText: '\u200b' },
      { ...createInput(catalog), rawSourceText: `a${String.fromCharCode(7)}b` },
      { ...createInput(catalog), rawSourceText: 'a'.repeat(20_001) },
    ];

    for (const body of invalidBodies) {
      const response = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
        .send(body)
        .expect(400);
      assert.equal(readErrorCode(response.body as unknown), 'VALIDATION_ERROR');
    }

    assert.equal(await prisma.catchReport.count(), 0);

    const emptyRaw = await createReport(actor, catalog, {
      spotPositionRaw: null,
      fishingNote: null,
      userNoteRaw: '',
      rawSourceText: '',
    });
    assert.equal(emptyRaw.holeDepthCm, 600);
    assert.equal(emptyRaw.spotPositionRaw, null);
    assert.equal(emptyRaw.fishingNote, null);
    assert.equal(emptyRaw.userNoteRaw, null);

    const exactRaw = `  Ямка   6,00; Удочка?!  `;
    const exact = await createReport(actor, catalog, {
      weightGrams: MAX_POSTGRES_INTEGER,
      holeDepthCm: MAX_POSTGRES_INTEGER,
      spotPositionRaw: 'снасти-чат 2',
      fishingNote: 'SURFACE',
      userNoteRaw: exactRaw,
      rawSourceText: 'A\r\nB\tC',
    });
    assert.equal(exact.userNoteRaw, exactRaw);
    assert.equal(exact.spotPositionRaw, 'снасти-чат 2');
    assert.equal(exact.fishingNote, 'SURFACE');

    const stored = await prisma.catchReport.findUniqueOrThrow({
      where: { id: asString(exact.id, 'report.id') },
    });
    assert.equal(stored.userNoteRaw, exactRaw);
    assert.equal(stored.weightGrams, MAX_POSTGRES_INTEGER);
    assert.equal(stored.holeDepthCm, MAX_POSTGRES_INTEGER);
    assert.equal(stored.rawSourceText, 'A\r\nB\tC');

    const maximumUserNote = 'я'.repeat(1_000);
    const maximumPosition = '🎯'.repeat(1_000);
    const maximumSource = '🎣'.repeat(20_000);
    const maximum = await createReport(actor, catalog, {
      spotPositionRaw: maximumPosition,
      userNoteRaw: maximumUserNote,
      rawSourceText: maximumSource,
    });
    assert.equal(maximum.spotPositionRaw, maximumPosition);
    assert.equal(maximum.userNoteRaw, maximumUserNote);
    assert.equal(maximum.rawSourceText, maximumSource);
  });

  void test('enforces BAIT_FISHING and SPINNING observations when creating reports', async () => {
    const actor = await createActor();
    const baitCatalog = await createCatalog({ baitType: 'BAIT' });

    for (const [body, field] of [
      [createInput(baitCatalog, { holeDepthCm: null }), 'holeDepthCm'],
      [createInput(baitCatalog, { spinningSize: 'SMALL' }), 'spinningSize'],
      [createInput(baitCatalog, { spinningSpeed: 'FAST' }), 'spinningSpeed'],
    ] as const) {
      const response = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
        .send(body)
        .expect(400);
      assert.equal(readErrorCode(response.body as unknown), 'VALIDATION_ERROR');
      assert.ok(field in asObject(asObject(response.body as unknown).errors));
    }

    const baitReport = await createReport(actor, baitCatalog, {
      holeDepthCm: 361,
      spinningSize: null,
      spinningSpeed: null,
    });
    assert.equal(baitReport.fishingMethod, 'BAIT_FISHING');
    assert.equal(baitReport.holeDepthCm, 361);
    assert.equal(baitReport.spinningSize, null);
    assert.equal(baitReport.spinningSpeed, null);

    const spinningCatalog = await createCatalog({ baitType: 'LURE' });
    for (const [overrides, field] of [
      [{ holeDepthCm: null }, 'spinningSize'],
      [{ holeDepthCm: null, spinningSize: 'MEDIUM' as const }, 'spinningSpeed'],
      [{ holeDepthCm: null, spinningSpeed: 'SLOW' as const }, 'spinningSize'],
    ] as const) {
      const response = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
        .send(createInput(spinningCatalog, overrides))
        .expect(400);
      assert.equal(readErrorCode(response.body as unknown), 'VALIDATION_ERROR');
      assert.ok(field in asObject(asObject(response.body as unknown).errors));
    }

    const spinningWithoutHole = await createReport(actor, spinningCatalog, {
      holeDepthCm: null,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
    });
    assert.equal(spinningWithoutHole.fishingMethod, 'SPINNING');
    assert.equal(spinningWithoutHole.holeDepthCm, null);
    assert.equal(spinningWithoutHole.spinningSize, 'MEDIUM');
    assert.equal(spinningWithoutHole.spinningSpeed, 'SLOW');

    const spinningWithHole = await createReport(actor, spinningCatalog, {
      holeDepthCm: 1_078,
      spinningSize: 'LARGE',
      spinningSpeed: 'FAST',
      spotPositionRaw: 'чат',
    });
    assert.equal(spinningWithHole.fishingMethod, 'SPINNING');
    assert.equal(spinningWithHole.holeDepthCm, 1_078);
    assert.equal(spinningWithHole.spinningSize, 'LARGE');
    assert.equal(spinningWithHole.spinningSpeed, 'FAST');
    assert.equal(spinningWithHole.spotPositionRaw, 'чат');
  });

  void test('parses a resolved catalog line and confirms it through the normal POST', async () => {
    const actor = await createActor();
    const catalog = await createCatalog();
    const rawSourceText = `${catalog.fish.name} 40 грамм. Поймана на ${catalog.base.name}: ${catalog.location.name}, ${catalog.bait.name}. ямка 6,00 удочка`;
    const reportsBeforeParse = await prisma.catchReport.count();

    const previewResponse = await mutation(api().post('/api/v1/catch-reports/parse'), actor.cookie)
      .send({ rawSourceText })
      .expect(200);
    const draft = asObject(asObject(previewResponse.body as unknown).draft);
    const fields = asObject(draft.fields);
    const field = (name: string) => asObject(fields[name]);
    const itemId = (name: string) => asString(asObject(field(name).value).id, `${name}.id`);

    assert.equal(draft.rawSourceText, rawSourceText);
    assert.equal(draft.canConfirm, true);
    assert.equal(await prisma.catchReport.count(), reportsBeforeParse);

    const created = readReport(
      (
        await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
          .send({
            locationId: itemId('location'),
            fishId: itemId('fish'),
            baitId: itemId('bait'),
            weightGrams: asNumber(field('weightGrams').value, 'weightGrams'),
            holeDepthCm: asNumber(field('holeDepthCm').value, 'holeDepthCm'),
            spotPositionRaw: field('spotPositionRaw').value,
            fishingNote: field('fishingNote').value,
            spinningSize: field('spinningSize').value,
            spinningSpeed: field('spinningSpeed').value,
            userNoteRaw: field('userNoteRaw').value,
            rawSourceText: draft.rawSourceText,
          })
          .expect(201)
      ).body as unknown,
    );

    assert.equal(created.rawSourceText, rawSourceText);
    assert.equal(created.fishingMethod, 'BAIT_FISHING');
    assert.equal(await prisma.catchReport.count(), reportsBeforeParse + 1);
  });

  void test('validates current catalog state and FishingBaseFish before creation', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();

    const missingLocation = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog, { locationId: randomUUID() }))
      .expect(404);
    assert.equal(readErrorCode(missingLocation.body as unknown), 'LOCATION_NOT_FOUND');

    await prisma.fishingBase.update({
      where: { id: catalog.base.id },
      data: { isActive: false },
    });
    await prisma.location.update({
      where: { id: catalog.location.id },
      data: { isActive: false },
    });
    const inactiveBase = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(409);
    assert.equal(readErrorCode(inactiveBase.body as unknown), 'FISHING_BASE_INACTIVE');

    await prisma.fishingBase.update({
      where: { id: catalog.base.id },
      data: { isActive: true },
    });
    const inactiveLocation = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(409);
    assert.equal(readErrorCode(inactiveLocation.body as unknown), 'LOCATION_INACTIVE');
    await prisma.location.update({
      where: { id: catalog.location.id },
      data: { isActive: true },
    });

    const missingFish = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog, { fishId: randomUUID() }))
      .expect(404);
    assert.equal(readErrorCode(missingFish.body as unknown), 'FISH_NOT_FOUND');

    await prisma.fish.update({ where: { id: catalog.fish.id }, data: { isActive: false } });
    const inactiveFish = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(409);
    assert.equal(readErrorCode(inactiveFish.body as unknown), 'FISH_INACTIVE');
    await prisma.fish.update({ where: { id: catalog.fish.id }, data: { isActive: true } });

    const missingBait = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog, { baitId: randomUUID() }))
      .expect(404);
    assert.equal(readErrorCode(missingBait.body as unknown), 'BAIT_NOT_FOUND');

    await prisma.bait.update({ where: { id: catalog.bait.id }, data: { isActive: false } });
    const inactiveBait = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(409);
    assert.equal(readErrorCode(inactiveBait.body as unknown), 'BAIT_INACTIVE');
    await prisma.bait.update({ where: { id: catalog.bait.id }, data: { isActive: true } });

    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: { fishingBaseId: catalog.base.id, fishId: catalog.fish.id },
      },
    });
    const missingPair = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(409);
    assert.equal(readErrorCode(missingPair.body as unknown), 'FISH_NOT_AVAILABLE_AT_FISHING_BASE');
    assert.equal(await prisma.catchReport.count(), 0);
  });

  void test('treats Fish membership as Base-level across all Locations of that Base', async () => {
    const catalog = await createCatalog();
    const otherCatalog = await createCatalog();
    const actor = await createActor();
    const secondLocation = await prisma.location.create({
      data: {
        fishingBaseId: catalog.base.id,
        number: 2,
        name: `Second ${catalog.location.name}`,
        nameNormalized: `second ${catalog.location.name.toLowerCase()}`,
      },
    });

    assert.equal(
      await prisma.fishingBaseFish.count({
        where: { fishingBaseId: catalog.base.id, fishId: catalog.fish.id },
      }),
      1,
    );

    const secondLocationReport = await createReport(actor, catalog, {
      locationId: secondLocation.id,
    });
    assert.equal(
      asString(asObject(secondLocationReport.location).id, 'location.id'),
      secondLocation.id,
    );
    assert.equal(asString(asObject(secondLocationReport.fish).id, 'fish.id'), catalog.fish.id);

    const wrongBase = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(
        createInput(otherCatalog, {
          fishId: catalog.fish.id,
        }),
      )
      .expect(409);
    assert.equal(readErrorCode(wrongBase.body as unknown), 'FISH_NOT_AVAILABLE_AT_FISHING_BASE');

    await prisma.fishingBaseFish.create({
      data: { fishingBaseId: otherCatalog.base.id, fishId: catalog.fish.id },
    });
    const linkedOtherBase = await createReport(actor, otherCatalog, {
      fishId: catalog.fish.id,
    });
    assert.equal(
      asString(asObject(linkedOtherBase.fishingBase).id, 'fishingBase.id'),
      otherCatalog.base.id,
    );
    assert.equal(asString(asObject(linkedOtherBase.fish).id, 'fish.id'), catalog.fish.id);
  });

  void test('allows anonymous safe reads and preserves historical reports after catalog changes', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();
    const otherActor = await createActor();
    const created = await createReport(actor, catalog, {
      weightGrams: 815,
      holeDepthCm: 600,
      spotPositionRaw: 'блокнот',
      fishingNote: 'FROM_BOTTOM',
      userNoteRaw: 'ямка 6,00 блокнот, со дна',
      rawSourceText: 'точный исходник\nвторая строка',
    });
    const reportId = asString(created.id, 'report.id');

    const detail = await api().get(`/api/v1/catch-reports/${reportId}`).expect(200);
    const detailReport = readReport(detail.body as unknown);
    assertPublicReportProjection(detailReport);
    assert.deepEqual(detailReport, publicPartOfOwnerReport(created));

    const listResponse = await api().get('/api/v1/catch-reports').expect(200);
    const publicList = readReportList(listResponse.body as unknown);
    assert.equal(publicList.items.length, 1);
    assert.equal(publicList.nextCursor, null);
    assert.deepEqual(publicList.items[0], publicPartOfOwnerReport(created));

    const ownerDetail = readReport(
      (
        await api()
          .get(`/api/v1/me/catch-reports/${reportId}`)
          .set('Cookie', actor.cookie)
          .expect(200)
      ).body as unknown,
    );
    assertOwnerReportProjection(ownerDetail);
    assert.equal(ownerDetail.rawSourceText, 'точный исходник\nвторая строка');

    const authenticatedPublicDetail = readReport(
      (await api().get(`/api/v1/catch-reports/${reportId}`).set('Cookie', actor.cookie).expect(200))
        .body as unknown,
    );
    assertPublicReportProjection(authenticatedPublicDetail);
    assert.deepEqual(authenticatedPublicDetail, publicPartOfOwnerReport(created));

    const otherOwnerDetail = await api()
      .get(`/api/v1/me/catch-reports/${reportId}`)
      .set('Cookie', otherActor.cookie)
      .expect(404);
    assert.equal(readErrorCode(otherOwnerDetail.body as unknown), 'CATCH_REPORT_NOT_FOUND');

    const ownerList = readReportList(
      (await api().get('/api/v1/me/catch-reports').set('Cookie', actor.cookie).expect(200))
        .body as unknown,
    );
    assert.equal(ownerList.items.length, 1);
    assertPublicReportProjection(ownerList.items[0] ?? {});
    const otherOwnerList = readReportList(
      (await api().get('/api/v1/me/catch-reports').set('Cookie', otherActor.cookie).expect(200))
        .body as unknown,
    );
    assert.deepEqual(otherOwnerList.items, []);

    const malformed = await api().get('/api/v1/catch-reports/not-a-uuid').expect(400);
    assert.equal(readErrorCode(malformed.body as unknown), 'VALIDATION_ERROR');
    const missing = await api().get(`/api/v1/catch-reports/${randomUUID()}`).expect(404);
    assert.equal(readErrorCode(missing.body as unknown), 'CATCH_REPORT_NOT_FOUND');

    await prisma.fishingBase.update({
      where: { id: catalog.base.id },
      data: { isActive: false },
    });
    await prisma.location.update({
      where: { id: catalog.location.id },
      data: { isActive: false },
    });
    await prisma.fish.update({ where: { id: catalog.fish.id }, data: { isActive: false } });
    await prisma.bait.update({ where: { id: catalog.bait.id }, data: { isActive: false } });
    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: { fishingBaseId: catalog.base.id, fishId: catalog.fish.id },
      },
    });
    await prisma.user.update({ where: { id: actor.userId }, data: { isBanned: true } });

    const historicalDetail = readReport(
      (await api().get(`/api/v1/catch-reports/${reportId}`).expect(200)).body as unknown,
    );
    assert.deepEqual(historicalDetail, publicPartOfOwnerReport(created));
    const historicalPublicList = readReportList(
      (await api().get('/api/v1/catch-reports').expect(200)).body as unknown,
    );
    assert.equal(asString(historicalPublicList.items[0]?.id, 'report.id'), reportId);

    const myList = readReportList(
      (await api().get('/api/v1/me/catch-reports').set('Cookie', actor.cookie).expect(200))
        .body as unknown,
    );
    assert.equal(asString(myList.items[0]?.id, 'report.id'), reportId);

    const reportsBeforeParse = await prisma.catchReport.count();
    const rawParseSource =
      'Неизвестная рыба 40 грамм. Поймана на Неизвестной базе: Неизвестная локация, Неизвестная наживка.';
    const anonymousParse = await mutation(api().post('/api/v1/catch-reports/parse'))
      .send({ rawSourceText: rawParseSource })
      .expect(401);
    assert.equal(readErrorCode(anonymousParse.body as unknown), 'AUTH_REQUIRED');
    const bannedParse = await mutation(api().post('/api/v1/catch-reports/parse'), actor.cookie)
      .send({ rawSourceText: rawParseSource })
      .expect(200);
    const parsedDraft = asObject(asObject(bannedParse.body as unknown).draft);
    assert.equal(parsedDraft.rawSourceText, rawParseSource);
    assert.equal(await prisma.catchReport.count(), reportsBeforeParse);

    const bannedCreate = await mutation(api().post('/api/v1/catch-reports'), actor.cookie)
      .send(createInput(catalog))
      .expect(403);
    assert.equal(readErrorCode(bannedCreate.body as unknown), 'ACCOUNT_BANNED');

    const bannedUpdate = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      actor.cookie,
    )
      .send({ weightGrams: 900 })
      .expect(403);
    assert.equal(readErrorCode(bannedUpdate.body as unknown), 'ACCOUNT_BANNED');
    const bannedDelete = await mutation(
      api().delete(`/api/v1/catch-reports/${reportId}`),
      actor.cookie,
    ).expect(403);
    assert.equal(readErrorCode(bannedDelete.body as unknown), 'ACCOUNT_BANNED');

    await prisma.user.update({ where: { id: actor.userId }, data: { isBanned: false } });
    const historicalUpdate = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      actor.cookie,
    )
      .send({
        locationId: catalog.location.id,
        fishId: catalog.fish.id,
        baitId: catalog.bait.id,
        weightGrams: 900,
        holeDepthCm: 700,
        spotPositionRaw: null,
        fishingNote: 'SURFACE',
        userNoteRaw: '',
      })
      .expect(200);
    const updated = readReport(historicalUpdate.body as unknown);
    assert.equal(updated.weightGrams, 900);
    assert.equal(updated.holeDepthCm, 700);
    assert.equal(updated.spotPositionRaw, null);
    assert.equal(updated.fishingNote, 'SURFACE');
    assert.equal(updated.userNoteRaw, null);
  });

  void test('enforces ownership before update validation and hard-deletes only the report', async () => {
    const catalog = await createCatalog();
    const owner = await createActor();
    const other = await createActor();
    const created = await createReport(owner, catalog, { rawSourceText: 'исходник' });
    const reportId = asString(created.id, 'report.id');
    const createdAt = Date.parse(asString(created.createdAt, 'createdAt'));
    const originalUpdatedAt = Date.parse(asString(created.updatedAt, 'updatedAt'));

    const empty = await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
      .send({})
      .expect(400);
    assert.equal(readErrorCode(empty.body as unknown), 'VALIDATION_ERROR');

    const immutableRawSource = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ rawSourceText: 'подмена исходника' })
      .expect(400);
    assert.equal(readErrorCode(immutableRawSource.body as unknown), 'VALIDATION_ERROR');
    assert.equal(
      (
        await prisma.catchReport.findUniqueOrThrow({
          where: { id: reportId },
          select: { rawSourceText: true },
        })
      ).rawSourceText,
      'исходник',
    );

    const otherUpdate = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      other.cookie,
    )
      .send({ baitId: randomUUID() })
      .expect(403);
    assert.equal(readErrorCode(otherUpdate.body as unknown), 'CATCH_REPORT_NOT_OWNED');

    const otherDelete = await mutation(
      api().delete(`/api/v1/catch-reports/${reportId}`),
      other.cookie,
    ).expect(403);
    assert.equal(readErrorCode(otherDelete.body as unknown), 'CATCH_REPORT_NOT_OWNED');

    await new Promise((resolve) => setTimeout(resolve, 5));
    const ownerUpdate = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ weightGrams: 41, userNoteRaw: 'изменено' })
      .expect(200);
    const updated = readReport(ownerUpdate.body as unknown);
    const updatedAt = Date.parse(asString(updated.updatedAt, 'updatedAt'));
    assert.equal(updated.weightGrams, 41);
    assert.equal(updated.userNoteRaw, 'изменено');
    assert.equal(Date.parse(asString(updated.createdAt, 'createdAt')), createdAt);
    assert.ok(updatedAt > originalUpdatedAt);

    await mutation(api().delete(`/api/v1/catch-reports/${reportId}`), owner.cookie).expect(204);
    assert.equal(await prisma.catchReport.count(), 0);
    assert.equal(await prisma.user.count(), 2);
    assert.equal(await prisma.fishingBase.count(), 1);
    assert.equal(await prisma.location.count(), 1);
    assert.equal(await prisma.fish.count(), 1);
    assert.equal(await prisma.bait.count(), 1);
    assert.equal(await prisma.fishingBaseFish.count(), 1);

    const missing = await api().get(`/api/v1/catch-reports/${reportId}`).expect(404);
    assert.equal(readErrorCode(missing.body as unknown), 'CATCH_REPORT_NOT_FOUND');
  });

  void test('revalidates only actually changed catalog references against the resulting pair', async () => {
    const catalog = await createCatalog();
    const owner = await createActor();
    const other = await createActor();
    const created = await createReport(owner, catalog);
    const reportId = asString(created.id, 'report.id');

    catalogSequence += 1;
    const suffix = catalogSequence;
    const activeBait = await prisma.bait.create({
      data: {
        name: `Replacement Bait ${suffix}`,
        nameNormalized: `replacement bait ${suffix}`,
        type: 'LURE',
      },
    });
    const inactiveBait = await prisma.bait.create({
      data: {
        name: `Inactive Bait ${suffix}`,
        nameNormalized: `inactive bait ${suffix}`,
        type: 'BAIT',
        isActive: false,
      },
    });

    const forbiddenWins = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      other.cookie,
    )
      .send({ baitId: randomUUID() })
      .expect(403);
    assert.equal(readErrorCode(forbiddenWins.body as unknown), 'CATCH_REPORT_NOT_OWNED');

    const missingBait = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ baitId: randomUUID() })
      .expect(404);
    assert.equal(readErrorCode(missingBait.body as unknown), 'BAIT_NOT_FOUND');
    const rejectedBait = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ baitId: inactiveBait.id })
      .expect(409);
    assert.equal(readErrorCode(rejectedBait.body as unknown), 'BAIT_INACTIVE');
    const missingSpinning = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ baitId: activeBait.id })
      .expect(400);
    assert.equal(readErrorCode(missingSpinning.body as unknown), 'VALIDATION_ERROR');
    await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
      .send({ baitId: activeBait.id, spinningSize: 'MEDIUM', spinningSpeed: 'SLOW' })
      .expect(200);

    const secondLocation = await prisma.location.create({
      data: {
        fishingBaseId: catalog.base.id,
        number: 2,
        name: `Replacement Location ${suffix}`,
        nameNormalized: `replacement location ${suffix}`,
      },
    });
    const inactiveLocation = await prisma.location.create({
      data: {
        fishingBaseId: catalog.base.id,
        number: 3,
        name: `Inactive Location ${suffix}`,
        nameNormalized: `inactive location ${suffix}`,
        isActive: false,
      },
    });
    const inactiveBase = await prisma.fishingBase.create({
      data: {
        name: `Inactive Replacement Base ${suffix}`,
        nameNormalized: `inactive replacement base ${suffix}`,
        isActive: false,
      },
    });
    const inactiveBaseLocation = await prisma.location.create({
      data: {
        fishingBaseId: inactiveBase.id,
        number: 1,
        name: `Inactive Base Location ${suffix}`,
        nameNormalized: `inactive base location ${suffix}`,
      },
    });
    const secondFish = await prisma.fish.create({
      data: {
        name: `Replacement Fish ${suffix}`,
        nameNormalized: `replacement fish ${suffix}`,
      },
    });
    const inactiveFish = await prisma.fish.create({
      data: {
        name: `Inactive Fish ${suffix}`,
        nameNormalized: `inactive fish ${suffix}`,
        isActive: false,
      },
    });
    await prisma.fishingBaseFish.createMany({
      data: [
        { fishingBaseId: inactiveBase.id, fishId: catalog.fish.id },
        { fishingBaseId: catalog.base.id, fishId: inactiveFish.id },
      ],
    });

    const missingLocation = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ locationId: randomUUID() })
      .expect(404);
    assert.equal(readErrorCode(missingLocation.body as unknown), 'LOCATION_NOT_FOUND');
    const rejectedLocation = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ locationId: inactiveLocation.id })
      .expect(409);
    assert.equal(readErrorCode(rejectedLocation.body as unknown), 'LOCATION_INACTIVE');

    const rejectedBase = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ locationId: inactiveBaseLocation.id })
      .expect(409);
    assert.equal(readErrorCode(rejectedBase.body as unknown), 'FISHING_BASE_INACTIVE');

    await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
      .send({ locationId: secondLocation.id })
      .expect(200);

    const missingFish = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ fishId: randomUUID() })
      .expect(404);
    assert.equal(readErrorCode(missingFish.body as unknown), 'FISH_NOT_FOUND');
    const rejectedFish = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ fishId: inactiveFish.id })
      .expect(409);
    assert.equal(readErrorCode(rejectedFish.body as unknown), 'FISH_INACTIVE');

    const missingFishPair = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ fishId: secondFish.id })
      .expect(409);
    assert.equal(
      readErrorCode(missingFishPair.body as unknown),
      'FISH_NOT_AVAILABLE_AT_FISHING_BASE',
    );
    await prisma.fishingBaseFish.create({
      data: { fishingBaseId: catalog.base.id, fishId: secondFish.id },
    });
    const changedPair = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ fishId: secondFish.id })
      .expect(200);
    const changedReport = readReport(changedPair.body as unknown);
    assert.equal(asString(asObject(changedReport.location).id, 'location.id'), secondLocation.id);
    assert.equal(asString(asObject(changedReport.fish).id, 'fish.id'), secondFish.id);
    assert.equal(asString(asObject(changedReport.bait).id, 'bait.id'), activeBait.id);
  });

  void test('uses persisted fishingMethod unless baitId actually changes', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const owner = await createActor();
    const created = await createReport(owner, catalog, { holeDepthCm: 600 });
    const reportId = asString(created.id, 'report.id');

    await prisma.bait.update({
      where: { id: catalog.bait.id },
      data: { type: 'LURE' },
    });

    const observationOnly = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({ holeDepthCm: 700 })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(observationOnly.fishingMethod, 'BAIT_FISHING');
    assert.equal(observationOnly.holeDepthCm, 700);

    const redundantSameBait = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({ baitId: catalog.bait.id, weightGrams: 41 })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(redundantSameBait.fishingMethod, 'BAIT_FISHING');
    assert.equal(redundantSameBait.spinningSize, null);
    assert.equal(redundantSameBait.spinningSpeed, null);

    const sameBaitCannotReclassify = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ baitId: catalog.bait.id, spinningSize: 'SMALL' })
      .expect(400);
    assert.equal(readErrorCode(sameBaitCannotReclassify.body as unknown), 'VALIDATION_ERROR');

    const newLure = await createBait('LURE');
    const incompleteBaitToLure = await mutation(
      api().patch(`/api/v1/catch-reports/${reportId}`),
      owner.cookie,
    )
      .send({ baitId: newLure.id })
      .expect(400);
    assert.equal(readErrorCode(incompleteBaitToLure.body as unknown), 'VALIDATION_ERROR');

    const baitToLure = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({
            baitId: newLure.id,
            holeDepthCm: null,
            spinningSize: 'MEDIUM',
            spinningSpeed: 'FAST',
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(baitToLure.fishingMethod, 'SPINNING');
    assert.equal(baitToLure.holeDepthCm, null);
    assert.equal(baitToLure.spinningSize, 'MEDIUM');
    assert.equal(baitToLure.spinningSpeed, 'FAST');

    await prisma.bait.update({ where: { id: newLure.id }, data: { type: 'BAIT' } });
    const persistedSpinning = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({ spinningSpeed: 'SLOW' })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(persistedSpinning.fishingMethod, 'SPINNING');
    assert.equal(persistedSpinning.spinningSpeed, 'SLOW');

    const redundantSpinningBait = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({ baitId: newLure.id, spinningSize: 'LARGE' })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(redundantSpinningBait.fishingMethod, 'SPINNING');
    assert.equal(redundantSpinningBait.spinningSize, 'LARGE');

    const newBait = await createBait('BAIT');
    const lureToBait = readReport(
      (
        await mutation(api().patch(`/api/v1/catch-reports/${reportId}`), owner.cookie)
          .send({
            baitId: newBait.id,
            holeDepthCm: 555,
            spinningSize: 'LARGE',
            spinningSpeed: 'SLOW',
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(lureToBait.fishingMethod, 'BAIT_FISHING');
    assert.equal(lureToBait.holeDepthCm, 555);
    assert.equal(lureToBait.spinningSize, null);
    assert.equal(lureToBait.spinningSpeed, null);

    const stored = await prisma.catchReport.findUniqueOrThrow({ where: { id: reportId } });
    assert.equal(stored.fishingMethod, 'BAIT_FISHING');
    assert.equal(stored.baitId, newBait.id);
    assert.equal(stored.spinningSize, null);
    assert.equal(stored.spinningSpeed, null);

    const publicDetail = readReport(
      (await api().get(`/api/v1/catch-reports/${reportId}`).expect(200)).body as unknown,
    );
    assert.equal(publicDetail.fishingMethod, 'BAIT_FISHING');
    assert.deepEqual(Object.keys(asObject(publicDetail.bait)).sort(), ['id', 'name']);
  });

  void test('PostgreSQL enforces CHECK, FK and ON DELETE RESTRICT constraints', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();
    const baseData = {
      userId: actor.userId,
      locationId: catalog.location.id,
      fishId: catalog.fish.id,
      baitId: catalog.bait.id,
      fishingMethod: 'BAIT_FISHING' as const,
    };

    await assert.rejects(prisma.catchReport.create({ data: { ...baseData, weightGrams: 0 } }));
    await assert.rejects(
      prisma.catchReport.create({
        data: { ...baseData, weightGrams: 1, holeDepthCm: 0 },
      }),
    );

    for (const invalidInvariantWrite of [
      () =>
        prisma.catchReport.create({
          data: { ...baseData, weightGrams: 1, holeDepthCm: null },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            weightGrams: 1,
            holeDepthCm: 1,
            spinningSize: 'SMALL',
            spinningSpeed: 'SLOW',
          },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            fishingMethod: 'SPINNING',
            weightGrams: 1,
            holeDepthCm: null,
          },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            fishingMethod: 'SPINNING',
            weightGrams: 1,
            spinningSize: 'SMALL',
          },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            fishingMethod: 'SPINNING',
            weightGrams: 1,
            spinningSpeed: 'FAST',
          },
        }),
      () =>
        prisma.catchReport.create({
          data: { ...baseData, weightGrams: 1, holeDepthCm: 1, spotPositionRaw: '' },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            weightGrams: 1,
            holeDepthCm: 1,
            spotPositionRaw: 'ч'.repeat(1_001),
          },
        }),
      () =>
        prisma.catchReport.create({
          data: { ...baseData, weightGrams: 1, holeDepthCm: 1, rawSourceText: '' },
        }),
      () =>
        prisma.catchReport.create({
          data: {
            ...baseData,
            weightGrams: 1,
            holeDepthCm: 1,
            rawSourceText: 'я'.repeat(20_001),
          },
        }),
    ]) {
      await assert.rejects(invalidInvariantWrite());
    }
    assert.equal(await prisma.catchReport.count(), 0);

    await assert.rejects(
      prisma.catchReport.create({
        data: { ...baseData, locationId: randomUUID(), weightGrams: 1, holeDepthCm: 1 },
      }),
      (error: unknown) => prismaErrorCode(error) === 'P2003',
    );

    const spinningReport = await prisma.catchReport.create({
      data: {
        ...baseData,
        fishingMethod: 'SPINNING',
        weightGrams: 1,
        holeDepthCm: null,
        spinningSize: 'LARGE',
        spinningSpeed: 'FAST',
      },
    });
    assert.equal(spinningReport.fishingMethod, 'SPINNING');
    assert.equal(spinningReport.holeDepthCm, null);

    const report = await prisma.catchReport.create({
      data: { ...baseData, weightGrams: 1, holeDepthCm: 1 },
    });

    for (const deleteParent of [
      () => prisma.user.delete({ where: { id: actor.userId } }),
      () => prisma.location.delete({ where: { id: catalog.location.id } }),
      () => prisma.fish.delete({ where: { id: catalog.fish.id } }),
      () => prisma.bait.delete({ where: { id: catalog.bait.id } }),
    ]) {
      await assert.rejects(deleteParent(), (error: unknown) => prismaErrorCode(error) === 'P2003');
    }

    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: { fishingBaseId: catalog.base.id, fishId: catalog.fish.id },
      },
    });
    assert.equal(await prisma.catchReport.count({ where: { id: report.id } }), 1);
    assert.equal(await prisma.catchReport.count({ where: { id: spinningReport.id } }), 1);
    assert.equal(await prisma.user.count({ where: { id: actor.userId } }), 1);
    assert.equal(await prisma.location.count({ where: { id: catalog.location.id } }), 1);
    assert.equal(await prisma.fish.count({ where: { id: catalog.fish.id } }), 1);
    assert.equal(await prisma.bait.count({ where: { id: catalog.bait.id } }), 1);
  });

  void test('paginates deterministically across equal timestamps and concurrent head inserts', async () => {
    const catalog = await createCatalog();
    const actor = await createActor();
    const other = await createActor();
    const ids = [1, 2, 3, 4, 5].map(
      (value) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`,
    );
    const times = [
      new Date('2026-01-01T00:00:01.000Z'),
      new Date('2026-01-01T00:00:03.000Z'),
      new Date('2026-01-01T00:00:03.000Z'),
      new Date('2026-01-01T00:00:04.000Z'),
      new Date('2026-01-01T00:00:05.000Z'),
    ];

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const createdAt = times[index];
      assert.ok(id);
      assert.ok(createdAt);
      await prisma.catchReport.create({
        data: {
          id,
          userId: actor.userId,
          locationId: catalog.location.id,
          fishId: catalog.fish.id,
          baitId: catalog.bait.id,
          weightGrams: index + 1,
          fishingMethod: 'BAIT_FISHING',
          holeDepthCm: 600,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }

    const firstPage = readReportList(
      (await api().get('/api/v1/catch-reports?limit=3').expect(200)).body as unknown,
    );
    assert.deepEqual(
      firstPage.items.map((item) => item.id),
      [ids[4], ids[3], ids[2]],
    );
    assert.ok(firstPage.nextCursor);

    const headId = '00000000-0000-4000-8000-000000000006';
    await prisma.catchReport.create({
      data: {
        id: headId,
        userId: actor.userId,
        locationId: catalog.location.id,
        fishId: catalog.fish.id,
        baitId: catalog.bait.id,
        weightGrams: 6,
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: 600,
        createdAt: new Date('2026-01-01T00:00:06.000Z'),
        updatedAt: new Date('2026-01-01T00:00:06.000Z'),
      },
    });

    const secondPage = readReportList(
      (
        await api()
          .get(`/api/v1/catch-reports?limit=3&cursor=${encodeURIComponent(firstPage.nextCursor)}`)
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      secondPage.items.map((item) => item.id),
      [ids[1], ids[0]],
    );
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(
      [...firstPage.items, ...secondPage.items].map((item) => item.id),
      [ids[4], ids[3], ids[2], ids[1], ids[0]],
    );

    await prisma.catchReport.create({
      data: {
        userId: other.userId,
        locationId: catalog.location.id,
        fishId: catalog.fish.id,
        baitId: catalog.bait.id,
        weightGrams: 7,
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: 600,
        createdAt: new Date('2026-01-01T00:00:07.000Z'),
        updatedAt: new Date('2026-01-01T00:00:07.000Z'),
      },
    });
    const myList = readReportList(
      (
        await api()
          .get('/api/v1/me/catch-reports?limit=100')
          .set('Cookie', actor.cookie)
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      myList.items.map((item) => item.id),
      [headId, ids[4], ids[3], ids[2], ids[1], ids[0]],
    );
    assert.equal(myList.nextCursor, null);

    const anonymousMy = await api().get('/api/v1/me/catch-reports').expect(401);
    assert.equal(readErrorCode(anonymousMy.body as unknown), 'AUTH_REQUIRED');

    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'cursor=not-json']) {
      const invalid = await api().get(`/api/v1/catch-reports?${query}`).expect(400);
      assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');
    }
  });
});
