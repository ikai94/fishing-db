import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from 'dotenv';
import request from 'supertest';
import { Client } from 'pg';
import { hashSessionToken } from '../src/auth/session.service.js';
import { getTestDatabaseConfiguration } from './database.js';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
config({ path: `${apiDirectory}/.env`, quiet: true });
config({ path: `${apiDirectory}/test/.env`, quiet: true });
const database = getTestDatabaseConfiguration(process.env);
const previousEnvironment = { ...process.env };
const baseId = randomUUID();
const otherBaseId = randomUUID();
const fishIds = [randomUUID(), randomUUID(), randomUUID()];
const baitId = randomUUID();
const userIds: string[] = [];
const cookies: Record<string, string> = {};
let app: INestApplication;
let server: Server;
let prisma: import('../src/prisma/prisma.service.js').PrismaService;

before(async () => {
  process.env.DATABASE_URL = database.testDatabaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  process.env.FISH_IMAGE_DELIVERY_MODE = 'disabled';
  process.env.BAIT_IMAGE_DELIVERY_MODE = 'disabled';
  const [{ AppModule }, { configureApplication }, { PrismaService }] = await Promise.all([
    import('../src/app.module.js'),
    import('../src/app.setup.js'),
    import('../src/prisma/prisma.service.js'),
  ]);
  app = await NestFactory.create(AppModule, { logger: false });
  configureApplication(app);
  await app.init();
  server = app.getHttpServer() as Server;
  prisma = app.get(PrismaService);
  for (const [kind, role, isBanned, verified] of [
    ['admin', 'ADMIN', false, true],
    ['user', 'USER', false, true],
    ['banned', 'ADMIN', true, true],
    ['unverified', 'ADMIN', false, false],
    ['otherAdmin', 'ADMIN', false, true],
  ] as const) {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.ru`,
        nickname: id.slice(0, 16),
        nicknameNormalized: id.slice(0, 32),
        passwordHash: 'unused',
        role,
        isBanned,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    const token = randomBytes(32).toString('base64url');
    await prisma.session.create({
      data: {
        userId: id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cookies[kind] = `fishing_session=${token}`;
  }
  await prisma.fishingBase.createMany({
    data: [baseId, otherBaseId].map((id) => ({
      id,
      name: id,
      nameNormalized: id,
      isActive: false,
    })),
  });
  await prisma.fish.createMany({
    data: fishIds.map((id, index) => ({
      id,
      name: `Рыба ${index}`,
      isRarest: index === 0,
      isNightBiting: index === 0,
      nameNormalized: id,
      isActive: false,
    })),
  });
  await prisma.bait.create({
    data: { id: baitId, name: baitId, nameNormalized: baitId, type: 'BAIT' },
  });
  await prisma.fishingBaseFish.createMany({
    data: [
      { fishingBaseId: baseId, fishId: fishIds[0], minWeightGrams: 123, maxWeightGrams: 456 },
      { fishingBaseId: baseId, fishId: fishIds[1] },
    ],
  });
  for (const [number, count] of [
    [5, 2],
    [4, 2],
    [2, 2],
    [1, 3],
  ] as const) {
    const location = await prisma.location.create({
      data: {
        fishingBaseId: baseId,
        number,
        name: `Локация ${number}`,
        nameNormalized: `локация ${number}`,
        isActive: false,
      },
    });
    await prisma.catchReport.createMany({
      data: Array.from({ length: count }, () => ({
        userId: userIds[2],
        contributorKey: 'same-contributor',
        locationId: location.id,
        fishId: fishIds[0],
        baitId,
        weightGrams: 999,
        fishingMethod: 'BAIT_FISHING' as const,
        rawSourceText: 'PRIVATE_SOURCE',
        userNoteRaw: 'PRIVATE_COMMENT',
      })),
    });
    // Рыба без текущей связи с базой не добавляет строку блокнота.
    await prisma.catchReport.create({
      data: {
        userId: userIds[0],
        contributorKey: 'other',
        locationId: location.id,
        fishId: fishIds[2],
        baitId,
        weightGrams: 999,
        fishingMethod: 'BAIT_FISHING',
      },
    });
  }
  const outside = await prisma.location.create({
    data: {
      fishingBaseId: otherBaseId,
      number: 1,
      name: 'Другая база',
      nameNormalized: 'другая база',
    },
  });
  await prisma.catchReport.createMany({
    data: Array.from({ length: 10 }, () => ({
      userId: userIds[0],
      contributorKey: 'outside',
      locationId: outside.id,
      fishId: fishIds[0],
      baitId,
      weightGrams: 999,
      fishingMethod: 'BAIT_FISHING' as const,
    })),
  });
});

after(async () => {
  try {
    if (prisma) {
      // Удаляем только собственные фикстуры и повторяем защиту отдельной тестовой БД.
      getTestDatabaseConfiguration({
        DATABASE_URL: database.developmentDatabaseUrl,
        TEST_DATABASE_URL: database.testDatabaseUrl,
      });
      await prisma.catchReport.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.fishingBaseFish.deleteMany({ where: { fishingBaseId: baseId } });
      await prisma.location.deleteMany({ where: { fishingBaseId: { in: [baseId, otherBaseId] } } });
      await prisma.fishingBase.deleteMany({ where: { id: { in: [baseId, otherBaseId] } } });
      await prisma.fish.deleteMany({ where: { id: { in: fishIds } } });
      await prisma.bait.deleteMany({ where: { id: baitId } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app?.close();
  } finally {
    for (const key of [
      'DATABASE_URL',
      'NODE_ENV',
      'WEB_ORIGIN',
      'FISH_IMAGE_DELIVERY_MODE',
      'BAIT_IMAGE_DELIVERY_MODE',
    ]) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
  }
});

void test('browser notebook PUT preflight allows credentials only from the configured web origin', async () => {
  const path = `/api/v1/admin/catalog/bases/${baseId}/notebook/fish/${fishIds[0]}`;
  const preflight = await request(server)
    .options(path)
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'PUT')
    .set('Access-Control-Request-Headers', 'content-type')
    .expect(204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
  assert.ok(preflight.headers['access-control-allow-methods'].split(',').includes('PUT'));
  assert.equal(preflight.headers['access-control-allow-headers'].toLowerCase(), 'content-type');
  const untrusted = await request(server)
    .options(path)
    .set('Origin', 'https://untrusted.example')
    .set('Access-Control-Request-Method', 'PUT')
    .set('Access-Control-Request-Headers', 'content-type')
    .expect(204);
  assert.equal(untrusted.headers['access-control-allow-origin'], undefined);
  // Успешный preflight разрешает транспорт, но не заменяет cookie, ADMIN-роль и проверку владельца.
  await request(server)
    .put(path)
    .set('Origin', 'http://localhost:3000')
    .send({ noteText: 'unauthorized' })
    .expect(401);
});

void test('direct notebook API denies guest, USER, banned ADMIN and unverified ADMIN', async () => {
  const path = `/api/v1/admin/catalog/bases/${baseId}/notebook`;
  await request(server).get(path).expect(401);
  for (const [kind, status, code] of [
    ['user', 403, 'ADMIN_REQUIRED'],
    ['banned', 403, 'ACCOUNT_BANNED'],
    ['unverified', 401, 'AUTH_REQUIRED'],
  ] as const) {
    const response = await request(server).get(path).set('Cookie', cookies[kind]).expect(status);
    assert.equal((response.body as { code: string }).code, code);
    assert.equal(JSON.stringify(response.body).includes('topLocations'), false);
  }
});

void test('PostgreSQL ranks historical report counts per Base/Fish with stable ties and stored weights', async () => {
  const response = await request(server)
    .get(`/api/v1/admin/catalog/bases/${baseId}/notebook`)
    .set('Cookie', cookies.admin)
    .expect(200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers.vary, 'Cookie');
  const body = response.body as {
    rows: {
      fish: { id: string; isRarest: boolean; isNightBiting: boolean };
      minWeightGrams: number | null;
      maxWeightGrams: number | null;
      totalCatchReports: number;
      isHidden: boolean;
      topLocations: { number: number; reportsCount: number }[];
    }[];
  };
  assert.equal(body.rows.length, 2);
  const populated = body.rows.find((row) => row.fish.id === fishIds[0])!;
  assert.deepEqual(
    populated.topLocations.map(({ number, reportsCount }) => [number, reportsCount]),
    [
      [1, 3],
      [2, 2],
      [4, 2],
    ],
  );
  assert.equal(populated.fish.isRarest, true);
  assert.equal(populated.fish.isNightBiting, true);
  assert.equal(populated.minWeightGrams, 123);
  assert.equal(populated.maxWeightGrams, 456);
  assert.equal(populated.totalCatchReports, 9);
  assert.equal(populated.isHidden, false);
  const empty = body.rows.find((row) => row.fish.id === fishIds[1])!;
  assert.equal(empty.fish.isRarest, false);
  assert.equal(empty.fish.isNightBiting, false);
  assert.deepEqual(empty.topLocations, []);
  assert.equal(empty.minWeightGrams, null);
  assert.equal(empty.maxWeightGrams, null);
  assert.equal(empty.totalCatchReports, 0);
  assert.equal(empty.isHidden, false);
  const serialized = JSON.stringify(body);
  for (const field of [
    'contributorKey',
    'importKey',
    'rawSourceText',
    'userNoteRaw',
    'officialFishImageKey',
    'PRIVATE_SOURCE',
    'PRIVATE_COMMENT',
  ])
    assert.equal(serialized.includes(field), false);
  await request(server)
    .get(`/api/v1/admin/catalog/bases/${randomUUID()}/notebook`)
    .set('Cookie', cookies.admin)
    .expect(404);
  await request(server)
    .get('/api/v1/admin/catalog/bases/not-a-uuid/notebook')
    .set('Cookie', cookies.admin)
    .expect(400);
  await request(server).get(`/api/v1/catalog/bases/${baseId}/notebook`).expect(404);
  await request(server)
    .patch(`/api/v1/admin/catalog/bases/${baseId}/notebook`)
    .set('Cookie', cookies.admin)
    .set('Origin', 'http://localhost:3000')
    .send({ note: 'phase 2' })
    .expect(404);
});

/** Отправляет личную заметку от выбранной сессии, без клиентского идентификатора владельца. */
function saveNotes(
  actor: string,
  fields: object,
  fishId: string = fishIds[0],
  fishingBaseId: string = baseId,
) {
  return request(server)
    .put(`/api/v1/admin/catalog/bases/${fishingBaseId}/notebook/fish/${fishId}`)
    .set('Cookie', cookies[actor])
    .set('Origin', 'http://localhost:3000')
    .send(fields);
}

/** Читает личную проекцию через HTTP заново, проверяя сохранение и границу владельца. */
async function readNotes(actor: string) {
  const response = await request(server)
    .get(`/api/v1/admin/catalog/bases/${baseId}/notebook`)
    .set('Cookie', cookies[actor])
    .expect(200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  const row = (
    response.body as {
      rows: { fish: { id: string }; noteText: string | null }[];
    }
  ).rows.find((item) => item.fish.id === fishIds[0]);
  assert.ok(row);
  assert.equal('userId' in row, false);
  return { noteText: row.noteText };
}

void test('personal notes create, edit, clear and persist on reload with complete ADMIN isolation', async () => {
  const empty = { noteText: null };
  const first = { noteText: 'ADMIN_A_PRIVATE\n  строка' };
  const second = { noteText: 'ADMIN_B_PRIVATE' };
  assert.deepEqual(await readNotes('admin'), empty);
  await saveNotes('admin', first)
    .expect(200)
    .then((response) => {
      assert.deepEqual(response.body, { entry: first });
      assert.equal(response.headers['cache-control'], 'private, no-store');
    });
  const created = await prisma.baseFishNotebookEntry.findUniqueOrThrow({
    where: {
      userId_fishingBaseId_fishId: {
        userId: userIds[0],
        fishingBaseId: baseId,
        fishId: fishIds[0],
      },
    },
  });
  assert.deepEqual(await readNotes('admin'), first);
  assert.deepEqual(await readNotes('otherAdmin'), empty);
  await saveNotes('otherAdmin', second).expect(200);
  assert.deepEqual(await readNotes('admin'), first);
  assert.deepEqual(await readNotes('otherAdmin'), second);
  const edited = { noteText: 'ADMIN_A_PRIVATE изменено' };
  await saveNotes('admin', edited).expect(200);
  const updated = await prisma.baseFishNotebookEntry.findUniqueOrThrow({
    where: {
      userId_fishingBaseId_fishId: {
        userId: userIds[0],
        fishingBaseId: baseId,
        fishId: fishIds[0],
      },
    },
  });
  assert.equal(updated.createdAt.getTime(), created.createdAt.getTime());
  assert.ok(updated.updatedAt.getTime() >= created.updatedAt.getTime());
  assert.deepEqual(await readNotes('admin'), edited);
  assert.deepEqual(await readNotes('otherAdmin'), second);
  await saveNotes('admin', { noteText: '' }).expect(200);
  assert.deepEqual(await readNotes('admin'), empty);
  assert.deepEqual(await readNotes('otherAdmin'), second);
  await saveNotes('admin', { noteText: ' \n ' }).expect(200);
  assert.deepEqual(await readNotes('admin'), empty);
  await saveNotes('admin', first).expect(200);
  await saveNotes('admin', empty).expect(200);
  assert.deepEqual(await readNotes('admin'), empty);
  assert.equal(
    await prisma.baseFishNotebookEntry.count({
      where: { fishingBaseId: baseId, fishId: fishIds[0] },
    }),
    2,
  );
  // Запись в другой паре того же ADMIN не меняет первую пару или записи соседа.
  await saveNotes('admin', first, fishIds[1]).expect(200);
  assert.deepEqual(await readNotes('admin'), empty);
  assert.deepEqual(await readNotes('otherAdmin'), second);
});

void test('removal migration refuses non-empty data and otherwise preserves notes, owners and timestamps', async () => {
  const client = new Client({ connectionString: database.testDatabaseUrl });
  await client.connect();
  try {
    // Только временная таблица этой сессии: SQL миграции не затрагивает реальные записи тестовой БД.
    await client.query(
      'CREATE TEMP TABLE "BaseFishNotebookEntry" AS SELECT * FROM public."BaseFishNotebookEntry" WITH NO DATA',
    );
    await client.query('ALTER TABLE pg_temp."BaseFishNotebookEntry" ADD COLUMN "fishingTips" TEXT');
    await client.query(
      `INSERT INTO pg_temp."BaseFishNotebookEntry" ("userId", "fishingBaseId", "fishId", "noteText", "fishingTips", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userIds[0],
        baseId,
        fishIds[0],
        'Сохранить заметку',
        'unexpected',
        new Date('2026-10-01T12:00:00Z'),
        new Date('2026-10-02T12:00:00Z'),
      ],
    );
    const sql = readFileSync(
      `${apiDirectory}/prisma/migrations/20261012130000_remove_notebook_fishing_tips/migration.sql`,
      'utf8',
    );
    await assert.rejects(client.query(sql), /non-empty fishingTips exist/);
    await client.query('ROLLBACK');
    const blocked = await client.query('SELECT "fishingTips" FROM pg_temp."BaseFishNotebookEntry"');
    assert.equal(blocked.rows[0].fishingTips, 'unexpected');
    await client.query('UPDATE pg_temp."BaseFishNotebookEntry" SET "fishingTips" = NULL');
    const before = await client.query(
      'SELECT "userId", "fishingBaseId", "fishId", "noteText", "createdAt", "updatedAt", "isHidden" FROM pg_temp."BaseFishNotebookEntry"',
    );
    await client.query(sql);
    const after = await client.query('SELECT * FROM pg_temp."BaseFishNotebookEntry"');
    assert.deepEqual(after.rows, before.rows);
  } finally {
    await client.end();
  }
});

