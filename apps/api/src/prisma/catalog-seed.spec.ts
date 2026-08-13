import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '../generated/prisma/client.js';
import {
  AUTHORITATIVE_CATALOG_COUNTS,
  CatalogSeedDataDecodeError,
  CatalogSeedSnapshotError,
  REAL_CATALOG_DATA,
  assertAuthoritativeCatalogCounts,
  decodeBaitCatalog,
  decodeFishingCatalog,
  getCatalogSeedSnapshotCounts,
  type CatalogSeedData,
} from './catalog-seed-data.js';
import {
  CatalogSeedConflictError,
  CatalogSeedValidationError,
  seedCatalog,
  validateCatalogSeedData,
} from './catalog-seed.js';

interface NamedRow {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
}

interface BaitRow extends NamedRow {
  type: 'BAIT' | 'LURE';
}

interface LocationRow extends NamedRow {
  fishingBaseId: string;
  number: number;
}

interface MembershipRow {
  fishingBaseId: string;
  fishId: string;
}

interface CatalogState {
  fishingBases: NamedRow[];
  locations: LocationRow[];
  fish: NamedRow[];
  baits: BaitRow[];
  screenAnchors: NamedRow[];
  memberships: MembershipRow[];
}

interface NamedCreateData {
  name: string;
  nameNormalized: string;
}

interface NamedCreateManyInput {
  data: NamedCreateData | readonly NamedCreateData[];
}

interface BaitCreateManyInput {
  data:
    | { name: string; nameNormalized: string; type: 'BAIT' | 'LURE' }
    | readonly { name: string; nameNormalized: string; type: 'BAIT' | 'LURE' }[];
}

interface LocationCreateData extends NamedCreateData {
  fishingBaseId: string;
  number: number;
}

interface LocationCreateManyInput {
  data: LocationCreateData | readonly LocationCreateData[];
}

interface MembershipCreateManyInput {
  data: MembershipRow | readonly MembershipRow[];
}

interface NamedFindManyInput {
  where?: { nameNormalized?: { in: readonly string[] } };
}

interface LocationFindManyInput {
  where?: { fishingBaseId?: { in: readonly string[] } };
}

interface MembershipFindManyInput {
  where?: {
    fishingBaseId?: { in: readonly string[] };
    fishId?: { in: readonly string[] };
  };
}

function rowsFromCreateMany<T>(data: T | readonly T[]): readonly T[] {
  return Array.isArray(data) ? data : [data as T];
}

