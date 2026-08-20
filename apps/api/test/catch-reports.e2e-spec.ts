import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config as loadEnvironmentFile } from 'dotenv';
import request from 'supertest';
import { nativeContributorKey } from '../src/catch-reports/catch-report-identity.js';
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

interface StatisticsReportOverrides {
  contributorKey?: string;
  importKey?: string | null;
  locationId?: string;
  fishId?: string;
  baitId?: string;
  fishingMethod?: 'BAIT_FISHING' | 'SPINNING';
  holeDepthCm?: number | null;
  spotPositionRaw?: string | null;
  fishingNote?: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize?: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed?: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  createdAt?: Date;
}

interface HoleStatisticsItem {
  fishingBase: { id: string; name: string; isActive: boolean };
  location: { id: string; number: number; name: string; isActive: boolean };
  holeDepthCm: number;
  spotPosition: string | null;
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
}

interface BaitStatisticsItem {
  bait: { id: string; name: string; isActive: boolean };
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
}

interface FishingConditionStatisticsItem {
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
  fishingNote: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
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

function readHoleStatistics(body: unknown): HoleStatisticsItem[] {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['items']);

  return asArray(payload.items).map((value) => {
    const item = asObject(value);
    assert.deepEqual(Object.keys(item).sort(), [
      'fishingBase',
      'holeDepthCm',
      'latestReportCreatedAt',
      'location',
      'reportsCount',
      'spotPosition',
      'uniqueUsersCount',
    ]);
    const fishingBase = asObject(item.fishingBase);
    const location = asObject(item.location);
    assert.deepEqual(Object.keys(fishingBase).sort(), ['id', 'isActive', 'name']);
    assert.deepEqual(Object.keys(location).sort(), ['id', 'isActive', 'name', 'number']);
    assert.equal(typeof fishingBase.isActive, 'boolean');
    assert.equal(typeof location.isActive, 'boolean');
    assert.ok(item.spotPosition === null || typeof item.spotPosition === 'string');

    const result: HoleStatisticsItem = {
      fishingBase: {
        id: asString(fishingBase.id, 'fishingBase.id'),
        name: asString(fishingBase.name, 'fishingBase.name'),
        isActive: fishingBase.isActive as boolean,
      },
      location: {
        id: asString(location.id, 'location.id'),
        number: asNumber(location.number, 'location.number'),
        name: asString(location.name, 'location.name'),
        isActive: location.isActive as boolean,
      },
      holeDepthCm: asNumber(item.holeDepthCm, 'holeDepthCm'),
      spotPosition: item.spotPosition,
      uniqueUsersCount: asNumber(item.uniqueUsersCount, 'uniqueUsersCount'),
      reportsCount: asNumber(item.reportsCount, 'reportsCount'),
      latestReportCreatedAt: asString(item.latestReportCreatedAt, 'latestReportCreatedAt'),
    };

    const serialized = JSON.stringify(result);
    for (const forbiddenField of [
      'userId',
      'author',
      'nickname',
      'email',
      'role',
      'isBanned',
      'rawSourceText',
      'contributorKey',
      'importKey',
      'userNoteRaw',
      'normalizedSpotKey',
      'bait',
      'fishingMethod',
      'fishingNote',
      'private',
    ]) {
      assert.equal(serialized.includes(`"${forbiddenField}"`), false);
    }

    return result;
  });
}

function readBaitStatistics(body: unknown): BaitStatisticsItem[] {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['items']);

  return asArray(payload.items).map((value) => {
    const item = asObject(value);
    assert.deepEqual(Object.keys(item).sort(), [
      'bait',
      'fishingMethod',
      'latestReportCreatedAt',
      'reportsCount',
      'uniqueUsersCount',
    ]);
    const bait = asObject(item.bait);
    assert.deepEqual(Object.keys(bait).sort(), ['id', 'isActive', 'name']);
    assert.equal(typeof bait.isActive, 'boolean');
    assert.ok(item.fishingMethod === 'BAIT_FISHING' || item.fishingMethod === 'SPINNING');

    const result: BaitStatisticsItem = {
      bait: {
        id: asString(bait.id, 'bait.id'),
        name: asString(bait.name, 'bait.name'),
        isActive: bait.isActive as boolean,
      },
      fishingMethod: item.fishingMethod,
      uniqueUsersCount: asNumber(item.uniqueUsersCount, 'uniqueUsersCount'),
      reportsCount: asNumber(item.reportsCount, 'reportsCount'),
      latestReportCreatedAt: asString(item.latestReportCreatedAt, 'latestReportCreatedAt'),
    };

    const serialized = JSON.stringify(result);
    for (const forbiddenField of [
      'userId',
      'author',
      'nickname',
      'email',
      'role',
      'isBanned',
      'rawSourceText',
      'contributorKey',
      'importKey',
      'userNoteRaw',
      'spotPositionRaw',
      'fishingNote',
      'holeDepthCm',
      'location',
      'fishingBase',
      'type',
      'nameNormalized',
    ]) {
      assert.equal(serialized.includes(`"${forbiddenField}"`), false);
    }

    return result;
  });
}