void test('personal writes reject guests, USER, bans, unverified sessions, spoofing and invalid membership', async () => {
  const fields = { noteText: 'REJECTED' };
  const path = `/api/v1/admin/catalog/bases/${baseId}/notebook/fish/${fishIds[0]}`;
  const before = await prisma.baseFishNotebookEntry.findMany({
    orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
  });
  await request(server).put(path).set('Origin', 'http://localhost:3000').send(fields).expect(401);
  for (const [actor, status] of [
    ['user', 403],
    ['banned', 403],
    ['unverified', 401],
  ] as const)
    await saveNotes(actor, fields).expect(status);
  await request(server)
    .put(path)
    .set('Cookie', cookies.admin)
    .set('Origin', 'https://evil.example')
    .send(fields)
    .expect(403);
  for (const invalid of [
    { ...fields, userId: userIds[4] },
    { ...fields, fishingBaseId: otherBaseId },
    { noteText: 'x'.repeat(5001) },
    { noteText: {} },
    { noteText: 42 },
    {},
  ])
    await saveNotes('admin', invalid).expect(400);
  await saveNotes('admin', fields, fishIds[2]).expect(404);
  await saveNotes('admin', fields, fishIds[0], otherBaseId).expect(404);
  await saveNotes('admin', fields, randomUUID()).expect(404);
  await saveNotes('admin', fields, 'not-a-uuid').expect(400);
  assert.deepEqual(
    await prisma.baseFishNotebookEntry.findMany({
      orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
    }),
    before,
  );
});

