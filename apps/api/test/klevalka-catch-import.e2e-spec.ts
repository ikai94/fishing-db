import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { normalizeCatalogName } from '../src/catalog/catalog-normalization.js';
import {
  importKlevalkaCatchRelease,
  KlevalkaCatchImportError,
} from '../src/klevalka-catch-import/klevalka-catch-importer.js';
import { loadCurrentKlevalkaCatalog } from '../src/klevalka-catch-generator/generate-klevalka-catches.js';
import { catalogSha256 } from '../src/klevalka-catch-generator/review-klevalka-snapshots.js';
import { nativeContributorKey } from '../src/catch-reports/catch-report-identity.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const BASE_NAMES = ['Кроноцкий залив', 'Саргассово море', 'ЮАР'] as const;

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

let prisma: PrismaClient;
let configuration: TestDatabaseConfiguration;
let releaseRoot: string | undefined;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function clearDatabase(): Promise<void> {
  await prisma.catchImportRun.deleteMany();
  await clearTestData(configuration, {
    truncateActivityEvents: () =>
      prisma.$executeRawUnsafe('TRUNCATE TABLE "ActivityEvent" RESTART IDENTITY'),
    deleteCatchReports: async () => prisma.catchReport.deleteMany(),
    deleteFishingBaseFish: async () => prisma.fishingBaseFish.deleteMany(),
    deleteLocations: async () => prisma.location.deleteMany(),
    deleteFishingBases: async () => prisma.fishingBase.deleteMany(),
    deleteFish: async () => prisma.fish.deleteMany(),
    deleteBaits: async () => prisma.bait.deleteMany(),
    deleteScreenAnchors: async () => prisma.screenAnchor.deleteMany(),
    deleteSessions: async () => prisma.session.deleteMany(),
    deleteUsers: async () => prisma.user.deleteMany(),
  });
}

async function createFixture(): Promise<{
  userId: string;
  releasePath: string;
  releaseSha256: string;
  lines: string[];
  baseIds: Map<string, string>;
  fishId: string;
}> {
  const user = await prisma.user.create({
    data: {
      email: 'klevalka-native-owner@example.ru',
      nickname: 'admin',
      nicknameNormalized: 'admin',
      passwordHash: 'not-a-real-password-hash',
      role: 'USER',
      emailVerifiedAt: new Date(),
    },
  });
  const bases = await Promise.all(
    BASE_NAMES.map((name) => prisma.fishingBase.create({ data: normalizeCatalogName(name) })),
  );
  const baseIds = new Map(bases.map((base) => [base.name, base.id]));
  const location = await prisma.location.create({
    data: {
      fishingBaseId: bases[0].id,
      number: 1,
      ...normalizeCatalogName('Тестовая точка'),
    },
  });
  const fish = await prisma.fish.create({
    data: normalizeCatalogName('Кит синий северный'),
  });
  await prisma.bait.create({
    data: { ...normalizeCatalogName('Червь'), type: 'BAIT' },
  });
  const originalCatalogSha256 = catalogSha256(await loadCurrentKlevalkaCatalog(prisma));
  const lines = [
    'Кит синий северный 1,000 кг. Поймана на Кроноцкий залив: Тестовая точка, Червь.',
    'Кит синий северный 1,000 кг. Поймана на Кроноцкий залив: Тестовая точка, Червь.',
    'Кит синий северный 999 грамм. Поймана на Кроноцкий залив: Тестовая точка, Червь.',
  ];
  const content = `${lines.join('\n')}\n`;
  const filePath = 'catches/test.part-0001.txt';
  const descriptor = {
    schemaVersion: 1,
    releaseKind: 'KLEVALKA_CATCH_TXT',
    catalogSha256: originalCatalogSha256,
    output: { lines: lines.length, files: 1, bytes: Buffer.byteLength(content) },
    files: [
      {
        path: filePath,
        sha256: sha256(content),
        bytes: Buffer.byteLength(content),
        lines: lines.length,
        fishingBaseId: location.fishingBaseId,
        fishingBaseName: BASE_NAMES[0],
      },
    ],
  };
  const releaseSha256 = sha256(stableJson(descriptor));
  releaseRoot = await mkdtemp(join(tmpdir(), 'klevalka-import-test-'));
  await mkdir(join(releaseRoot, 'catches'));
  await writeFile(join(releaseRoot, filePath), content, 'utf8');
  await writeFile(
    join(releaseRoot, 'manifest.json'),
    stableJson({ ...descriptor, releaseSha256 }),
    'utf8',
  );
  return {
    userId: user.id,
    releasePath: releaseRoot,
    releaseSha256,
    lines,
    baseIds,
    fishId: fish.id,
  };
}

