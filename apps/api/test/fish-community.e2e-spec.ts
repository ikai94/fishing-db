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

type CountsResponse = { items: { mark: string; count: number }[] };
type VotersResponse = { items: { nickname: string }[]; nextCursor: string | null };
type AggregateResponse = {
  items: { bait: { id: string }; intensity: number }[];
  nextCursor: string | null;
};

const WEB_ORIGIN = 'http://localhost:3000';
const COOKIE_NAME = 'fishing_session';
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const TEST_EMAIL_PREFIX = 'community-api-';
const TEST_FISH_PREFIX = 'community-api-';

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

async function clearCommunityFixtures(): Promise<void> {
  await prisma.fishCommunityVote.deleteMany({
    where: {
      OR: [
        { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
        { fish: { nameNormalized: { startsWith: TEST_FISH_PREFIX } } },
      ],
    },
  });
  await prisma.catchReport.deleteMany({
    where: { user: { email: { startsWith: TEST_EMAIL_PREFIX } } },
  });
  await prisma.location.deleteMany({ where: { nameNormalized: { startsWith: TEST_FISH_PREFIX } } });
  await prisma.fishingBase.deleteMany({
    where: { nameNormalized: { startsWith: TEST_FISH_PREFIX } },
  });
  await prisma.bait.deleteMany({ where: { nameNormalized: { startsWith: TEST_FISH_PREFIX } } });
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
      nickname: `Community Actor ${actorSequence}`,
      nicknameNormalized: `community actor ${actorSequence}`,
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
      name: `Community API Fish ${sequence}`,
      nameNormalized: `${TEST_FISH_PREFIX}${sequence}`,
    },
    select: { id: true },
  });
}