void test('migration enforces ownership uniqueness, membership FK and text length without modifying weights', async () => {
  const entry = {
    userId: userIds[0],
    fishingBaseId: baseId,
    fishId: fishIds[0],
    noteText: null,
  };
  await assert.rejects(
    prisma.baseFishNotebookEntry.create({ data: entry }),
    (error: unknown) => (error as { code?: string }).code === 'P2002',
  );
  await assert.rejects(
    prisma.baseFishNotebookEntry.create({ data: { ...entry, fishId: fishIds[2] } }),
    (error: unknown) => (error as { code?: string }).code === 'P2003',
  );
  for (const field of ['noteText'] as const)
    await assert.rejects(
      prisma.baseFishNotebookEntry.update({
        where: {
          userId_fishingBaseId_fishId: {
            userId: entry.userId,
            fishingBaseId: entry.fishingBaseId,
            fishId: entry.fishId,
          },
        },
        data: { [field]: 'x'.repeat(5001) },
      }),
      new RegExp(`BaseFishNotebookEntry_${field}_length_check`),
    );
  const bounds = await prisma.fishingBaseFish.findUniqueOrThrow({
    where: { fishingBaseId_fishId: { fishingBaseId: baseId, fishId: fishIds[0] } },
    select: { minWeightGrams: true, maxWeightGrams: true },
  });
  assert.deepEqual(bounds, { minWeightGrams: 123, maxWeightGrams: 456 });
});