void describe(
  'Klevalka CatchReport import checkpoint (PostgreSQL e2e)',
  { concurrency: false },
  () => {
    void before(async () => {
      configuration = getTestDatabaseConfiguration(process.env);
      prisma = new PrismaClient({ adapter: createPrismaAdapter(configuration.testDatabaseUrl) });
      await clearDatabase();
    });

    void beforeEach(async () => {
      if (releaseRoot !== undefined) await rm(releaseRoot, { recursive: true, force: true });
      releaseRoot = undefined;
      await clearDatabase();
    });

    void after(async () => {
      try {
        if (releaseRoot !== undefined) await rm(releaseRoot, { recursive: true, force: true });
        await clearDatabase();
      } finally {
        await prisma.$disconnect();
      }
    });

    void test('atomically resumes native exact-source batches and creates no activity', async () => {
      const fixture = await createFixture();
      const kronotskyId = fixture.baseIds.get('Кроноцкий залив');
      assert.ok(kronotskyId);
      await prisma.fishingBaseFish.create({
        data: { fishingBaseId: kronotskyId, fishId: fixture.fishId },
      });
      const options = {
        releasePath: fixture.releasePath,
        targetUserId: fixture.userId,
        expectedReleaseSha256: fixture.releaseSha256,
        expectedLines: fixture.lines.length,
        batchSize: 2,
      };

      const first = await importKlevalkaCatchRelease(prisma, { ...options, maxBatches: 1 });
      assert.equal(first.status, 'RUNNING');
      assert.equal(first.insertedThisRun, 2);
      assert.equal(first.committedReports, 2);
      const checkpoint = await prisma.catchImportRun.findUniqueOrThrow({
        where: { releaseSha256: fixture.releaseSha256 },
      });
      assert.equal(checkpoint.nextFileIndex, 0);
      assert.equal(checkpoint.nextLineNumber, 3);
      assert.equal(checkpoint.targetUserId, fixture.userId);
      assert.equal(await prisma.fishingBaseFish.count({ where: { fishId: fixture.fishId } }), 3);

      const firstRows = await prisma.catchReport.findMany({ orderBy: { createdAt: 'asc' } });
      assert.equal(firstRows.length, 2);
      assert.ok(firstRows.every((row) => row.userId === fixture.userId));
      assert.ok(
        firstRows.every((row) => row.contributorKey === nativeContributorKey(fixture.userId)),
      );
      assert.ok(firstRows.every((row) => row.importKey === null));
      assert.deepEqual(
        firstRows.map((row) => row.rawSourceText),
        fixture.lines.slice(0, 2),
      );
      assert.equal(await prisma.activityEvent.count(), 0);

      const yuarId = fixture.baseIds.get('ЮАР');
      assert.ok(yuarId);
      await prisma.fishingBaseFish.delete({
        where: { fishingBaseId_fishId: { fishingBaseId: yuarId, fishId: fixture.fishId } },
      });
      await assert.rejects(
        importKlevalkaCatchRelease(prisma, options),
        (error: unknown) =>
          error instanceof KlevalkaCatchImportError && error.code === 'CATALOG_CHANGED',
      );
      assert.equal(await prisma.catchReport.count(), 2);
      assert.equal(
        (
          await prisma.catchImportRun.findUniqueOrThrow({
            where: { releaseSha256: fixture.releaseSha256 },
          })
        ).nextLineNumber,
        3,
      );
      await prisma.fishingBaseFish.create({
        data: { fishingBaseId: yuarId, fishId: fixture.fishId },
      });

      const resumed = await importKlevalkaCatchRelease(prisma, options);
      assert.equal(resumed.status, 'COMPLETE');
      assert.equal(resumed.insertedThisRun, 1);
      assert.equal(resumed.committedReports, fixture.lines.length);
      const allRows = await prisma.catchReport.findMany({
        orderBy: [{ weightGrams: 'desc' }, { id: 'asc' }],
      });
      assert.equal(allRows.length, fixture.lines.length);
      assert.deepEqual(allRows.map((row) => row.rawSourceText).sort(), [...fixture.lines].sort());
      assert.equal(await prisma.activityEvent.count(), 0);

      const repeated = await importKlevalkaCatchRelease(prisma, options);
      assert.equal(repeated.status, 'COMPLETE');
      assert.equal(repeated.insertedThisRun, 0);
      assert.equal(await prisma.catchReport.count(), fixture.lines.length);
      assert.equal(await prisma.catchImportRun.count(), 1);
    });

    void test('serializes competing workers through one checkpoint without duplicates', async () => {
      const fixture = await createFixture();
      const options = {
        releasePath: fixture.releasePath,
        targetUserId: fixture.userId,
        expectedReleaseSha256: fixture.releaseSha256,
        expectedLines: fixture.lines.length,
        batchSize: 2,
        maxBatches: 1,
      };

      const results = await Promise.all([
        importKlevalkaCatchRelease(prisma, options),
        importKlevalkaCatchRelease(prisma, options),
      ]);

      assert.equal(
        results.reduce((count, result) => count + result.insertedThisRun, 0),
        fixture.lines.length,
      );
      assert.equal(await prisma.catchReport.count(), fixture.lines.length);
      assert.equal(await prisma.catchImportRun.count(), 1);
      const checkpoint = await prisma.catchImportRun.findUniqueOrThrow({
        where: { releaseSha256: fixture.releaseSha256 },
      });
      assert.equal(checkpoint.status, 'COMPLETE');
      assert.equal(checkpoint.nextFileIndex, 1);
      assert.equal(checkpoint.nextLineNumber, 1);
      assert.equal(checkpoint.committedReports, fixture.lines.length);
    });

    void test('rejects an administrative account before creating checkpoint or prerequisites', async () => {
      const fixture = await createFixture();
      await prisma.user.update({ where: { id: fixture.userId }, data: { role: 'ADMIN' } });

      await assert.rejects(
        importKlevalkaCatchRelease(prisma, {
          releasePath: fixture.releasePath,
          targetUserId: fixture.userId,
          expectedReleaseSha256: fixture.releaseSha256,
          expectedLines: fixture.lines.length,
        }),
        (error: unknown) =>
          error instanceof KlevalkaCatchImportError && error.code === 'TARGET_USER_INVALID',
      );
      assert.equal(await prisma.catchImportRun.count(), 0);
      assert.equal(await prisma.fishingBaseFish.count(), 0);
      assert.equal(await prisma.catchReport.count(), 0);
    });
  },
);
