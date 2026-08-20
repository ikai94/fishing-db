import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { normalizeCatalogName } from '../src/catalog/catalog-normalization.js';
import { nativeContributorKey } from '../src/catch-reports/catch-report-identity.js';
import type { DraftField } from '../src/catch-reports/parser/catch-report-parser.types.js';
import { CatchReportParserService } from '../src/catch-reports/parser/catch-report-parser.service.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import { REAL_CATALOG_DATA } from '../src/prisma/catalog-seed-data.js';
import { CatalogSeedConflictError, seedCatalog } from '../src/prisma/catalog-seed.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const AUTHORITATIVE_COUNTS = {
  fishingBases: 77,
  locations: 853,
  fish: 1_255,
  baits: 249,
  bait: 68,
  lure: 181,
  screenAnchors: 8,
  fishingBaseFish: 5_369,
} as const;
const PARSER_SOURCE =
  'Шамбардия Валберга 40 грамм. Поймана на Озера Танзании: Берег слоновьего бивня, Мотыль. ямка 6,00 удочка';

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

interface CatalogCounts {
  fishingBases: number;
  locations: number;
  fish: number;
  baits: number;
  screenAnchors: number;
  fishingBaseFish: number;
}

let prisma: PrismaClient;
let databaseConfiguration: TestDatabaseConfiguration;
let clearDatabase: (() => Promise<void>) | undefined;

function resolvedValue<T>(field: DraftField<T>): T | null {
  assert.equal(field.status, 'RESOLVED');
  return field.value;
}

function requiredAmur(): (typeof REAL_CATALOG_DATA.bases)[number] {
  const amur = REAL_CATALOG_DATA.bases.find((base) => base.name === 'Амур');
  assert.ok(amur, 'the authoritative catalog must contain Амур');
  return amur;
}

function requiredBait(name: string): (typeof REAL_CATALOG_DATA.baits)[number] {
  const bait = REAL_CATALOG_DATA.baits.find((item) => item.name === name);
  assert.ok(bait, `the authoritative catalog must contain Bait "${name}"`);
  return bait;
}

async function catalogCounts(): Promise<CatalogCounts> {
  const [fishingBases, locations, fish, baits, screenAnchors, fishingBaseFish] = await Promise.all([
    prisma.fishingBase.count(),
    prisma.location.count(),
    prisma.fish.count(),
    prisma.bait.count(),
    prisma.screenAnchor.count(),
    prisma.fishingBaseFish.count(),
  ]);

  return { fishingBases, locations, fish, baits, screenAnchors, fishingBaseFish };
}

async function createExistingAmur(): Promise<{
  anchorIds: [string, string][];
  baitId: string;
  baseId: string;
  fishIds: [string, string][];
  locationIds: [string, string][];
}> {
  const amur = requiredAmur();
  assert.equal(amur.locations.length, 9);
  assert.equal(amur.fish.length, 64);

  const baseName = normalizeCatalogName(amur.name);
  const base = await prisma.fishingBase.create({ data: baseName });

  await prisma.location.createMany({
    data: amur.locations.map((location) => ({
      fishingBaseId: base.id,
      number: location.number,
      ...normalizeCatalogName(location.name),
    })),
  });
  await prisma.fish.createMany({
    data: amur.fish.map((name) => normalizeCatalogName(name)),
  });

  const locations = await prisma.location.findMany({
    where: { fishingBaseId: base.id },
    orderBy: [{ number: 'asc' }],
    select: { id: true, number: true, nameNormalized: true },
  });
  const fish = await prisma.fish.findMany({
    where: {
      nameNormalized: { in: amur.fish.map((name) => normalizeCatalogName(name).nameNormalized) },
    },
    orderBy: [{ nameNormalized: 'asc' }],
    select: { id: true, nameNormalized: true },
  });
  assert.equal(locations.length, amur.locations.length);
  assert.equal(fish.length, amur.fish.length);

  await prisma.fishingBaseFish.createMany({
    data: fish.map((item) => ({ fishingBaseId: base.id, fishId: item.id })),
  });
  await prisma.screenAnchor.createMany({
    data: REAL_CATALOG_DATA.screenAnchors.map((name) => normalizeCatalogName(name)),
  });
  const anchors = await prisma.screenAnchor.findMany({
    orderBy: [{ nameNormalized: 'asc' }],
    select: { id: true, nameNormalized: true },
  });

  const motyl = requiredBait('Мотыль');
  assert.equal(motyl.type, 'BAIT');
  const bait = await prisma.bait.create({
    data: { ...normalizeCatalogName(motyl.name), type: motyl.type },
  });

  return {
    anchorIds: anchors.map((item) => [item.nameNormalized, item.id]),
    baitId: bait.id,
    baseId: base.id,
    fishIds: fish.map((item) => [item.nameNormalized, item.id]),
    locationIds: locations.map((item) => [
      `${String(item.number)}:${item.nameNormalized}`,
      item.id,
    ]),
  };
}