void test('personal fields never enter public catalog or shared ADMIN catalog responses', async () => {
  // Активируем только тестовые строки, чтобы проверять реальные публичные проекции, а не ответы 404.
  await prisma.fishingBase.update({ where: { id: baseId }, data: { isActive: true } });
  await prisma.fish.updateMany({ where: { id: { in: fishIds } }, data: { isActive: true } });
  await prisma.location.updateMany({ where: { fishingBaseId: baseId }, data: { isActive: true } });
  const location = await prisma.location.findFirstOrThrow({ where: { fishingBaseId: baseId } });
  for (const path of [
    `/api/v1/catalog/bases/${baseId}`,
    `/api/v1/catalog/fish/${fishIds[0]}`,
    `/api/v1/catalog/locations/${location.id}`,
    `/api/v1/admin/catalog/bases/${baseId}`,
  ]) {
    const response = await request(server).get(path).set('Cookie', cookies.admin).expect(200);
    const serialized = JSON.stringify(response.body);
    for (const privateValue of [
      'noteText',
      'ADMIN_A_PRIVATE',
      'ADMIN_B_PRIVATE',
      'notebookEntries',
      'isHidden',
    ])
      assert.equal(serialized.includes(privateValue), false);
  }
  await request(server)
    .put(`/api/v1/catalog/bases/${baseId}/notebook/fish/${fishIds[0]}`)
    .set('Origin', 'http://localhost:3000')
    .send({ noteText: 'public' })
    .expect(404);
});

