import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { REAL_CATALOG_DATA, decodeFishingCatalog } from '../src/prisma/catalog-seed-data.js';
import { seedCatalog } from '../src/prisma/catalog-seed.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import {
  applyFishingBaseFishReconciliation,
  auditFishingBaseFishReconciliation,
  FishingBaseFishReconciliationError,
} from '../src/prisma/reconcile-fishing-base-fish.js';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const LEGACY_FISHING_CATALOG = decodeFishingCatalog(
  JSON.parse(
    readFileSync(new URL('../prisma/catalog-data/fishing-catalog.json', import.meta.url), 'utf8'),
  ) as unknown,
);

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

interface Pair {
  fishingBaseId: string;
  fishId: string;
}

let prisma: PrismaClient;
let databaseConfiguration: TestDatabaseConfiguration;

function pairKey(pair: Pair): string {
  return `${pair.fishingBaseId}:${pair.fishId}`;
}

async function catalogIds(): Promise<{
  baseByName: Map<string, string>;
  fishByName: Map<string, string>;
}> {
  const [bases, fish] = await Promise.all([
    prisma.fishingBase.findMany({ select: { id: true, name: true } }),
    prisma.fish.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    baseByName: new Map(bases.map((item) => [item.name, item.id] as const)),
    fishByName: new Map(fish.map((item) => [item.name, item.id] as const)),
  };
}

function resolvePairs(
  bases: ReadonlyArray<{ name: string; fish: readonly string[] }>,
  baseByName: ReadonlyMap<string, string>,
  fishByName: ReadonlyMap<string, string>,
): Pair[] {
  return bases.flatMap((base) => {
    const fishingBaseId = baseByName.get(base.name);
    assert.ok(fishingBaseId, `missing test FishingBase ${base.name}`);
    return base.fish.map((fishName) => {
      const fishId = fishByName.get(fishName);
      assert.ok(fishId, `missing test Fish ${fishName}`);
      return { fishingBaseId, fishId };
    });
  });
}

async function prepareApprovedPreState(): Promise<void> {
  await seedCatalog(prisma);
  const { baseByName, fishByName } = await catalogIds();
  const targetPairs = resolvePairs(REAL_CATALOG_DATA.bases, baseByName, fishByName);
  const legacyPairs = resolvePairs(LEGACY_FISHING_CATALOG.bases, baseByName, fishByName);
  const targetKeys = new Set(targetPairs.map(pairKey));
  const legacyKeys = new Set(legacyPairs.map(pairKey));
  const targetOnly = targetPairs.filter((pair) => !legacyKeys.has(pairKey(pair)));
  const legacyOnly = legacyPairs.filter((pair) => !targetKeys.has(pairKey(pair)));

  assert.equal(targetOnly.length, 27);
  assert.equal(legacyOnly.length, 2_166);
  await prisma.fishingBaseFish.deleteMany({
    where: {
      OR: targetOnly.map(({ fishingBaseId, fishId }) => ({ fishingBaseId, fishId })),
    },
  });
  await prisma.fishingBaseFish.createMany({ data: legacyOnly });
  assert.equal(await prisma.fishingBaseFish.count(), 5_369);

  const user = await prisma.user.create({
    data: {
      email: 'reconciliation-e2e@example.ru',
      nickname: 'Reconciliation E2E',
      nicknameNormalized: 'reconciliation e2e',
      passwordHash: 'not-a-real-password-hash',
    },
  });
  const bait = await prisma.bait.findFirstOrThrow({ select: { id: true } });
  const validPair = targetPairs[0];
  const invalidPair = legacyOnly[0];
  assert.ok(validPair);
  assert.ok(invalidPair);
  const [validLocation, invalidLocation] = await Promise.all([
    prisma.location.findFirstOrThrow({
      where: { fishingBaseId: validPair.fishingBaseId },
      select: { id: true },
    }),
    prisma.location.findFirstOrThrow({
      where: { fishingBaseId: invalidPair.fishingBaseId },
      select: { id: true },
    }),
  ]);
  const reports = [
    ...Array.from({ length: 3_191 }, (_, index) => ({
      userId: user.id,
      contributorKey: 'external-member:valid',
      importKey: `reconciliation-valid-${String(index)}`,
      locationId: validLocation.id,
      fishId: validPair.fishId,
      baitId: bait.id,
      weightGrams: 1,
      fishingMethod: 'BAIT_FISHING' as const,
      holeDepthCm: 100,
    })),
    ...Array.from({ length: 161 }, (_, index) => ({
      userId: user.id,
      contributorKey: 'external-member:invalid',
      importKey: `reconciliation-invalid-${String(index)}`,
      locationId: invalidLocation.id,
      fishId: invalidPair.fishId,
      baitId: bait.id,
      weightGrams: 1,
      fishingMethod: 'BAIT_FISHING' as const,
      holeDepthCm: 100,
    })),
    ...Array.from({ length: 3 }, () => ({
      userId: user.id,
      contributorKey: `local-user:${user.id}`,
      importKey: null,
      locationId: validLocation.id,
      fishId: validPair.fishId,
      baitId: bait.id,
      weightGrams: 1,
      fishingMethod: 'BAIT_FISHING' as const,
      holeDepthCm: 100,
    })),
  ];
  await prisma.catchReport.createMany({ data: reports });
  assert.equal(await prisma.catchReport.count(), 3_355);
}

async function relevantCounts(): Promise<Record<string, number>> {
  const [
    fishingBases,
    locations,
    fish,
    baits,
    users,
    screenAnchors,
    fishingBaseFish,
    catchReports,
  ] = await Promise.all([
    prisma.fishingBase.count(),
    prisma.location.count(),
    prisma.fish.count(),
    prisma.bait.count(),
    prisma.user.count(),
    prisma.screenAnchor.count(),
    prisma.fishingBaseFish.count(),
    prisma.catchReport.count(),
  ]);
  return {
    fishingBases,
    locations,
    fish,
    baits,
    users,
    screenAnchors,
    fishingBaseFish,
    catchReports,
  };
}

void describe('FishingBaseFish reconciliation (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    databaseConfiguration = getTestDatabaseConfiguration(process.env);
    prisma = new PrismaClient({
      adapter: createPrismaAdapter(databaseConfiguration.testDatabaseUrl),
    });
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
  });

  void after(async () => {
    try {
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
    } finally {
      await prisma.$disconnect();
    }
  });

  void test('dry-runs without writes, applies atomically, and seed cannot restore removals', async () => {
    await prepareApprovedPreState();
    const beforeDryRun = await relevantCounts();
    const dryRun = await auditFishingBaseFishReconciliation(prisma);

    assert.deepEqual(dryRun.memberships, {
      current: 5_369,
      keep: 3_203,
      add: 27,
      remove: 2_166,
      expectedFinal: 3_230,
    });
    assert.deepEqual(dryRun.catchReports, {
      current: 3_355,
      valid: 3_194,
      invalidImported: 161,
      invalidNative: 0,
      expectedFinal: 3_194,
    });
    assert.equal(dryRun.writesPerformed, false);
    assert.deepEqual(await relevantCounts(), beforeDryRun);

    const applied = await applyFishingBaseFishReconciliation(prisma, dryRun.preStateFingerprint);
    assert.equal(applied.writesPerformed, true);
    assert.deepEqual(await relevantCounts(), {
      ...beforeDryRun,
      fishingBaseFish: 3_230,
      catchReports: 3_194,
    });

    const afterApply = await relevantCounts();
    const postApplyDryRun = await auditFishingBaseFishReconciliation(prisma);
    assert.deepEqual(postApplyDryRun.memberships, {
      current: 3_230,
      keep: 3_230,
      add: 0,
      remove: 0,
      expectedFinal: 3_230,
    });
    assert.deepEqual(postApplyDryRun.catchReports, {
      current: 3_194,
      valid: 3_194,
      invalidImported: 0,
      invalidNative: 0,
      expectedFinal: 3_194,
    });
    assert.equal(postApplyDryRun.writesPerformed, false);
    assert.deepEqual(await relevantCounts(), afterApply);

    await assert.rejects(
      applyFishingBaseFishReconciliation(prisma, postApplyDryRun.preStateFingerprint),
      FishingBaseFishReconciliationError,
    );
    assert.deepEqual(await relevantCounts(), afterApply);

    const seedRerun = await seedCatalog(prisma);
    assert.deepEqual(seedRerun.fishingBaseFish, { created: 0, reused: 3_230 });
    assert.equal(await prisma.fishingBaseFish.count(), 3_230);
    assert.equal(await prisma.catchReport.count(), 3_194);
  });
});