void describe('Catalog seed (PostgreSQL e2e)', { concurrency: false }, () => {
  void before(async () => {
    databaseConfiguration = getTestDatabaseConfiguration(process.env);
    prisma = new PrismaClient({
      adapter: createPrismaAdapter(databaseConfiguration.testDatabaseUrl),
    });
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
    } finally {
      await prisma.$disconnect();
    }
  });

  void test('seeds the exact real graph, resolves a representative line and is idempotent', async () => {
    const first = await seedCatalog(prisma);

    assert.deepEqual(first, {
      fishingBases: { created: 77, reused: 0 },
      locations: { created: 853, reused: 0 },
      fish: { created: 1_255, reused: 0 },
      baits: { created: 249, reused: 0 },
      screenAnchors: { created: 8, reused: 0 },
      fishingBaseFish: { created: 5_369, reused: 0 },
      conflicts: 0,
      warnings: [],
    });
    assert.deepEqual(await catalogCounts(), {
      fishingBases: AUTHORITATIVE_COUNTS.fishingBases,
      locations: AUTHORITATIVE_COUNTS.locations,
      fish: AUTHORITATIVE_COUNTS.fish,
      baits: AUTHORITATIVE_COUNTS.baits,
      screenAnchors: AUTHORITATIVE_COUNTS.screenAnchors,
      fishingBaseFish: AUTHORITATIVE_COUNTS.fishingBaseFish,
    });
    assert.equal(await prisma.bait.count({ where: { type: 'BAIT' } }), AUTHORITATIVE_COUNTS.bait);
    assert.equal(await prisma.bait.count({ where: { type: 'LURE' } }), AUTHORITATIVE_COUNTS.lure);
    assert.notEqual(
      AUTHORITATIVE_COUNTS.fishingBaseFish,
      AUTHORITATIVE_COUNTS.locations * AUTHORITATIVE_COUNTS.fish,
    );

    const relationTable = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'LocationFish'
      ) AS "exists"
    `;
    assert.deepEqual(relationTable, [{ exists: false }]);

    for (const [name, type] of [
      ['Мотыль', 'BAIT'],
      ['Pilk-107', 'LURE'],
      ['Vib-rapan', 'LURE'],
      ['Propeller-01', 'LURE'],
    ] as const) {
      const item = await prisma.bait.findUniqueOrThrow({
        where: { nameNormalized: normalizeCatalogName(name).nameNormalized },
      });
      assert.equal(item.name, name);
      assert.equal(item.type, type);
    }

    const parser = new CatchReportParserService(prisma as unknown as PrismaService);
    const draft = (await parser.parse(PARSER_SOURCE)).draft;
    assert.equal(resolvedValue(draft.fields.fishingBase)?.name, 'Озера Танзании');
    assert.equal(resolvedValue(draft.fields.location)?.name, 'Берег слоновьего бивня');
    assert.equal(resolvedValue(draft.fields.fish)?.name, 'Шамбардия Валберга');
    assert.deepEqual(resolvedValue(draft.fields.bait), {
      id: resolvedValue(draft.fields.bait)?.id,
      name: 'Мотыль',
      type: 'BAIT',
    });
    assert.equal(resolvedValue(draft.fields.weightGrams), 40);
    assert.equal(resolvedValue(draft.fields.fishingMethod), 'BAIT_FISHING');
    assert.equal(resolvedValue(draft.fields.holeDepthCm), 600);
    assert.equal(resolvedValue(draft.fields.spotPositionRaw), 'удочка');
    assert.equal(draft.baseFishMembership.status, 'RESOLVED');
    assert.deepEqual(draft.unresolvedFragments, []);
    assert.equal(draft.canConfirm, true);

    const second = await seedCatalog(prisma);
    assert.deepEqual(second, {
      fishingBases: { created: 0, reused: 77 },
      locations: { created: 0, reused: 853 },
      fish: { created: 0, reused: 1_255 },
      baits: { created: 0, reused: 249 },
      screenAnchors: { created: 0, reused: 8 },
      fishingBaseFish: { created: 0, reused: 5_369 },
      conflicts: 0,
      warnings: [],
    });
    assert.deepEqual(await catalogCounts(), {
      fishingBases: 77,
      locations: 853,
      fish: 1_255,
      baits: 249,
      screenAnchors: 8,
      fishingBaseFish: 5_369,
    });
  });

  void test('reuses existing Amur IDs and preserves custom data and CatchReport references', async () => {
    const amurBefore = await createExistingAmur();
    const tutorialBase = await prisma.fishingBase.create({
      data: normalizeCatalogName('Учебная seed-база'),
    });
    const tutorialLocation = await prisma.location.create({
      data: {
        fishingBaseId: tutorialBase.id,
        number: 1,
        ...normalizeCatalogName('Учебная seed-локация'),
      },
    });
    const tutorialFish = await prisma.fish.create({
      data: normalizeCatalogName('Учебная seed-рыба'),
    });
    const tutorialBait = await prisma.bait.create({
      data: { ...normalizeCatalogName('Учебная seed-наживка'), type: 'BAIT' },
    });
    const tutorialLink = await prisma.fishingBaseFish.create({
      data: { fishingBaseId: tutorialBase.id, fishId: tutorialFish.id },
    });

    const user = await prisma.user.create({
      data: {
        email: 'catalog-seed-e2e@example.ru',
        nickname: 'Catalog Seed E2E',
        nicknameNormalized: 'catalog seed e2e',
        passwordHash: 'not-a-real-password-hash',
      },
    });
    const amurLocation = await prisma.location.findFirstOrThrow({
      where: { fishingBaseId: amurBefore.baseId, number: 1 },
    });
    const kizhuch = await prisma.fish.findUniqueOrThrow({
      where: { nameNormalized: normalizeCatalogName('Кижуч').nameNormalized },
    });
    const report = await prisma.catchReport.create({
      data: {
        userId: user.id,
        contributorKey: nativeContributorKey(user.id),
        importKey: null,
        locationId: amurLocation.id,
        fishId: kizhuch.id,
        baitId: amurBefore.baitId,
        weightGrams: 7_242,
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: 600,
        spotPositionRaw: 'удочка',
        rawSourceText: 'Кижуч 7,242 кг. Поймана на Амур',
      },
      select: { id: true, locationId: true, fishId: true, baitId: true, fishingMethod: true },
    });

    const first = await seedCatalog(prisma);
    assert.deepEqual(first, {
      fishingBases: { created: 76, reused: 1 },
      locations: { created: 844, reused: 9 },
      fish: { created: 1_191, reused: 64 },
      baits: { created: 248, reused: 1 },
      screenAnchors: { created: 0, reused: 8 },
      fishingBaseFish: { created: 5_305, reused: 64 },
      conflicts: 0,
      warnings: [],
    });

    const amurAfter = await prisma.fishingBase.findUniqueOrThrow({
      where: { nameNormalized: normalizeCatalogName('Амур').nameNormalized },
    });
    assert.equal(amurAfter.id, amurBefore.baseId);
    const locationsAfter = await prisma.location.findMany({
      where: { fishingBaseId: amurBefore.baseId },
      orderBy: [{ number: 'asc' }],
      select: { id: true, number: true, nameNormalized: true },
    });
    assert.deepEqual(
      locationsAfter.map((item) => [`${String(item.number)}:${item.nameNormalized}`, item.id]),
      amurBefore.locationIds,
    );
    const fishAfter = await prisma.fish.findMany({
      where: {
        nameNormalized: {
          in: requiredAmur().fish.map((name) => normalizeCatalogName(name).nameNormalized),
        },
      },
      orderBy: [{ nameNormalized: 'asc' }],
      select: { id: true, nameNormalized: true },
    });
    assert.deepEqual(
      fishAfter.map((item) => [item.nameNormalized, item.id]),
      amurBefore.fishIds,
    );
    const anchorsAfter = await prisma.screenAnchor.findMany({
      orderBy: [{ nameNormalized: 'asc' }],
      select: { id: true, nameNormalized: true },
    });
    assert.deepEqual(
      anchorsAfter.map((item) => [item.nameNormalized, item.id]),
      amurBefore.anchorIds,
    );

    assert.deepEqual(
      await prisma.catchReport.findUniqueOrThrow({
        where: { id: report.id },
        select: { id: true, locationId: true, fishId: true, baitId: true, fishingMethod: true },
      }),
      report,
    );
    assert.deepEqual(
      await prisma.fishingBase.findUnique({ where: { id: tutorialBase.id } }),
      tutorialBase,
    );
    assert.deepEqual(
      await prisma.location.findUnique({ where: { id: tutorialLocation.id } }),
      tutorialLocation,
    );
    assert.deepEqual(
      await prisma.fish.findUnique({ where: { id: tutorialFish.id } }),
      tutorialFish,
    );
    assert.deepEqual(
      await prisma.bait.findUnique({ where: { id: tutorialBait.id } }),
      tutorialBait,
    );
    assert.deepEqual(
      await prisma.fishingBaseFish.findUnique({
        where: {
          fishingBaseId_fishId: {
            fishingBaseId: tutorialLink.fishingBaseId,
            fishId: tutorialLink.fishId,
          },
        },
      }),
      tutorialLink,
    );
    assert.deepEqual(await catalogCounts(), {
      fishingBases: 78,
      locations: 854,
      fish: 1_256,
      baits: 250,
      screenAnchors: 8,
      fishingBaseFish: 5_370,
    });
  });

  void test('rolls back every planned write on a wrong-type Bait conflict', async () => {
    const wrongBait = await prisma.bait.create({
      data: { ...normalizeCatalogName('Pilk-107'), type: 'BAIT' },
    });

    await assert.rejects(seedCatalog(prisma), (error: unknown) => {
      assert.ok(error instanceof CatalogSeedConflictError);
      assert.match(error.message, /Pilk-107.*BAIT.*LURE/u);
      return true;
    });

    assert.deepEqual(await catalogCounts(), {
      fishingBases: 0,
      locations: 0,
      fish: 0,
      baits: 1,
      screenAnchors: 0,
      fishingBaseFish: 0,
    });
    assert.deepEqual(await prisma.bait.findUnique({ where: { id: wrongBait.id } }), wrongBait);
  });
});