/** Видимость имеет отдельный контракт: тело не содержит ни владельца, ни заметку. */
function setVisibility(
  actor: string,
  fields: object,
  fishId: string = fishIds[0],
  base: string = baseId,
) {
  return request(server)
    .put(`/api/v1/admin/catalog/bases/${base}/notebook/fish/${fishId}/visibility`)
    .set('Cookie', cookies[actor])
    .set('Origin', 'http://localhost:3000')
    .send(fields);
}

/** Новый HTTP GET моделирует перезагрузку страницы, не используя состояние прошлого ответа. */
async function readVisibility(actor: string, fishId = fishIds[0]) {
  const response = await request(server)
    .get(`/api/v1/admin/catalog/bases/${baseId}/notebook`)
    .set('Cookie', cookies[actor])
    .expect(200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  return (
    response.body as {
      rows: { fish: { id: string }; isHidden: boolean; noteText: string | null }[];
    }
  ).rows.find((row) => row.fish.id === fishId)!;
}

void test('hide/restore persists per ADMIN, handles missing entries and never overwrites notes', async () => {
  // У второго ADMIN ещё нет записи для второй рыбы: скрытие создаёт запись без заметки.
  await setVisibility('otherAdmin', { isHidden: true }, fishIds[1]).expect(200);
  assert.equal((await readVisibility('otherAdmin', fishIds[1])).isHidden, true);
  await setVisibility('otherAdmin', { isHidden: false }, fishIds[1]).expect(200);
  assert.equal((await readVisibility('otherAdmin', fishIds[1])).noteText, null);
  await prisma.baseFishNotebookEntry.delete({
    where: {
      userId_fishingBaseId_fishId: {
        userId: userIds[4],
        fishingBaseId: baseId,
        fishId: fishIds[1],
      },
    },
  });
  await setVisibility('otherAdmin', { isHidden: false }, fishIds[1]).expect(200);
  assert.equal((await readVisibility('otherAdmin', fishIds[1])).isHidden, false);
  const before = await readNotes('otherAdmin');
  const hidden = await setVisibility('otherAdmin', { isHidden: true }).expect(200);
  assert.deepEqual(hidden.body, { visibility: { isHidden: true } });
  assert.equal(hidden.headers['cache-control'], 'private, no-store');
  assert.match(hidden.headers.vary, /Cookie/);
  assert.equal((await readVisibility('otherAdmin')).isHidden, true);
  assert.equal((await readVisibility('admin')).isHidden, false);
  assert.deepEqual(await readNotes('otherAdmin'), before);
  await saveNotes('otherAdmin', { noteText: 'Обновлено у скрытой рыбы' }).expect(200);
  assert.equal((await readVisibility('otherAdmin')).isHidden, true);
  // Независимые update не стирают результат друг друга даже при одновременном сохранении.
  await Promise.all([
    saveNotes('otherAdmin', { noteText: 'Параллельная заметка' }).expect(200),
    setVisibility('otherAdmin', { isHidden: false }).expect(200),
  ]);
  const restored = await readVisibility('otherAdmin');
  assert.equal(restored.isHidden, false);
  assert.equal(restored.noteText, 'Параллельная заметка');
  assert.deepEqual(await readNotes('admin'), { noteText: null });
  await setVisibility('otherAdmin', { isHidden: true }, fishIds[1]).expect(200);
  assert.equal((await readVisibility('otherAdmin', fishIds[1])).isHidden, true);
  assert.equal((await readVisibility('admin', fishIds[1])).isHidden, false);
});

void test('visibility rejects unauthorized writes, owner spoofing and invalid Fish/Base membership', async () => {
  const before = await prisma.baseFishNotebookEntry.findMany({
    orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
  });
  const path = `/api/v1/admin/catalog/bases/${baseId}/notebook/fish/${fishIds[0]}/visibility`;
  await request(server)
    .put(path)
    .set('Origin', 'http://localhost:3000')
    .send({ isHidden: true })
    .expect(401);
  for (const [actor, status] of [
    ['user', 403],
    ['banned', 403],
    ['unverified', 401],
  ] as const)
    await setVisibility(actor, { isHidden: true }).expect(status);
  for (const fields of [
    {},
    { isHidden: null },
    { isHidden: 'true' },
    { isHidden: 1 },
    { isHidden: true, userId: userIds[4] },
    { isHidden: false, noteText: 'overwrite' },
  ])
    await setVisibility('admin', fields).expect(400);
  await setVisibility('admin', { isHidden: true }, fishIds[2]).expect(404);
  await setVisibility('admin', { isHidden: true }, fishIds[0], otherBaseId).expect(404);
  await setVisibility('admin', { isHidden: true }, 'not-a-uuid').expect(400);
  await request(server)
    .put(path)
    .set('Cookie', cookies.admin)
    .set('Origin', 'https://evil.example')
    .send({ isHidden: true })
    .expect(403);
  await request(server)
    .put(`/api/v1/catalog/bases/${baseId}/notebook/fish/${fishIds[0]}/visibility`)
    .send({ isHidden: true })
    .expect(404);
  assert.deepEqual(
    await prisma.baseFishNotebookEntry.findMany({
      orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
    }),
    before,
  );
});

void test('visibility migration preserves existing owners, notes and timestamps with a false default', async () => {
  const client = new Client({ connectionString: database.testDatabaseUrl });
  await client.connect();
  try {
    await client.query(
      'CREATE TEMP TABLE "BaseFishNotebookEntry" (LIKE public."BaseFishNotebookEntry" INCLUDING DEFAULTS)',
    );
    await client.query('ALTER TABLE pg_temp."BaseFishNotebookEntry" DROP COLUMN "isHidden"');
    await client.query(
      'INSERT INTO pg_temp."BaseFishNotebookEntry" ("userId", "fishingBaseId", "fishId", "noteText", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [
        userIds[0],
        baseId,
        fishIds[0],
        'Сохранить без изменений',
        new Date('2026-10-01T12:00:00Z'),
        new Date('2026-10-02T12:00:00Z'),
      ],
    );
    const before = await client.query('SELECT * FROM pg_temp."BaseFishNotebookEntry"');
    await client.query(
      readFileSync(
        `${apiDirectory}/prisma/migrations/20261013120000_add_notebook_personal_visibility/migration.sql`,
        'utf8',
      ),
    );
    const after = await client.query('SELECT * FROM pg_temp."BaseFishNotebookEntry"');
    assert.deepEqual(
      after.rows,
      before.rows.map((row) => ({ ...row, isHidden: false })),
    );
    await assert.rejects(
      client.query('UPDATE pg_temp."BaseFishNotebookEntry" SET "isHidden" = NULL'),
      /not-null constraint/,
    );
  } finally {
    await client.end();
  }
});