function assertExactKeys(value: object, expectedKeys: readonly string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function filterNamedRows<T extends NamedRow>(rows: readonly T[], input?: NamedFindManyInput): T[] {
  const names = input?.where?.nameNormalized?.in;

  return names === undefined ? [...rows] : rows.filter((row) => names.includes(row.nameNormalized));
}

function namedRow(id: string, name: string, nameNormalized: string, isActive = true): NamedRow {
  return { id, name, nameNormalized, isActive };
}

function emptyState(): CatalogState {
  return {
    fishingBases: [],
    locations: [],
    fish: [],
    baits: [],
    screenAnchors: [],
    memberships: [],
  };
}

class InMemoryCatalogDatabase {
  transactionCalls = 0;
  state: CatalogState;
  private sequence = 0;

  constructor(initialState: CatalogState = emptyState()) {
    this.state = structuredClone(initialState);
  }

  async $transaction<T>(callback: (transaction: unknown) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const draft = structuredClone(this.state);
    let sequence = this.sequence;
    const nextId = (kind: string): string => `${kind}-${String(++sequence)}`;
    const transaction = {
      fishingBase: {
        findMany: (input?: NamedFindManyInput) =>
          Promise.resolve(filterNamedRows(draft.fishingBases, input)),
        createMany: ({ data }: NamedCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['name', 'nameNormalized']);
            draft.fishingBases.push(namedRow(nextId('base'), item.name, item.nameNormalized));
          }

          return Promise.resolve({ count: rows.length });
        },
      },
      fish: {
        findMany: (input?: NamedFindManyInput) =>
          Promise.resolve(filterNamedRows(draft.fish, input)),
        createMany: ({ data }: NamedCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['name', 'nameNormalized']);
            draft.fish.push(namedRow(nextId('fish'), item.name, item.nameNormalized));
          }

          return Promise.resolve({ count: rows.length });
        },
      },
      bait: {
        findMany: (input?: NamedFindManyInput) =>
          Promise.resolve(filterNamedRows(draft.baits, input)),
        createMany: ({ data }: BaitCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['name', 'nameNormalized', 'type']);
            draft.baits.push({
              ...namedRow(nextId('bait'), item.name, item.nameNormalized),
              type: item.type,
            });
          }

          return Promise.resolve({ count: rows.length });
        },
      },
      screenAnchor: {
        findMany: (input?: NamedFindManyInput) =>
          Promise.resolve(filterNamedRows(draft.screenAnchors, input)),
        createMany: ({ data }: NamedCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['name', 'nameNormalized']);
            draft.screenAnchors.push(namedRow(nextId('anchor'), item.name, item.nameNormalized));
          }

          return Promise.resolve({ count: rows.length });
        },
      },
      location: {
        findMany: (input?: LocationFindManyInput) => {
          const baseIds = input?.where?.fishingBaseId?.in;

          return Promise.resolve(
            baseIds === undefined
              ? [...draft.locations]
              : draft.locations.filter((row) => baseIds.includes(row.fishingBaseId)),
          );
        },
        createMany: ({ data }: LocationCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['fishingBaseId', 'number', 'name', 'nameNormalized']);
            draft.locations.push({
              ...namedRow(nextId('location'), item.name, item.nameNormalized),
              fishingBaseId: item.fishingBaseId,
              number: item.number,
            });
          }

          return Promise.resolve({ count: rows.length });
        },
      },
      fishingBaseFish: {
        findMany: (input?: MembershipFindManyInput) => {
          const baseIds = input?.where?.fishingBaseId?.in;
          const fishIds = input?.where?.fishId?.in;

          return Promise.resolve(
            draft.memberships.filter(
              (row) =>
                (baseIds === undefined || baseIds.includes(row.fishingBaseId)) &&
                (fishIds === undefined || fishIds.includes(row.fishId)),
            ),
          );
        },
        createMany: ({ data }: MembershipCreateManyInput) => {
          const rows = rowsFromCreateMany(data);

          for (const item of rows) {
            assertExactKeys(item, ['fishingBaseId', 'fishId']);
          }

          draft.memberships.push(...rows);
          return Promise.resolve({ count: rows.length });
        },
      },
    };

    const result = await callback(transaction);
    this.state = draft;
    this.sequence = sequence;
    return result;
  }
}

function asPrisma(database: InMemoryCatalogDatabase): PrismaClient {
  return database as unknown as PrismaClient;
}

function validationIssues(error: unknown): readonly string[] {
  assert.ok(error instanceof CatalogSeedValidationError);
  return error.issues;
}