void describe('Fish community API (PostgreSQL e2e)', { concurrency: false }, () => {
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
    await clearCommunityFixtures();
  });

  void beforeEach(async () => {
    await clearCommunityFixtures();
  });

  void after(async () => {
    try {
      await clearCommunityFixtures();
      await app?.close();
    } finally {
      for (const [name, value] of Object.entries(originalRuntimeEnvironment)) {
        restoreEnvironmentValue(name, value);
      }
    }
  });

  void test('public counts and lazy voters; concurrent uniqueness, independent options and owner isolation', async () => {
    const first = await createActor();
    const second = await createActor();
    const fish = await createFish(1);
    const publicPath = `/api/v1/catalog/fish/${fish.id}/community-marks`;
    const ownPath = `/api/v1/me/fish/${fish.id}/community-marks`;
    await api().get(ownPath).expect(401);
    await api().post(`${ownPath}/BOTTOM`).set('Origin', WEB_ORIGIN).expect(401);
    assert.equal(
      ((await api().get(publicPath).expect(200)).body as CountsResponse).items.length,
      7,
    );
    const add = (cookie: string, mark: string) =>
      api().post(`${ownPath}/${mark}`).set('Origin', WEB_ORIGIN).set('Cookie', cookie).expect(204);
    await Promise.all([
      add(first.cookie, 'BOTTOM'),
      add(first.cookie, 'BOTTOM'),
      add(first.cookie, 'BOTTOM'),
    ]);
    await add(first.cookie, 'FLY');
    await add(first.cookie, 'NIGHT');
    await add(second.cookie, 'BOTTOM');
    assert.equal(
      await prisma.fishCommunityVote.count({
        where: { fishId: fish.id, userId: first.userId, mark: 'BOTTOM' },
      }),
      1,
    );
    // Ограничение проверяется непосредственно в PostgreSQL, а не только через идемпотентный API.
    await assert.rejects(
      prisma.fishCommunityVote.create({
        data: { fishId: fish.id, userId: first.userId, mark: 'BOTTOM' },
      }),
    );
    const counts = ((await api().get(publicPath).expect(200)).body as CountsResponse).items;
    assert.equal(counts.find((item) => item.mark === 'BOTTOM')?.count, 2);
    assert.deepEqual((await api().get(ownPath).set('Cookie', second.cookie).expect(200)).body, {
      items: [{ mark: 'BOTTOM' }],
    });
    const voters = (await api().get(`${publicPath}/BOTTOM/voters`).expect(200))
      .body as VotersResponse;
    assert.equal(voters.items.length, 2);
    assert.deepEqual(
      voters.items.map((item: object) => Object.keys(item)),
      [['nickname'], ['nickname']],
    );
    assert.equal(voters.nextCursor, null);
    // Переданный userId не используется: голос всегда относится к actor из cookie.
    await api()
      .post(`${ownPath}/DAY`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', first.cookie)
      .send({ userId: second.userId })
      .expect(204);
    assert.equal(
      await prisma.fishCommunityVote.count({
        where: { fishId: fish.id, mark: 'DAY', userId: first.userId },
      }),
      1,
    );
    assert.equal(
      await prisma.fishCommunityVote.count({
        where: { fishId: fish.id, mark: 'DAY', userId: second.userId },
      }),
      0,
    );
    await api()
      .delete(`${ownPath}/BOTTOM`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', first.cookie)
      .expect(204);
    await api()
      .delete(`${ownPath}/BOTTOM`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', first.cookie)
      .expect(204);
    assert.equal(
      await prisma.fishCommunityVote.count({
        where: { fishId: fish.id, mark: 'BOTTOM', userId: second.userId },
      }),
      1,
    );
  });

  void test('blocks banned writes, validates marks and Fish, preserves public and own reads', async () => {
    const actor = await createActor();
    const fish = await createFish(2);
    const path = `/api/v1/me/fish/${fish.id}/community-marks`;
    await api()
      .post(`${path}/UNKNOWN`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', actor.cookie)
      .expect(400);
    await api()
      .post(`/api/v1/me/fish/${randomUUID()}/community-marks/DAY`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', actor.cookie)
      .expect(404);
    await prisma.user.update({ where: { id: actor.userId }, data: { isBanned: true } });
    await api().get(path).set('Cookie', actor.cookie).expect(200);
    await api()
      .post(`${path}/DAY`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', actor.cookie)
      .expect(403);
    await api()
      .delete(`${path}/DAY`)
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', actor.cookie)
      .expect(403);
    await api()
      .get(`/api/v1/catalog/fish/${fish.id}/community-marks/DAY/voters?after=bad`)
      .expect(400);
    await prisma.fish.update({ where: { id: fish.id }, data: { isActive: false } });
    await api().get(`/api/v1/catalog/fish/${fish.id}/community-marks`).expect(404);
  });

  void test('paginates voters without exposing profiles', async () => {
    const fish = await createFish(3);
    for (let index = 0; index < 52; index++) {
      const actor = await createActor();
      await prisma.fishCommunityVote.create({
        data: { fishId: fish.id, userId: actor.userId, mark: 'ALL_DAY' },
      });
    }
    const path = `/api/v1/catalog/fish/${fish.id}/community-marks/ALL_DAY/voters`;
    const first = (await api().get(path).expect(200)).body as VotersResponse;
    assert.equal(first.items.length, 50);
    const second = (await api().get(path).query({ after: first.nextCursor }).expect(200))
      .body as VotersResponse;
    assert.equal(second.items.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.items, ...second.items].map((item: { nickname: string }) => item.nickname))
        .size,
      52,
    );
  });
  void test('size OR retrieval presence combines with other row filters and paginates', async () => {
    const actor = await createActor();
    const fish = await createFish(5);
    const base = await prisma.fishingBase.create({
      data: { name: 'Проверка проводки', nameNormalized: `${TEST_FISH_PREFIX}spinning-base` },
    });
    const location = await prisma.location.create({
      data: {
        fishingBaseId: base.id,
        number: 1,
        name: 'Проверка',
        nameNormalized: `${TEST_FISH_PREFIX}spinning-location`,
      },
    });
    const baits = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        prisma.bait.create({
          data: {
            name: `Приманка ${index}`,
            nameNormalized: `${TEST_FISH_PREFIX}spinning-bait-${index}`,
            type: 'LURE',
          },
        }),
      ),
    );
    const common = {
      userId: actor.userId,
      contributorKey: `local-user:${actor.userId}`,
      fishId: fish.id,
      locationId: location.id,
      weightGrams: 100,
      fishingMethod: 'SPINNING' as const,
    };
    await prisma.catchReport.createMany({
      data: [
        {
          ...common,
          baitId: baits[0].id,
          spinningSize: 'SMALL',
          userNoteRaw: 'Комментарий',
          holeDepthCm: 600,
        },
        { ...common, baitId: baits[0].id },
        { ...common, baitId: baits[1].id, spinningSpeed: 'SLOW', userNoteRaw: 'Комментарий' },
        {
          ...common,
          baitId: baits[2].id,
          spinningSize: 'LARGE',
          spinningSpeed: 'FAST',
          spotPositionRaw: 'справа',
        },
        { ...common, baitId: baits[3].id, userNoteRaw: 'Комментарий', holeDepthCm: 600 },
        // Записи без размера и проводки не включают фильтр независимо от метода.
        { ...common, baitId: baits[4].id, fishingMethod: 'BAIT_FISHING' },
      ],
    });
    const endpoint = '/api/v1/catch-reports/statistics/fish-catches';
    const read = async (query: object) =>
      (
        await api()
          .get(endpoint)
          .query({ fishId: fish.id, ...query })
          .expect(200)
      ).body as AggregateResponse;
    const all = await read({ hasSpinning: true });
    assert.equal(all.items.length, 3);
    assert.deepEqual(
      new Set(all.items.map((item) => item.bait.id)),
      new Set(baits.slice(0, 3).map((bait) => bait.id)),
    );
    assert.equal(all.items.find((item) => item.bait.id === baits[0].id)?.intensity, 2);
    assert.equal((await read({ hasSpinning: true, hasComment: true })).items.length, 2);
    assert.equal((await read({ hasSpinning: true, hasHole: true })).items.length, 2);
    assert.deepEqual(
      (await read({ hasSpinning: true, hasComment: true, hasHole: true })).items.map(
        (item) => item.bait.id,
      ),
      [baits[0].id],
    );
    assert.equal((await read({ hasSpinning: false })).items.length, 5);
    for (const orderMode of ['catches', 'places']) {
      const seen: unknown[] = [];
      let cursor: string | null = null;
      do {
        const page = await read({
          hasSpinning: true,
          orderMode,
          limit: 1,
          ...(cursor ? { cursor } : {}),
        });
        seen.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(seen, (await read({ hasSpinning: true, orderMode, limit: 100 })).items);
    }
    await api().get(endpoint).query({ fishId: fish.id, hasSpinning: 'yes' }).expect(400);
  });

  void test('global row counts and original place order paginate correctly with AND filters and lazy values', async () => {
    const actor = await createActor();
    const fish = await createFish(4);
    const baseA = await prisma.fishingBase.create({
      data: { name: 'А База', nameNormalized: `${TEST_FISH_PREFIX}base-a` },
    });
    const baseZ = await prisma.fishingBase.create({
      data: { name: 'Я База', nameNormalized: `${TEST_FISH_PREFIX}base-z` },
    });
    const locationA = await prisma.location.create({
      data: {
        fishingBaseId: baseA.id,
        number: 1,
        name: 'А',
        nameNormalized: `${TEST_FISH_PREFIX}loc-a`,
      },
    });
    const locationZ = await prisma.location.create({
      data: {
        fishingBaseId: baseZ.id,
        number: 1,
        name: 'Я',
        nameNormalized: `${TEST_FISH_PREFIX}loc-z`,
      },
    });
    const baitA = await prisma.bait.create({
      data: { name: 'А Наживка', nameNormalized: `${TEST_FISH_PREFIX}bait-a`, type: 'BAIT' },
    });
    const baitZ = await prisma.bait.create({
      data: { name: 'Я Наживка', nameNormalized: `${TEST_FISH_PREFIX}bait-z`, type: 'BAIT' },
    });
    const common = {
      userId: actor.userId,
      contributorKey: `local-user:${actor.userId}`,
      fishId: fish.id,
      weightGrams: 100,
      fishingMethod: 'BAIT_FISHING' as const,
      rawSourceText: 'PRIVATE',
    };
    await prisma.catchReport.createMany({
      data: [
        ...Array.from({ length: 4 }, () => ({
          ...common,
          locationId: locationA.id,
          baitId: baitA.id,
          userNoteRaw: '  Комментарий  ',
          holeDepthCm: 600,
        })),
        {
          ...common,
          locationId: locationA.id,
          baitId: baitZ.id,
          userNoteRaw: 'Первый',
          spotPositionRaw: 'справа',
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          ...common,
          locationId: locationZ.id,
          baitId: baitZ.id,
          userNoteRaw: index === 0 ? 'Второй' : null,
          holeDepthCm: index === 0 ? 763 : null,
        })),
      ],
    });
    const endpoint = '/api/v1/catch-reports/statistics/fish-catches';
    const read = async (query: object) =>
      (
        await api()
          .get(endpoint)
          .query({ fishId: fish.id, ...query })
          .expect(200)
      ).body as AggregateResponse;
    const full = await read({ limit: 100 });
    assert.deepEqual(
      full.items.map((item: { bait: { id: string }; intensity: number }) => [
        item.bait.id,
        item.intensity,
      ]),
      [
        [baitZ.id, 6],
        [baitA.id, 4],
        [baitZ.id, 1],
      ],
    );
    const selected = await read({ baseIds: baseA.id });
    assert.deepEqual(
      selected.items.map((item: { bait: { id: string } }) => item.bait.id),
      [baitA.id, baitZ.id],
    );
    const ascending = await read({ intensityOrder: 'asc' });
    assert.deepEqual(
      ascending.items.map((item: { intensity: number }) => item.intensity),
      [1, 4, 6],
    );
    const places = await read({ orderMode: 'places', limit: 100 });
    assert.deepEqual(
      places.items.map((item) => item.intensity),
      [4, 1, 6],
    );
    for (const orderMode of ['catches', 'places'])
      for (const intensityOrder of ['asc', 'desc']) {
        let cursor: string | null = null;
        const items: unknown[] = [];
        do {
          const page = await read({
            orderMode,
            intensityOrder,
            limit: 1,
            ...(cursor ? { cursor } : {}),
          });
          items.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);
        assert.deepEqual(items, (await read({ orderMode, intensityOrder, limit: 100 })).items);
      }
    const firstCatch = await read({ orderMode: 'catches', limit: 1 });
    await api()
      .get(endpoint)
      .query({ fishId: fish.id, orderMode: 'places', cursor: firstCatch.nextCursor })
      .expect(400);
    await prisma.catchReport.updateMany({
      where: { locationId: locationZ.id },
      data: { holeDepthCm: null, spotPositionRaw: null },
    });
    assert.equal((await read({ hasComment: true })).items.length, 3);
    assert.equal((await read({ hasHole: true })).items.length, 2);
    assert.equal((await read({ hasComment: true, hasHole: true })).items.length, 2);
    assert.deepEqual(
      (await read({ hasComment: true, hasHole: true })).items.map(
        (item: { intensity: number }) => item.intensity,
      ),
      [4, 1],
    );
    await api().get(endpoint).query({ fishId: fish.id, hasComment: 'yes' }).expect(400);
    const values = `${endpoint}/values`;
    const comments = (
      await api()
        .get(values)
        .query({ fishId: fish.id, locationId: locationA.id, baitId: baitA.id, field: 'comment' })
        .expect(200)
    ).body as unknown;
    assert.deepEqual(comments, { items: [{ value: '  Комментарий  ' }], nextOffset: null });
    const holes = (
      await api()
        .get(values)
        .query({ fishId: fish.id, locationId: locationZ.id, baitId: baitZ.id, field: 'hole' })
        .expect(200)
    ).body as unknown;
    assert.deepEqual(holes, { items: [], nextOffset: null });
    const aHoles = (
      await api()
        .get(values)
        .query({ fishId: fish.id, locationId: locationA.id, baitId: baitZ.id, field: 'hole' })
        .expect(200)
    ).body as unknown;
    assert.deepEqual(aHoles, {
      items: [{ holeDepthCm: null, spotPositionRaw: 'справа' }],
      nextOffset: null,
    });
    await prisma.catchReport.createMany({
      data: Array.from({ length: 26 }, (_, index) => ({
        ...common,
        locationId: locationA.id,
        baitId: baitA.id,
        holeDepthCm: 700 + index,
        spotPositionRaw: `точка ${index}`,
        userNoteRaw: `комментарий ${index}`,
      })),
    });
    for (const field of ['comment', 'hole']) {
      const scope = { fishId: fish.id, locationId: locationA.id, baitId: baitA.id, field };
      const firstValues = (await api().get(values).query(scope).expect(200)).body as {
        items: unknown[];
        nextOffset: number | null;
      };
      assert.equal(firstValues.items.length, 25);
      assert.equal(firstValues.nextOffset, 25);
      const secondValues = (
        await api()
          .get(values)
          .query({ ...scope, offset: firstValues.nextOffset })
          .expect(200)
      ).body as { items: unknown[]; nextOffset: number | null };
      assert.equal(secondValues.items.length, 2);
      assert.equal(secondValues.nextOffset, null);
      assert.equal(
        new Set([...firstValues.items, ...secondValues.items].map((item) => JSON.stringify(item)))
          .size,
        27,
      );
    }
    assert.ok(!JSON.stringify(full).includes('PRIVATE'));
    // План содержит ровно один доступ к CatchReport; число строки считается единственным GROUP BY.
    const { buildFishCatchAggregatesQuery } =
      await import('../src/catch-reports/fish-catch-aggregates.service.js');
    const { Prisma } = await import('../src/generated/prisma/client.js');
    const plan = await prisma.$queryRaw<{ 'QUERY PLAN': unknown }[]>(
      Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${buildFishCatchAggregatesQuery(fish.id, [baseA.id], 20)}`,
    );
    const serialized = JSON.stringify(plan);
    assert.equal((serialized.match(/"Relation Name":"CatchReport"/g) ?? []).length, 1);
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>(
      Prisma.sql`SELECT indexname FROM pg_indexes WHERE tablename = 'CatchReport' AND indexname = 'CatchReport_fishId_idx'`,
    );
    assert.equal(indexes.length, 1);
    const summary = plan[0]['QUERY PLAN'] as { 'Execution Time': number }[];
    console.log(
      'Fish aggregate EXPLAIN: one CatchReport scan; execution ms:',
      summary[0]['Execution Time'],
    );
  });
});