void test('existing night endpoint persists the global Fish flag across ADMIN notebook reloads without touching personal/catalog data', async () => {
  const fishId = fishIds[0];
  const fishBefore = await prisma.fish.findUniqueOrThrow({ where: { id: fishId } });
  const notesBefore = await prisma.baseFishNotebookEntry.findMany({
    where: { fishingBaseId: baseId },
    orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
  });
  const membershipsBefore = await prisma.fishingBaseFish.findMany({
    where: { fishingBaseId: baseId },
    orderBy: { fishId: 'asc' },
  });
  const catchesBefore = await prisma.catchReport.findMany({
    where: { fishId },
    orderBy: { id: 'asc' },
  });
  for (const [actor, isNightBiting] of [
    ['admin', false],
    ['otherAdmin', true],
    ['admin', true],
  ] as const) {
    const result = await request(server)
      .patch(`/api/v1/admin/records/night-marks/${fishId}`)
      .set('Cookie', cookies[actor])
      .set('Origin', 'http://localhost:3000')
      .send({ isNightBiting })
      .expect(200);
    assert.deepEqual(result.body, { fish: { fishId, isNightBiting } });
    const persisted = await prisma.fish.findUniqueOrThrow({ where: { id: fishId } });
    assert.deepEqual(persisted, { ...fishBefore, isNightBiting, updatedAt: persisted.updatedAt });
    for (const reader of ['admin', 'otherAdmin']) {
      const response = await request(server)
        .get(`/api/v1/admin/catalog/bases/${baseId}/notebook`)
        .set('Cookie', cookies[reader])
        .expect(200);
      const row = (
        response.body as { rows: { fish: { id: string; isNightBiting: boolean } }[] }
      ).rows.find((row) => row.fish.id === fishId)!;
      assert.equal(row.fish.isNightBiting, isNightBiting);
    }
  }
  assert.deepEqual(
    await prisma.baseFishNotebookEntry.findMany({
      where: { fishingBaseId: baseId },
      orderBy: [{ userId: 'asc' }, { fishId: 'asc' }],
    }),
    notesBefore,
  );
  assert.deepEqual(
    await prisma.fishingBaseFish.findMany({
      where: { fishingBaseId: baseId },
      orderBy: { fishId: 'asc' },
    }),
    membershipsBefore,
  );
  assert.deepEqual(
    await prisma.catchReport.findMany({ where: { fishId }, orderBy: { id: 'asc' } }),
    catchesBefore,
  );
});