void describe('catalog seed', () => {
  void it('decodes strict canonical fishing and Bait JSON shapes', () => {
    assert.deepEqual(
      decodeFishingCatalog({
        schemaVersion: 1,
        bases: [
          {
            name: 'Амур',
            locations: [{ number: 1, name: 'Протока' }],
            fish: ['Кижуч'],
          },
        ],
      }),
      {
        schemaVersion: 1,
        bases: [
          {
            name: 'Амур',
            locations: [{ number: 1, name: 'Протока' }],
            fish: ['Кижуч'],
          },
        ],
      },
    );
    assert.deepEqual(
      decodeBaitCatalog({
        schemaVersion: 1,
        baits: [
          { name: 'Мотыль', type: 'BAIT' },
          { name: 'Pilk-107', type: 'LURE' },
        ],
      }),
      {
        schemaVersion: 1,
        baits: [
          { name: 'Мотыль', type: 'BAIT' },
          { name: 'Pilk-107', type: 'LURE' },
        ],
      },
    );

    assert.throws(
      () =>
        decodeFishingCatalog({
          schemaVersion: 1,
          bases: [{ name: 'Амур', locations: [], fish: [], sourceId: 1 }],
        }),
      CatalogSeedDataDecodeError,
    );
    assert.throws(
      () =>
        decodeBaitCatalog({
          schemaVersion: 1,
          baits: [{ name: 'Pilk-107', type: 'SPINNING' }],
        }),
      CatalogSeedDataDecodeError,
    );
  });

  void it('contains the exact authoritative full-catalog snapshot and valid identities', () => {
    const validated = validateCatalogSeedData(REAL_CATALOG_DATA);
    const actualCounts = getCatalogSeedSnapshotCounts(REAL_CATALOG_DATA);
    const derivedFish: string[] = [];
    const exactFishNames = new Set<string>();

    for (const base of REAL_CATALOG_DATA.bases) {
      for (const fishName of base.fish) {
        if (!exactFishNames.has(fishName)) {
          exactFishNames.add(fishName);
          derivedFish.push(fishName);
        }
      }
    }

    assert.doesNotThrow(() => assertAuthoritativeCatalogCounts(REAL_CATALOG_DATA));
    assert.deepEqual(actualCounts, AUTHORITATIVE_CATALOG_COUNTS);
    assert.deepEqual(REAL_CATALOG_DATA.fish, derivedFish);
    assert.equal(validated.bases.length, 77);
    assert.equal(
      validated.bases.reduce((total, base) => total + base.locations.length, 0),
      853,
    );
    assert.equal(validated.fish.length, 1_255);
    assert.equal(
      validated.bases.reduce((total, base) => total + base.fishNormalized.length, 0),
      5_369,
    );
    assert.equal(validated.baits.length, 249);
    assert.equal(validated.baits.filter((bait) => bait.type === 'BAIT').length, 68);
    assert.equal(validated.baits.filter((bait) => bait.type === 'LURE').length, 181);
    assert.equal(validated.screenAnchors.length, 8);
    assert.equal(new Set(validated.bases.map((base) => base.nameNormalized)).size, 77);
    assert.equal(new Set(validated.fish.map((fish) => fish.nameNormalized)).size, 1_255);
    assert.equal(new Set(validated.baits.map((bait) => bait.nameNormalized)).size, 249);

    const globalFish = new Set(validated.fish.map((fish) => fish.nameNormalized));

    for (const base of validated.bases) {
      assert.equal(
        new Set(base.locations.map((location) => location.number)).size,
        base.locations.length,
      );
      assert.equal(
        new Set(base.locations.map((location) => location.nameNormalized)).size,
        base.locations.length,
      );
      assert.equal(new Set(base.fishNormalized).size, base.fishNormalized.length);
      assert.equal(
        base.fishNormalized.every((fish) => globalFish.has(fish)),
        true,
      );
    }

    assert.equal(
      validated.fish.some((fish) => fish.name.endsWith(' (спиннинг)')),
      false,
    );

    const amur = validated.bases.find((base) => base.name === 'Амур');
    assert.ok(amur);
    assert.equal(amur.fishNormalized.length, 64);
    assert.deepEqual(
      amur.locations.map(({ number, name }) => ({ number, name })),
      [
        { number: 1, name: 'Протока бешеная - створы' },
        { number: 2, name: 'Протока бешеная - хутор' },
        { number: 3, name: 'Протока бешеная - огороды' },
        { number: 4, name: 'Старый затон' },
        { number: 5, name: 'Богачёво' },
        { number: 6, name: 'Лисья гора' },
        { number: 7, name: 'Понтонный мост' },
        { number: 8, name: 'Амурская протока' },
        { number: 9, name: 'Ширшиха' },
      ],
    );
    assert.equal(REAL_CATALOG_DATA.fish.includes('Морская свянья обыкновенная'), true);
    assert.deepEqual(
      validated.screenAnchors.map((item) => item.name),
      ['Удочка', 'Леска', 'Блокнот', 'Рюкзак', 'Катушка', 'Чат', 'Снасти', 'События'],
    );

    const dneprDelta = REAL_CATALOG_DATA.bases.find((base) => base.name === 'Днепр-дельта');
    assert.ok(dneprDelta);
    assert.equal(
      dneprDelta.locations.find((location) => location.number === 8)?.name,
      'Тополя, тополя…',
    );
    assert.equal(
      dneprDelta.locations.find((location) => location.number === 9)?.name,
      'Чуден Днепр…',
    );

    assert.throws(
      () =>
        assertAuthoritativeCatalogCounts({
          ...REAL_CATALOG_DATA,
          baits: REAL_CATALOG_DATA.baits.slice(1),
        }),
      CatalogSeedSnapshotError,
    );
  });

  void it('collects normalized duplicates, invalid references, bounds, types and spin markers', () => {
    const invalidData = {
      fish: ['Кижуч', ' кижуч ', 'Кижуч (спиннинг)'],
      bases: [
        {
          name: 'Амур',
          locations: [
            { number: 1, name: 'Протока' },
            { number: 1, name: ' протока ' },
            { number: 2_147_483_648, name: 'Лиман' },
          ],
          fish: ['Кижуч', 'кижуч', 'Неизвестная рыба'],
        },
        { name: ' амур ', locations: [], fish: [] },
      ],
      baits: [
        { name: 'Мотыль', type: 'BAIT' },
        { name: ' мотыль ', type: 'INVALID' },
      ],
      screenAnchors: ['Удочка', ' удочка '],
    } as unknown as CatalogSeedData;

    assert.throws(
      () => validateCatalogSeedData(invalidData),
      (error: unknown) => {
        const issues = validationIssues(error).join('\n');
        assert.match(issues, /duplicate normalized Fish/);
        assert.match(issues, /duplicate normalized canonical Fish/);
        assert.match(issues, /exact trailing/);
        assert.match(issues, /duplicate Location number/);
        assert.match(issues, /duplicate normalized Location/);
        assert.match(issues, /positive PostgreSQL integer/);
        assert.match(issues, /duplicate normalized FishingBase\/Fish membership/);
        assert.match(issues, /unknown global Fish/);
        assert.match(issues, /duplicate normalized FishingBase/);
        assert.match(issues, /duplicate normalized Bait/);
        assert.match(issues, /must be BAIT or LURE/);
        assert.match(issues, /duplicate normalized ScreenAnchor/);
        return true;
      },
    );
  });

  void it('validates all source data before opening a transaction', async () => {
    const database = new InMemoryCatalogDatabase();
    const invalid = {
      fish: ['Кижуч', 'кижуч'],
      bases: [],
      baits: [],
      screenAnchors: [],
    } satisfies CatalogSeedData;

    await assert.rejects(seedCatalog(asPrisma(database), invalid), CatalogSeedValidationError);
    assert.equal(database.transactionCalls, 0);
    assert.deepEqual(database.state, emptyState());
  });

  void it('creates the exact additive counts, preserves unrelated data and is idempotent', async () => {
    const initial = emptyState();
    initial.fishingBases.push(namedRow('tutorial-base', 'Учебная база', 'учебная база'));
    initial.locations.push({
      ...namedRow('tutorial-location', 'Учебная локация', 'учебная локация'),
      fishingBaseId: 'tutorial-base',
      number: 1,
    });
    initial.fish.push(namedRow('tutorial-fish', 'Учебная рыба', 'учебная рыба'));
    initial.baits.push({
      ...namedRow('tutorial-bait', 'Учебная наживка', 'учебная наживка'),
      type: 'BAIT',
    });
    initial.screenAnchors.push(namedRow('tutorial-anchor', 'Учебная отметка', 'учебная отметка'));
    initial.memberships.push({ fishingBaseId: 'tutorial-base', fishId: 'tutorial-fish' });
    const database = new InMemoryCatalogDatabase(initial);

    const first = await seedCatalog(asPrisma(database));
    const second = await seedCatalog(asPrisma(database));

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
    assert.equal(database.state.fishingBases.length, 78);
    assert.equal(database.state.locations.length, 854);
    assert.equal(database.state.fish.length, 1_256);
    assert.equal(database.state.memberships.length, 5_370);
    assert.equal(database.state.screenAnchors.length, 9);
    assert.equal(database.state.baits.length, 250);
    assert.deepEqual(
      database.state.fishingBases.find((item) => item.id === 'tutorial-base'),
      initial.fishingBases[0],
    );
    assert.deepEqual(
      database.state.locations.find((item) => item.id === 'tutorial-location'),
      initial.locations[0],
    );
    assert.deepEqual(
      database.state.fish.find((item) => item.id === 'tutorial-fish'),
      initial.fish[0],
    );
    assert.deepEqual(
      database.state.baits.find((item) => item.id === 'tutorial-bait'),
      initial.baits[0],
    );
    assert.deepEqual(
      database.state.screenAnchors.find((item) => item.id === 'tutorial-anchor'),
      initial.screenAnchors[0],
    );
    assert.equal(
      database.state.memberships.some(
        (item) => item.fishingBaseId === 'tutorial-base' && item.fishId === 'tutorial-fish',
      ),
      true,
    );
  });

  void it('reuses the previously approved Amur catalog without a special-case branch', async () => {
    const validated = validateCatalogSeedData(REAL_CATALOG_DATA);
    const amur = validated.bases.find((base) => base.name === 'Амур');
    assert.ok(amur);

    const fishByNormalized = new Map(
      validated.fish.map((fish) => [fish.nameNormalized, fish] as const),
    );
    const initial = emptyState();
    const baseId = 'existing-amur-base';
    initial.fishingBases.push(namedRow(baseId, amur.name, amur.nameNormalized));

    for (const [index, location] of amur.locations.entries()) {
      initial.locations.push({
        ...namedRow(
          `existing-amur-location-${String(index + 1)}`,
          location.name,
          location.nameNormalized,
        ),
        fishingBaseId: baseId,
        number: location.number,
      });
    }

    for (const [index, fishNormalized] of amur.fishNormalized.entries()) {
      const fish = fishByNormalized.get(fishNormalized);
      assert.ok(fish);
      const fishId = `existing-amur-fish-${String(index + 1)}`;
      initial.fish.push(namedRow(fishId, fish.name, fish.nameNormalized));
      initial.memberships.push({ fishingBaseId: baseId, fishId });
    }

    for (const [index, anchor] of validated.screenAnchors.entries()) {
      initial.screenAnchors.push(
        namedRow(`existing-anchor-${String(index + 1)}`, anchor.name, anchor.nameNormalized),
      );
    }

    const previousAmur = structuredClone(initial);
    const database = new InMemoryCatalogDatabase(initial);
    const result = await seedCatalog(asPrisma(database));

    assert.deepEqual(result, {
      fishingBases: { created: 76, reused: 1 },
      locations: { created: 844, reused: 9 },
      fish: { created: 1_191, reused: 64 },
      baits: { created: 249, reused: 0 },
      screenAnchors: { created: 0, reused: 8 },
      fishingBaseFish: { created: 5_305, reused: 64 },
      conflicts: 0,
      warnings: [],
    });
    assert.deepEqual(
      database.state.fishingBases.find((row) => row.id === baseId),
      previousAmur.fishingBases[0],
    );

    for (const row of previousAmur.locations) {
      assert.deepEqual(
        database.state.locations.find((candidate) => candidate.id === row.id),
        row,
      );
    }

    for (const row of previousAmur.fish) {
      assert.deepEqual(
        database.state.fish.find((candidate) => candidate.id === row.id),
        row,
      );
    }

    for (const row of previousAmur.screenAnchors) {
      assert.deepEqual(
        database.state.screenAnchors.find((candidate) => candidate.id === row.id),
        row,
      );
    }

    for (const membership of previousAmur.memberships) {
      assert.equal(
        database.state.memberships.some(
          (candidate) =>
            candidate.fishingBaseId === membership.fishingBaseId &&
            candidate.fishId === membership.fishId,
        ),
        true,
      );
    }
  });

  void it('reuses inactive/display-variant rows without overwriting or reactivation', async () => {
    const initial = emptyState();
    initial.fishingBases.push(namedRow('base-id', 'АМУР', 'амур', false));
    initial.fish.push(namedRow('fish-id', 'КИЖУЧ', 'кижуч', false));
    initial.screenAnchors.push(namedRow('anchor-id', 'УДОЧКА', 'удочка', false));
    const database = new InMemoryCatalogDatabase(initial);
    const data = {
      fish: ['Кижуч'],
      bases: [
        {
          name: 'Амур',
          locations: [{ number: 1, name: 'Протока' }],
          fish: ['Кижуч'],
        },
      ],
      baits: [],
      screenAnchors: ['Удочка'],
    } satisfies CatalogSeedData;

    const result = await seedCatalog(asPrisma(database), data);

    assert.equal(result.fishingBases.reused, 1);
    assert.equal(result.fish.reused, 1);
    assert.equal(result.screenAnchors.reused, 1);
    assert.equal(result.warnings.length, 6);
    assert.deepEqual(database.state.fishingBases[0], initial.fishingBases[0]);
    assert.deepEqual(database.state.fish[0], initial.fish[0]);
    assert.deepEqual(database.state.screenAnchors[0], initial.screenAnchors[0]);
  });

  void it('preflights structural conflicts and rolls the entire transaction back', async () => {
    const initial = emptyState();
    initial.fishingBases.push(namedRow('base-id', 'Амур', 'амур'));
    initial.locations.push({
      ...namedRow('location-id', 'Другое место', 'другое место'),
      fishingBaseId: 'base-id',
      number: 1,
    });
    const database = new InMemoryCatalogDatabase(initial);
    const data = {
      fish: ['Кижуч'],
      bases: [
        {
          name: 'Амур',
          locations: [{ number: 1, name: 'Протока' }],
          fish: ['Кижуч'],
        },
      ],
      baits: [],
      screenAnchors: [],
    } satisfies CatalogSeedData;

    await assert.rejects(seedCatalog(asPrisma(database), data), CatalogSeedConflictError);
    assert.deepEqual(database.state, initial);
  });

  void it('fails closed and rolls back the full seed on a wrong-type Bait conflict', async () => {
    const initial = emptyState();
    initial.baits.push({
      ...namedRow('wrong-pilk', 'Pilk-107', 'pilk-107'),
      type: 'BAIT',
    });
    const database = new InMemoryCatalogDatabase(initial);

    await assert.rejects(seedCatalog(asPrisma(database)), (error: unknown) => {
      assert.ok(error instanceof CatalogSeedConflictError);
      assert.match(error.message, /Bait "Pilk-107" has type BAIT, expected LURE/);
      return true;
    });
    assert.equal(database.transactionCalls, 1);
    assert.deepEqual(database.state, initial);
  });

  void it('fails safely if an exact legacy spinning Fish remains in the database', async () => {
    const initial = emptyState();
    initial.fish.push(namedRow('legacy-fish', 'Кижуч (спиннинг)', 'кижуч (спиннинг)'));
    const database = new InMemoryCatalogDatabase(initial);

    await assert.rejects(seedCatalog(asPrisma(database)), CatalogSeedConflictError);
    assert.deepEqual(database.state, initial);
  });
});