function readFishingConditionStatistics(body: unknown): FishingConditionStatisticsItem[] {
  const payload = asObject(body);
  assert.deepEqual(Object.keys(payload), ['items']);

  return asArray(payload.items).map((value) => {
    const item = asObject(value);
    assert.deepEqual(Object.keys(item).sort(), [
      'fishingMethod',
      'fishingNote',
      'latestReportCreatedAt',
      'reportsCount',
      'spinningSize',
      'spinningSpeed',
      'uniqueUsersCount',
    ]);
    assert.ok(item.fishingMethod === 'BAIT_FISHING' || item.fishingMethod === 'SPINNING');
    assert.ok(
      item.fishingNote === null ||
        item.fishingNote === 'MIDWATER' ||
        item.fishingNote === 'FROM_BOTTOM' ||
        item.fishingNote === 'SURFACE',
    );

    if (item.fishingMethod === 'BAIT_FISHING') {
      assert.equal(item.spinningSize, null);
      assert.equal(item.spinningSpeed, null);
    } else {
      assert.ok(
        item.spinningSize === 'SMALL' ||
          item.spinningSize === 'MEDIUM' ||
          item.spinningSize === 'LARGE',
      );
      assert.ok(
        item.spinningSpeed === 'SLOW' ||
          item.spinningSpeed === 'MEDIUM' ||
          item.spinningSpeed === 'FAST',
      );
    }

    const result: FishingConditionStatisticsItem = {
      fishingMethod: item.fishingMethod,
      fishingNote: item.fishingNote,
      spinningSize: item.spinningSize,
      spinningSpeed: item.spinningSpeed,
      uniqueUsersCount: asNumber(item.uniqueUsersCount, 'uniqueUsersCount'),
      reportsCount: asNumber(item.reportsCount, 'reportsCount'),
      latestReportCreatedAt: asString(item.latestReportCreatedAt, 'latestReportCreatedAt'),
    };

    const serialized = JSON.stringify(result);
    for (const forbiddenField of [
      'userId',
      'author',
      'nickname',
      'email',
      'role',
      'isBanned',
      'rawSourceText',
      'contributorKey',
      'importKey',
      'userNoteRaw',
      'spotPositionRaw',
      'holeDepthCm',
      'baitId',
      'bait',
      'location',
      'fishingBase',
      'type',
    ]) {
      assert.equal(serialized.includes(`"${forbiddenField}"`), false);
    }

    return result;
  });
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
    'contributorKey',
    'importKey',
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

async function createStatisticsReport(
  actor: AuthenticatedActor,
  catalog: CatalogFixture,
  overrides: StatisticsReportOverrides = {},
) {
  const createdAt = overrides.createdAt ?? new Date('2026-08-13T12:00:00.000Z');

  return prisma.catchReport.create({
    data: {
      userId: actor.userId,
      contributorKey: overrides.contributorKey ?? nativeContributorKey(actor.userId),
      importKey: overrides.importKey ?? null,
      locationId: overrides.locationId ?? catalog.location.id,
      fishId: overrides.fishId ?? catalog.fish.id,
      baitId: overrides.baitId ?? catalog.bait.id,
      weightGrams: 40,
      fishingMethod: overrides.fishingMethod ?? 'BAIT_FISHING',
      holeDepthCm: overrides.holeDepthCm === undefined ? 600 : overrides.holeDepthCm,
      spotPositionRaw:
        overrides.spotPositionRaw === undefined ? 'точка' : overrides.spotPositionRaw,
      fishingNote: overrides.fishingNote ?? null,
      spinningSize: overrides.spinningSize ?? null,
      spinningSpeed: overrides.spinningSpeed ?? null,
      userNoteRaw: 'Личная заметка не для статистики',
      rawSourceText: 'Исходная строка не для статистики',
      createdAt,
      updatedAt: createdAt,
    },
  });
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
      { contributorKey: 'external:forum:spoofed-member' },
      { importKey: 'external:forum:spoofed-observation' },
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
    assert.equal(stored.contributorKey, nativeContributorKey(actor.userId));
    assert.equal(stored.importKey, null);
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
      contributorKey: nativeContributorKey(actor.userId),
      importKey: null,
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

  void test('filters the anonymous feed by Fish and Bases with cursor and historical semantics', async () => {
    const firstCatalog = await createCatalog();
    const secondCatalog = await createCatalog();
    const thirdCatalog = await createCatalog();
    const actor = await createActor();
    await prisma.fishingBaseFish.createMany({
      data: [
        { fishingBaseId: secondCatalog.base.id, fishId: firstCatalog.fish.id },
        { fishingBaseId: thirdCatalog.base.id, fishId: firstCatalog.fish.id },
      ],
    });

    const firstReport = await createReport(actor, firstCatalog, { weightGrams: 101 });
    const secondReport = await createReport(actor, secondCatalog, {
      fishId: firstCatalog.fish.id,
      weightGrams: 102,
    });
    const thirdReport = await createReport(actor, thirdCatalog, {
      fishId: firstCatalog.fish.id,
      weightGrams: 103,
    });
    const otherFishReport = await createReport(actor, secondCatalog, { weightGrams: 104 });
    const targetIds = [firstReport, secondReport, thirdReport]
      .map((report) => asString(report.id, 'report.id'))
      .sort();

    const firstTwoBases = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({
            fishId: firstCatalog.fish.id,
            baseIds: `${firstCatalog.base.id},${secondCatalog.base.id}`,
            limit: 100,
          })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      firstTwoBases.items.map((report) => asString(report.id, 'report.id')).sort(),
      [firstReport, secondReport].map((report) => asString(report.id, 'report.id')).sort(),
    );
    firstTwoBases.items.forEach(assertPublicReportProjection);

    const fishOnly = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({ fishId: firstCatalog.fish.id, limit: 100 })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      fishOnly.items.map((report) => asString(report.id, 'report.id')).sort(),
      targetIds,
    );

    const baseOnly = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({ baseIds: secondCatalog.base.id, limit: 100 })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      baseOnly.items.map((report) => asString(report.id, 'report.id')).sort(),
      [secondReport, otherFishReport].map((report) => asString(report.id, 'report.id')).sort(),
    );

    const firstPage = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({
            fishId: firstCatalog.fish.id,
            baseIds: [firstCatalog.base.id, secondCatalog.base.id, thirdCatalog.base.id].join(','),
            limit: 2,
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(firstPage.items.length, 2);
    assert.ok(firstPage.nextCursor);
    const secondPage = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({
            fishId: firstCatalog.fish.id,
            baseIds: [firstCatalog.base.id, secondCatalog.base.id, thirdCatalog.base.id].join(','),
            limit: 2,
            cursor: firstPage.nextCursor,
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(
      [...firstPage.items, ...secondPage.items]
        .map((report) => asString(report.id, 'report.id'))
        .sort(),
      targetIds,
    );

    const unknownBase = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({ fishId: firstCatalog.fish.id, baseIds: randomUUID() })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(unknownBase, { items: [], nextCursor: null });

    for (const query of [
      { fishId: 'not-a-uuid' },
      { baseIds: '' },
      { baseIds: `${firstCatalog.base.id},not-a-uuid` },
    ]) {
      const invalid = await api().get('/api/v1/catch-reports').query(query).expect(400);
      assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');
    }
    const repeatedBaseIds = await api()
      .get(`/api/v1/catch-reports?baseIds=${firstCatalog.base.id}&baseIds=${secondCatalog.base.id}`)
      .expect(400);
    assert.equal(readErrorCode(repeatedBaseIds.body as unknown), 'VALIDATION_ERROR');
    const privateFilter = await api()
      .get(`/api/v1/me/catch-reports?fishId=${firstCatalog.fish.id}`)
      .set('Cookie', actor.cookie)
      .expect(400);
    assert.equal(readErrorCode(privateFilter.body as unknown), 'VALIDATION_ERROR');

    await prisma.fishingBase.update({
      where: { id: firstCatalog.base.id },
      data: { isActive: false },
    });
    await prisma.location.update({
      where: { id: firstCatalog.location.id },
      data: { isActive: false },
    });
    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: {
          fishingBaseId: firstCatalog.base.id,
          fishId: firstCatalog.fish.id,
        },
      },
    });

    const historical = readReportList(
      (
        await api()
          .get('/api/v1/catch-reports')
          .query({ fishId: firstCatalog.fish.id, baseIds: firstCatalog.base.id })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(
      historical.items.map((report) => asString(report.id, 'report.id')),
      [asString(firstReport.id, 'report.id')],
    );
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
          contributorKey: nativeContributorKey(actor.userId),
          importKey: null,
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
        contributorKey: nativeContributorKey(actor.userId),
        importKey: null,
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
        contributorKey: nativeContributorKey(other.userId),
        importKey: null,
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

  void test('Bait statistics reuses the required anonymous Fish/Base scope validation', async () => {
    const endpoint = '/api/v1/catch-reports/statistics/baits';
    const unknown = readBaitStatistics(
      (await api().get(endpoint).query({ fishId: randomUUID(), baseIds: randomUUID() }).expect(200))
        .body as unknown,
    );
    assert.deepEqual(unknown, []);

    const baseId = randomUUID();
    const fishId = randomUUID();
    for (const url of [
      endpoint,
      `${endpoint}?fishId=${fishId}`,
      `${endpoint}?baseIds=${baseId}`,
      `${endpoint}?fishId=not-a-uuid&baseIds=${baseId}`,
      `${endpoint}?fishId=${fishId}&baseIds=${baseId}&baseIds=${randomUUID()}`,
    ]) {
      const invalid = await api().get(url).expect(400);
      assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');
    }

    const duplicatedScope = readBaitStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId, baseIds: `${baseId.toUpperCase()},${baseId}` })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(duplicatedScope, []);
  });

  void test('Bait statistics ranks scoped historical Bait/method groups without current reclassification', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const otherCatalog = await createCatalog();
    const lure = await createBait('LURE');
    const [firstUser, secondUser, thirdUser] = await Promise.all([
      createActor(),
      createActor(),
      createActor(),
    ]);
    const at = (second: number) =>
      new Date(`2026-05-01T00:00:${String(second).padStart(2, '0')}.000Z`);
    const spinningObservation = {
      fishingMethod: 'SPINNING' as const,
      holeDepthCm: null,
      spinningSize: 'MEDIUM' as const,
      spinningSpeed: 'SLOW' as const,
    };

    await createStatisticsReport(firstUser, catalog, { createdAt: at(1) });
    await createStatisticsReport(secondUser, catalog, { createdAt: at(2) });
    await createStatisticsReport(secondUser, catalog, { createdAt: at(3) });
    await createStatisticsReport(firstUser, catalog, {
      baitId: lure.id,
      ...spinningObservation,
      createdAt: at(4),
    });
    await createStatisticsReport(secondUser, catalog, {
      baitId: lure.id,
      ...spinningObservation,
      createdAt: at(5),
    });
    for (const second of [6, 7, 8, 9]) {
      await createStatisticsReport(thirdUser, catalog, {
        baitId: catalog.bait.id,
        ...spinningObservation,
        createdAt: at(second),
      });
    }
    await createStatisticsReport(thirdUser, catalog, {
      fishId: otherCatalog.fish.id,
      baitId: lure.id,
      ...spinningObservation,
      createdAt: at(10),
    });
    await createStatisticsReport(firstUser, otherCatalog, {
      fishId: catalog.fish.id,
      baitId: lure.id,
      ...spinningObservation,
      createdAt: at(11),
    });

    const historicalBaitName = 'Переименованная историческая наживка';
    const historicalLureName = 'Переименованная историческая приманка';
    await prisma.bait.update({
      where: { id: catalog.bait.id },
      data: {
        name: historicalBaitName,
        nameNormalized: 'переименованная историческая наживка',
        type: 'LURE',
        isActive: false,
      },
    });
    await prisma.bait.update({
      where: { id: lure.id },
      data: {
        name: historicalLureName,
        nameNormalized: 'переименованная историческая приманка',
        type: 'BAIT',
      },
    });
    await prisma.user.update({ where: { id: firstUser.userId }, data: { isBanned: true } });
    await prisma.location.update({ where: { id: catalog.location.id }, data: { isActive: false } });
    await prisma.fishingBase.update({ where: { id: catalog.base.id }, data: { isActive: false } });
    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: {
          fishingBaseId: catalog.base.id,
          fishId: catalog.fish.id,
        },
      },
    });

    const endpoint = '/api/v1/catch-reports/statistics/baits';
    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };
    const items = readBaitStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );

    assert.deepEqual(
      items.map((item) => [
        item.bait.id,
        item.fishingMethod,
        item.uniqueUsersCount,
        item.reportsCount,
        item.latestReportCreatedAt,
      ]),
      [
        [catalog.bait.id, 'BAIT_FISHING', 2, 3, at(3).toISOString()],
        [lure.id, 'SPINNING', 2, 2, at(5).toISOString()],
        [catalog.bait.id, 'SPINNING', 1, 4, at(9).toISOString()],
      ],
    );
    assert.deepEqual(
      items.filter((item) => item.bait.id === catalog.bait.id).map((item) => item.fishingMethod),
      ['BAIT_FISHING', 'SPINNING'],
    );
    assert.ok(
      items
        .filter((item) => item.bait.id === catalog.bait.id)
        .every((item) => item.bait.name === historicalBaitName && !item.bait.isActive),
    );
    const historicalLure = items.find((item) => item.bait.id === lure.id);
    assert.ok(historicalLure);
    assert.equal(historicalLure.bait.name, historicalLureName);
    assert.equal(historicalLure.fishingMethod, 'SPINNING');

    const mixedKnownUnknownScope = readBaitStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId: catalog.fish.id, baseIds: `${catalog.base.id},${randomUUID()}` })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(mixedKnownUnknownScope, items);

    const bothBases = readBaitStatistics(
      (
        await api()
          .get(endpoint)
          .query({
            fishId: catalog.fish.id,
            baseIds: `${catalog.base.id},${otherCatalog.base.id}`,
          })
          .expect(200)
      ).body as unknown,
    );
    const scopedLure = bothBases.find(
      (item) => item.bait.id === lure.id && item.fishingMethod === 'SPINNING',
    );
    assert.ok(scopedLure);
    assert.equal(scopedLure.uniqueUsersCount, 2);
    assert.equal(scopedLure.reportsCount, 3);
    assert.equal(scopedLure.latestReportCreatedAt, at(11).toISOString());
  });

  void test('Bait statistics reflects report edits and deletes immediately', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const lure = await createBait('LURE');
    const [editor, remover] = await Promise.all([createActor(), createActor()]);
    const editedReport = await createReport(editor, catalog);
    const removedReport = await createReport(remover, catalog);
    const endpoint = '/api/v1/catch-reports/statistics/baits';
    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };

    const initial = readBaitStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      initial.map((item) => [
        item.bait.id,
        item.fishingMethod,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [[catalog.bait.id, 'BAIT_FISHING', 2, 2]],
    );

    const editedReportId = asString(editedReport.id, 'editedReport.id');
    await mutation(api().patch(`/api/v1/catch-reports/${editedReportId}`), editor.cookie)
      .send({
        baitId: lure.id,
        holeDepthCm: null,
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
      })
      .expect(200);

    const afterEdit = readBaitStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterEdit
        .map((item) => [item.bait.id, item.fishingMethod, item.uniqueUsersCount, item.reportsCount])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        [catalog.bait.id, 'BAIT_FISHING', 1, 1],
        [lure.id, 'SPINNING', 1, 1],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );

    const removedReportId = asString(removedReport.id, 'removedReport.id');
    await mutation(api().delete(`/api/v1/catch-reports/${removedReportId}`), remover.cookie).expect(
      204,
    );

    const afterDelete = readBaitStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterDelete.map((item) => [
        item.bait.id,
        item.fishingMethod,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [[lure.id, 'SPINNING', 1, 1]],
    );
  });

  void test('Fishing Conditions statistics reuses the required anonymous Fish/Base scope validation', async () => {
    const endpoint = '/api/v1/catch-reports/statistics/conditions';
    const unknown = readFishingConditionStatistics(
      (await api().get(endpoint).query({ fishId: randomUUID(), baseIds: randomUUID() }).expect(200))
        .body as unknown,
    );
    assert.deepEqual(unknown, []);

    const baseId = randomUUID();
    const fishId = randomUUID();
    for (const url of [
      endpoint,
      `${endpoint}?fishId=${fishId}`,
      `${endpoint}?baseIds=${baseId}`,
      `${endpoint}?fishId=not-a-uuid&baseIds=${baseId}`,
      `${endpoint}?fishId=${fishId}&baseIds=`,
      `${endpoint}?fishId=${fishId}&baseIds=${baseId}&baseIds=${randomUUID()}`,
    ]) {
      const invalid = await api().get(url).expect(400);
      assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');
    }

    const duplicatedScope = readFishingConditionStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId, baseIds: `${baseId.toUpperCase()},${baseId}` })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(duplicatedScope, []);
  });

  void test('Fishing Conditions statistics groups stored observations with unique contributors first', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const otherCatalog = await createCatalog();
    const secondBait = await createBait('BAIT');
    const lure = await createBait('LURE');
    const [firstUser, secondUser, thirdUser] = await Promise.all([
      createActor(),
      createActor(),
      createActor(),
    ]);
    const at = (second: number) =>
      new Date(`2026-06-01T00:00:${String(second).padStart(2, '0')}.000Z`);

    await createStatisticsReport(firstUser, catalog, {
      fishingNote: 'MIDWATER',
      holeDepthCm: 600,
      spotPositionRaw: 'первая точка',
      createdAt: at(1),
    });
    await createStatisticsReport(secondUser, catalog, {
      baitId: secondBait.id,
      fishingNote: 'MIDWATER',
      holeDepthCm: 700,
      spotPositionRaw: 'другая точка',
      createdAt: at(2),
    });
    await createStatisticsReport(secondUser, catalog, {
      fishingNote: 'MIDWATER',
      holeDepthCm: 800,
      spotPositionRaw: null,
      createdAt: at(3),
    });
    await createStatisticsReport(firstUser, catalog, {
      baitId: lure.id,
      fishingMethod: 'SPINNING',
      holeDepthCm: null,
      fishingNote: null,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
      spotPositionRaw: 'спиннинг один',
      createdAt: at(4),
    });
    await createStatisticsReport(secondUser, catalog, {
      baitId: lure.id,
      fishingMethod: 'SPINNING',
      holeDepthCm: 900,
      fishingNote: null,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
      spotPositionRaw: 'спиннинг два',
      createdAt: at(5),
    });
    for (const second of [6, 7, 8, 9]) {
      await createStatisticsReport(thirdUser, catalog, {
        baitId: catalog.bait.id,
        fishingMethod: 'SPINNING',
        holeDepthCm: null,
        fishingNote: 'SURFACE',
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
        createdAt: at(second),
      });
    }
    await createStatisticsReport(thirdUser, catalog, {
      fishingNote: null,
      createdAt: at(10),
    });
    await createStatisticsReport(thirdUser, catalog, {
      fishId: otherCatalog.fish.id,
      fishingNote: 'FROM_BOTTOM',
      createdAt: at(11),
    });
    await createStatisticsReport(firstUser, otherCatalog, {
      fishId: catalog.fish.id,
      fishingNote: 'FROM_BOTTOM',
      createdAt: at(12),
    });

    await prisma.bait.update({
      where: { id: catalog.bait.id },
      data: { type: 'LURE', isActive: false },
    });
    await prisma.bait.update({
      where: { id: secondBait.id },
      data: { type: 'LURE', isActive: false },
    });
    await prisma.bait.update({
      where: { id: lure.id },
      data: { type: 'BAIT', isActive: false },
    });
    await prisma.user.update({ where: { id: firstUser.userId }, data: { isBanned: true } });
    await prisma.fish.update({ where: { id: catalog.fish.id }, data: { isActive: false } });
    await prisma.location.update({ where: { id: catalog.location.id }, data: { isActive: false } });
    await prisma.fishingBase.update({ where: { id: catalog.base.id }, data: { isActive: false } });
    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: {
          fishingBaseId: catalog.base.id,
          fishId: catalog.fish.id,
        },
      },
    });

    const endpoint = '/api/v1/catch-reports/statistics/conditions';
    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };
    const items = readFishingConditionStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );

    assert.deepEqual(
      items.map((item) => [
        item.fishingMethod,
        item.fishingNote,
        item.spinningSize,
        item.spinningSpeed,
        item.uniqueUsersCount,
        item.reportsCount,
        item.latestReportCreatedAt,
      ]),
      [
        ['BAIT_FISHING', 'MIDWATER', null, null, 2, 3, at(3).toISOString()],
        ['SPINNING', null, 'MEDIUM', 'SLOW', 2, 2, at(5).toISOString()],
        ['SPINNING', 'SURFACE', 'SMALL', 'FAST', 1, 4, at(9).toISOString()],
        ['BAIT_FISHING', null, null, null, 1, 1, at(10).toISOString()],
      ],
    );

    const mixedKnownUnknownScope = readFishingConditionStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId: catalog.fish.id, baseIds: `${catalog.base.id},${randomUUID()}` })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(mixedKnownUnknownScope, items);

    const bothBases = readFishingConditionStatistics(
      (
        await api()
          .get(endpoint)
          .query({
            fishId: catalog.fish.id,
            baseIds: `${catalog.base.id},${otherCatalog.base.id}`,
          })
          .expect(200)
      ).body as unknown,
    );
    const otherBaseGroup = bothBases.find(
      (item) => item.fishingMethod === 'BAIT_FISHING' && item.fishingNote === 'FROM_BOTTOM',
    );
    assert.ok(otherBaseGroup);
    assert.equal(otherBaseGroup.uniqueUsersCount, 1);
    assert.equal(otherBaseGroup.reportsCount, 1);
    assert.equal(otherBaseGroup.latestReportCreatedAt, at(12).toISOString());
  });

  void test('Fishing Conditions statistics reflects report edits and deletes immediately', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const lure = await createBait('LURE');
    const [editor, remover] = await Promise.all([createActor(), createActor()]);
    const editedReport = await createReport(editor, catalog, { fishingNote: 'MIDWATER' });
    const removedReport = await createReport(remover, catalog, { fishingNote: 'MIDWATER' });
    const endpoint = '/api/v1/catch-reports/statistics/conditions';
    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };

    const initial = readFishingConditionStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      initial.map((item) => [
        item.fishingMethod,
        item.fishingNote,
        item.spinningSize,
        item.spinningSpeed,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [['BAIT_FISHING', 'MIDWATER', null, null, 2, 2]],
    );

    const editedReportId = asString(editedReport.id, 'editedReport.id');
    await mutation(api().patch(`/api/v1/catch-reports/${editedReportId}`), editor.cookie)
      .send({
        baitId: lure.id,
        holeDepthCm: null,
        fishingNote: 'SURFACE',
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
      })
      .expect(200);

    const afterEdit = readFishingConditionStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterEdit
        .map((item) => [
          item.fishingMethod,
          item.fishingNote,
          item.spinningSize,
          item.spinningSpeed,
          item.uniqueUsersCount,
          item.reportsCount,
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        ['BAIT_FISHING', 'MIDWATER', null, null, 1, 1],
        ['SPINNING', 'SURFACE', 'SMALL', 'FAST', 1, 1],
      ],
    );

    const removedReportId = asString(removedReport.id, 'removedReport.id');
    await mutation(api().delete(`/api/v1/catch-reports/${removedReportId}`), remover.cookie).expect(
      204,
    );

    const afterDelete = readFishingConditionStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterDelete.map((item) => [
        item.fishingMethod,
        item.fishingNote,
        item.spinningSize,
        item.spinningSpeed,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [['SPINNING', 'SURFACE', 'SMALL', 'FAST', 1, 1]],
    );
  });

  void test('counts opaque external contributors independently for one ADMIN owner', async () => {
    const catalog = await createCatalog({ baitType: 'BAIT' });
    const admin = await createActor('ADMIN');
    const contributorA = 'external:forum:member:opaque-a';
    const contributorB = 'external:forum:member:opaque-b';
    const at = (second: number) =>
      new Date(`2026-07-01T00:00:${String(second).padStart(2, '0')}.000Z`);
    const reports: Array<Awaited<ReturnType<typeof createStatisticsReport>>> = [];

    for (const [index, contributorKey, spotPositionRaw] of [
      [1, contributorA, 'ТОЧКА'],
      [2, contributorB, 'ТОЧКА'],
      [3, contributorA, 'точка'],
      [4, contributorA, 'точка'],
      [5, contributorA, 'точка'],
    ] as const) {
      reports.push(
        await createStatisticsReport(admin, catalog, {
          contributorKey,
          importKey: `external:forum:observation:thread-10:candidate-${index}`,
          fishingNote: 'MIDWATER',
          spotPositionRaw,
          createdAt: at(index),
        }),
      );
    }

    const stored = await prisma.catchReport.findMany({
      where: { userId: admin.userId },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(stored.length, 5);
    assert.deepEqual(new Set(stored.map((report) => report.userId)), new Set([admin.userId]));
    assert.deepEqual(
      new Set(stored.map((report) => report.contributorKey)),
      new Set([contributorA, contributorB]),
    );
    assert.equal(
      stored.every((report) => report.importKey !== null),
      true,
    );

    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };
    const baitItems = readBaitStatistics(
      (await api().get('/api/v1/catch-reports/statistics/baits').query(query).expect(200))
        .body as unknown,
    );
    assert.deepEqual(
      baitItems.map((item) => [item.uniqueUsersCount, item.reportsCount]),
      [[2, 5]],
    );

    const conditionItems = readFishingConditionStatistics(
      (await api().get('/api/v1/catch-reports/statistics/conditions').query(query).expect(200))
        .body as unknown,
    );
    assert.deepEqual(
      conditionItems.map((item) => [
        item.fishingMethod,
        item.fishingNote,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [['BAIT_FISHING', 'MIDWATER', 2, 5]],
    );

    const holeItems = readHoleStatistics(
      (await api().get('/api/v1/catch-reports/statistics/holes').query(query).expect(200))
        .body as unknown,
    );
    assert.deepEqual(
      holeItems.map((item) => [
        item.holeDepthCm,
        item.spotPosition,
        item.uniqueUsersCount,
        item.reportsCount,
      ]),
      [[600, 'ТОЧКА', 2, 5]],
    );

    const publicItems = readReportList(
      (await api().get('/api/v1/catch-reports?limit=100').expect(200)).body as unknown,
    ).items;
    assert.equal(publicItems.length, 5);
    for (const report of publicItems) {
      assertPublicReportProjection(report);
      assert.equal(asString(asObject(report.author).id, 'author.id'), admin.userId);
    }

    const firstReport = reports[0];
    assert.ok(firstReport);
    const ownerDetail = readReport(
      (
        await api()
          .get(`/api/v1/me/catch-reports/${firstReport.id}`)
          .set('Cookie', admin.cookie)
          .expect(200)
      ).body as unknown,
    );
    assertOwnerReportProjection(ownerDetail);
    assert.equal(asString(asObject(ownerDetail.author).id, 'author.id'), admin.userId);

    await mutation(api().patch(`/api/v1/catch-reports/${firstReport.id}`), admin.cookie)
      .send({ weightGrams: 41 })
      .expect(200);
    const afterOrdinaryEdit = await prisma.catchReport.findUniqueOrThrow({
      where: { id: firstReport.id },
    });
    assert.equal(afterOrdinaryEdit.contributorKey, contributorA);
    assert.equal(afterOrdinaryEdit.importKey, 'external:forum:observation:thread-10:candidate-1');

    await assert.rejects(
      prisma.catchReport.update({
        where: { id: firstReport.id },
        data: { contributorKey: contributorB },
      }),
    );
    await assert.rejects(
      prisma.catchReport.update({
        where: { id: firstReport.id },
        data: { importKey: 'external:forum:observation:replacement' },
      }),
    );
    await assert.rejects(
      createStatisticsReport(admin, catalog, {
        contributorKey: contributorB,
        importKey: 'external:forum:observation:thread-10:candidate-1',
        fishingNote: 'MIDWATER',
      }),
      (error: unknown) => prismaErrorCode(error) === 'P2002',
    );
    assert.equal(await prisma.catchReport.count(), 5);
  });

  void test('validates the required anonymous common-hole statistics scope', async () => {
    const endpoint = '/api/v1/catch-reports/statistics/holes';
    const unknown = readHoleStatistics(
      (await api().get(endpoint).query({ fishId: randomUUID(), baseIds: randomUUID() }).expect(200))
        .body as unknown,
    );
    assert.deepEqual(unknown, []);

    const baseId = randomUUID();
    const fishId = randomUUID();
    const tooManyBaseIds = Array.from({ length: 101 }, () => randomUUID()).join(',');
    const invalidUrls = [
      endpoint,
      `${endpoint}?fishId=${fishId}`,
      `${endpoint}?baseIds=${baseId}`,
      `${endpoint}?fishId=not-a-uuid&baseIds=${baseId}`,
      `${endpoint}?fishId=${fishId}&baseIds=`,
      `${endpoint}?fishId=${fishId}&baseIds=${baseId},`,
      `${endpoint}?fishId=${fishId}&baseIds=${baseId},not-a-uuid`,
      `${endpoint}?fishId=${fishId}&baseIds=${baseId}&baseIds=${randomUUID()}`,
      `${endpoint}?fishId=${fishId}&fishId=${randomUUID()}&baseIds=${baseId}`,
      `${endpoint}?fishId=${fishId}&baseIds=${tooManyBaseIds}`,
    ];

    for (const url of invalidUrls) {
      const invalid = await api().get(url).expect(400);
      assert.equal(readErrorCode(invalid.body as unknown), 'VALIDATION_ERROR');
    }

    const duplicatedScope = readHoleStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId, baseIds: `${baseId.toUpperCase()},${baseId}` })
          .expect(200)
      ).body as unknown,
    );
    assert.deepEqual(duplicatedScope, []);
  });

  void test('groups common holes by exact depth, Location and conservative PostgreSQL normalization', async () => {
    const catalog = await createCatalog();
    const otherCatalog = await createCatalog();
    const [firstUser, secondUser, thirdUser] = await Promise.all([
      createActor(),
      createActor(),
      createActor(),
    ]);
    const secondBait = await createBait('BAIT');
    const lure = await createBait('LURE');
    const secondLocation = await prisma.location.create({
      data: {
        fishingBaseId: catalog.base.id,
        number: 2,
        name: 'Catch Second Location',
        nameNormalized: 'catch second location',
      },
    });
    const at = (second: number) =>
      new Date(`2026-02-01T00:00:${String(second).padStart(2, '0')}.000Z`);

    await createStatisticsReport(firstUser, catalog, {
      spotPositionRaw: 'У\u00a0БЛОКНОТА',
      fishingNote: 'MIDWATER',
      createdAt: at(1),
    });
    await createStatisticsReport(secondUser, catalog, {
      baitId: lure.id,
      fishingMethod: 'SPINNING',
      spotPositionRaw: 'У\u00a0БЛОКНОТА',
      fishingNote: 'SURFACE',
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
      createdAt: at(2),
    });
    for (const second of [3, 4, 5]) {
      await createStatisticsReport(thirdUser, catalog, {
        baitId: secondBait.id,
        spotPositionRaw: '  у   блокнота  ',
        fishingNote: 'FROM_BOTTOM',
        createdAt: at(second),
      });
    }

    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 610,
      spotPositionRaw: '① место',
      createdAt: at(6),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 610,
      spotPositionRaw: '1 МЕСТО',
      createdAt: at(7),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 620,
      spotPositionRaw: 'точка',
      createdAt: at(8),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 620,
      spotPositionRaw: 'точка!',
      createdAt: at(9),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 630,
      spotPositionRaw: 'береза',
      createdAt: at(10),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 630,
      spotPositionRaw: 'берёза',
      createdAt: at(11),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 640,
      spotPositionRaw: 'уда',
      createdAt: at(12),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 640,
      spotPositionRaw: 'удочка',
      createdAt: at(13),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 650,
      spotPositionRaw: 'левый край',
      createdAt: at(14),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 650,
      spotPositionRaw: 'правый край',
      createdAt: at(15),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 660,
      spotPositionRaw: null,
      createdAt: at(16),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 660,
      spotPositionRaw: null,
      createdAt: at(17),
    });
    await createStatisticsReport(firstUser, catalog, {
      locationId: secondLocation.id,
      spotPositionRaw: 'у блокнота',
      createdAt: at(18),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 601,
      spotPositionRaw: 'у блокнота',
      createdAt: at(19),
    });
    await createStatisticsReport(firstUser, catalog, {
      baitId: lure.id,
      fishingMethod: 'SPINNING',
      holeDepthCm: null,
      spinningSize: 'SMALL',
      spinningSpeed: 'FAST',
      spotPositionRaw: 'не должна попасть',
      createdAt: at(20),
    });
    await createStatisticsReport(firstUser, catalog, {
      fishId: otherCatalog.fish.id,
      spotPositionRaw: 'чужая рыба',
      createdAt: at(21),
    });
    await createStatisticsReport(firstUser, otherCatalog, {
      fishId: catalog.fish.id,
      spotPositionRaw: 'другая база',
      createdAt: at(22),
    });

    const endpoint = '/api/v1/catch-reports/statistics/holes';
    const items = readHoleStatistics(
      (
        await api()
          .get(endpoint)
          .query({ fishId: catalog.fish.id, baseIds: catalog.base.id })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(items.length, 13);

    const mainGroup = items.find(
      (item) =>
        item.location.id === catalog.location.id &&
        item.holeDepthCm === 600 &&
        item.spotPosition === 'У\u00a0БЛОКНОТА',
    );
    assert.ok(mainGroup);
    assert.equal(mainGroup.uniqueUsersCount, 3);
    assert.equal(mainGroup.reportsCount, 5);
    assert.equal(mainGroup.latestReportCreatedAt, at(5).toISOString());

    const nfkcGroup = items.find(
      (item) => item.holeDepthCm === 610 && item.spotPosition === '1 МЕСТО',
    );
    assert.ok(nfkcGroup);
    assert.equal(nfkcGroup.uniqueUsersCount, 2);
    assert.equal(nfkcGroup.reportsCount, 2);
    assert.equal(
      items.filter((item) => item.location.id === catalog.location.id && item.holeDepthCm === 620)
        .length,
      2,
    );
    assert.deepEqual(
      items
        .filter((item) => item.holeDepthCm === 630)
        .map((item) => item.spotPosition)
        .sort(),
      ['береза', 'берёза'].sort(),
    );
    assert.deepEqual(
      items
        .filter((item) => item.holeDepthCm === 640)
        .map((item) => item.spotPosition)
        .sort(),
      ['уда', 'удочка'],
    );
    assert.deepEqual(
      items
        .filter((item) => item.holeDepthCm === 650)
        .map((item) => item.spotPosition)
        .sort(),
      ['левый край', 'правый край'],
    );
    const missingPosition = items.find(
      (item) => item.holeDepthCm === 660 && item.spotPosition === null,
    );
    assert.ok(missingPosition);
    assert.equal(missingPosition.uniqueUsersCount, 2);
    assert.equal(missingPosition.reportsCount, 2);
    assert.ok(
      items.some((item) => item.location.id === secondLocation.id && item.holeDepthCm === 600),
    );
    assert.ok(
      items.some((item) => item.location.id === catalog.location.id && item.holeDepthCm === 601),
    );
    assert.equal(
      items.some((item) => item.spotPosition === 'не должна попасть'),
      false,
    );
    assert.equal(
      items.some((item) => item.spotPosition === 'чужая рыба'),
      false,
    );
    assert.equal(
      items.some((item) => item.spotPosition === 'другая база'),
      false,
    );

    const mixedKnownUnknownScope = readHoleStatistics(
      (
        await api()
          .get(endpoint)
          .query({
            fishId: catalog.fish.id,
            baseIds: `${catalog.base.id},${randomUUID()}`,
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(mixedKnownUnknownScope.length, 13);

    const bothBases = readHoleStatistics(
      (
        await api()
          .get(endpoint)
          .query({
            fishId: catalog.fish.id,
            baseIds: `${catalog.base.id},${otherCatalog.base.id}`,
          })
          .expect(200)
      ).body as unknown,
    );
    assert.equal(bothBases.length, 14);
    assert.ok(bothBases.some((item) => item.spotPosition === 'другая база'));
  });

  void test('chooses representative raw variants and ranks groups deterministically', async () => {
    const catalog = await createCatalog();
    const [firstUser, secondUser] = await Promise.all([createActor(), createActor()]);
    const at = (second: number) =>
      new Date(`2026-03-01T00:00:${String(second).padStart(2, '0')}.000Z`);

    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 700,
      spotPositionRaw: 'АЛЬФА',
      createdAt: at(1),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 700,
      spotPositionRaw: 'альфа',
      createdAt: at(1),
    });

    for (const second of [17, 18, 19, 20]) {
      await createStatisticsReport(firstUser, catalog, {
        holeDepthCm: 701,
        spotPositionRaw: 'бета',
        createdAt: at(second),
      });
    }

    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 702,
      spotPositionRaw: 'ГАММА',
      createdAt: at(2),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 702,
      spotPositionRaw: 'ГАММА',
      createdAt: at(3),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 702,
      spotPositionRaw: 'гамма',
      createdAt: at(9),
    });

    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 703,
      spotPositionRaw: 'ДЕЛЬТА',
      createdAt: at(4),
    });
    await createStatisticsReport(secondUser, catalog, {
      holeDepthCm: 703,
      spotPositionRaw: 'дельта',
      createdAt: at(5),
    });

    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 704,
      spotPositionRaw: null,
      createdAt: at(6),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 704,
      spotPositionRaw: 'я',
      createdAt: at(6),
    });

    const lowerIdLocation = await prisma.location.create({
      data: {
        id: '30000000-0000-4000-8000-000000000010',
        fishingBaseId: catalog.base.id,
        number: 2,
        name: 'Lower ID ranking location',
        nameNormalized: 'lower id ranking location',
      },
    });
    const higherIdLocation = await prisma.location.create({
      data: {
        id: '30000000-0000-4000-8000-000000000020',
        fishingBaseId: catalog.base.id,
        number: 3,
        name: 'Higher ID ranking location',
        nameNormalized: 'higher id ranking location',
      },
    });
    await createStatisticsReport(firstUser, catalog, {
      locationId: lowerIdLocation.id,
      holeDepthCm: 900,
      spotPositionRaw: 'я',
      createdAt: at(7),
    });
    await createStatisticsReport(firstUser, catalog, {
      locationId: higherIdLocation.id,
      holeDepthCm: 800,
      spotPositionRaw: 'а',
      createdAt: at(7),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 710,
      spotPositionRaw: 'я',
      createdAt: at(8),
    });
    await createStatisticsReport(firstUser, catalog, {
      holeDepthCm: 711,
      spotPositionRaw: 'а',
      createdAt: at(8),
    });

    const items = readHoleStatistics(
      (
        await api()
          .get('/api/v1/catch-reports/statistics/holes')
          .query({ fishId: catalog.fish.id, baseIds: catalog.base.id })
          .expect(200)
      ).body as unknown,
    );

    assert.deepEqual(
      items.slice(0, 4).map((item) => item.holeDepthCm),
      [702, 703, 700, 701],
    );
    assert.equal(items.find((item) => item.holeDepthCm === 702)?.spotPosition, 'ГАММА');
    assert.equal(items.find((item) => item.holeDepthCm === 703)?.spotPosition, 'дельта');
    assert.equal(items.find((item) => item.holeDepthCm === 700)?.spotPosition, 'АЛЬФА');
    assert.equal(items[0]?.uniqueUsersCount, 2);
    assert.equal(items[0]?.reportsCount, 3);
    assert.equal(items[3]?.uniqueUsersCount, 1);
    assert.equal(items[3]?.reportsCount, 4);

    const nullTieIndex = items.findIndex(
      (item) => item.holeDepthCm === 704 && item.spotPosition === null,
    );
    const textTieIndex = items.findIndex(
      (item) => item.holeDepthCm === 704 && item.spotPosition === 'я',
    );
    assert.ok(nullTieIndex >= 0);
    assert.equal(textTieIndex, nullTieIndex + 1);

    const lowerIdLocationIndex = items.findIndex((item) => item.location.id === lowerIdLocation.id);
    const higherIdLocationIndex = items.findIndex(
      (item) => item.location.id === higherIdLocation.id,
    );
    assert.ok(lowerIdLocationIndex >= 0);
    assert.ok(higherIdLocationIndex > lowerIdLocationIndex);

    const lowerDepthIndex = items.findIndex(
      (item) => item.location.id === catalog.location.id && item.holeDepthCm === 710,
    );
    const higherDepthIndex = items.findIndex(
      (item) => item.location.id === catalog.location.id && item.holeDepthCm === 711,
    );
    assert.ok(lowerDepthIndex >= 0);
    assert.equal(higherDepthIndex, lowerDepthIndex + 1);
  });

  void test('keeps historical inactive, removed-membership and banned-user reports while edits and deletes move counts', async () => {
    const catalog = await createCatalog();
    const [bannedContributor, editor, remover] = await Promise.all([
      createActor(),
      createActor(),
      createActor(),
    ]);
    const bannedReport = await createReport(bannedContributor, catalog, {
      holeDepthCm: 600,
      spotPositionRaw: 'у блокнота',
      userNoteRaw: 'Секретный комментарий',
      rawSourceText: 'Секретный исходник',
    });
    const editedReport = await createReport(editor, catalog, {
      holeDepthCm: 600,
      spotPositionRaw: 'у блокнота',
    });
    const removedReport = await createReport(remover, catalog, {
      holeDepthCm: 600,
      spotPositionRaw: 'у блокнота',
    });

    await prisma.user.update({
      where: { id: bannedContributor.userId },
      data: { isBanned: true },
    });
    await prisma.location.update({
      where: { id: catalog.location.id },
      data: { isActive: false },
    });
    await prisma.fishingBase.update({
      where: { id: catalog.base.id },
      data: { isActive: false },
    });
    await prisma.fishingBaseFish.delete({
      where: {
        fishingBaseId_fishId: {
          fishingBaseId: catalog.base.id,
          fishId: catalog.fish.id,
        },
      },
    });

    const endpoint = '/api/v1/catch-reports/statistics/holes';
    const query = { fishId: catalog.fish.id, baseIds: catalog.base.id };
    const historical = readHoleStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.equal(historical.length, 1);
    assert.equal(historical[0]?.uniqueUsersCount, 3);
    assert.equal(historical[0]?.reportsCount, 3);
    assert.equal(historical[0]?.fishingBase.isActive, false);
    assert.equal(historical[0]?.location.isActive, false);
    assert.ok(bannedReport.id);

    const editedReportId = asString(editedReport.id, 'editedReport.id');
    await mutation(api().patch(`/api/v1/catch-reports/${editedReportId}`), editor.cookie)
      .send({ holeDepthCm: 700 })
      .expect(200);

    const afterEdit = readHoleStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterEdit.map((item) => [item.holeDepthCm, item.uniqueUsersCount, item.reportsCount]),
      [
        [600, 2, 2],
        [700, 1, 1],
      ],
    );

    const removedReportId = asString(removedReport.id, 'removedReport.id');
    await mutation(api().delete(`/api/v1/catch-reports/${removedReportId}`), remover.cookie).expect(
      204,
    );

    const afterDelete = readHoleStatistics(
      (await api().get(endpoint).query(query).expect(200)).body as unknown,
    );
    assert.deepEqual(
      afterDelete
        .map((item) => [item.holeDepthCm, item.uniqueUsersCount, item.reportsCount])
        .sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0)),
      [
        [600, 1, 1],
        [700, 1, 1],
      ],
    );
    assert.equal(await prisma.catchReport.count({ where: { id: bannedReport.id } }), 1);
  });
});