void test('existing night endpoint blocks guests, USER, bans, unverified sessions, invalid payloads and origins', async () => {
  const path = `/api/v1/admin/records/night-marks/${fishIds[0]}`;
  const before = await prisma.fish.findUniqueOrThrow({ where: { id: fishIds[0] } });
  await request(server)
    .patch(path)
    .set('Origin', 'http://localhost:3000')
    .send({ isNightBiting: false })
    .expect(401);
  for (const [actor, status, code] of [
    ['user', 403, 'ADMIN_REQUIRED'],
    ['banned', 403, 'ACCOUNT_BANNED'],
    ['unverified', 401, 'AUTH_REQUIRED'],
  ] as const) {
    const response = await request(server)
      .patch(path)
      .set('Cookie', cookies[actor])
      .set('Origin', 'http://localhost:3000')
      .send({ isNightBiting: false })
      .expect(status);
    assert.equal((response.body as { code: string }).code, code);
  }
  for (const payload of [
    {},
    { isNightBiting: 'false' },
    { isNightBiting: null },
    { isNightBiting: false, isRarest: false },
    { isNightBiting: false, noteText: 'overwrite' },
    { isNightBiting: false, maxWeightGrams: 1 },
  ])
    await request(server)
      .patch(path)
      .set('Cookie', cookies.admin)
      .set('Origin', 'http://localhost:3000')
      .send(payload)
      .expect(400);
  await request(server)
    .patch(path)
    .set('Cookie', cookies.admin)
    .set('Origin', 'https://evil.example')
    .send({ isNightBiting: false })
    .expect(403);
  await request(server)
    .patch('/api/v1/admin/records/night-marks/not-a-uuid')
    .set('Cookie', cookies.admin)
    .set('Origin', 'http://localhost:3000')
    .send({ isNightBiting: false })
    .expect(400);
  await request(server)
    .patch(`/api/v1/admin/records/night-marks/${randomUUID()}`)
    .set('Cookie', cookies.admin)
    .set('Origin', 'http://localhost:3000')
    .send({ isNightBiting: false })
    .expect(404);
  assert.deepEqual(await prisma.fish.findUniqueOrThrow({ where: { id: fishIds[0] } }), before);
});
