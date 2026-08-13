import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AMUR_FISH, REAL_CATALOG_DATA, type CatalogSeedData } from './catalog-seed-data.js';
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

interface NamedCreateInput {
  data: { name: string; nameNormalized: string };
}

interface BaitCreateInput {
  data: { name: string; nameNormalized: string; type: 'BAIT' | 'LURE' };
}

interface LocationCreateInput {
  data: {
    fishingBaseId: string;
    number: number;
    name: string;
    nameNormalized: string;
  };
}

interface MembershipCreateInput {
  data: MembershipRow;
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
        findMany: () => Promise.resolve(draft.fishingBases),
        create: ({ data }: NamedCreateInput) => {
          const row = namedRow(nextId('base'), data.name, data.nameNormalized);
          draft.fishingBases.push(row);
          return Promise.resolve(row);
        },
      },
      fish: {
        findMany: () => Promise.resolve(draft.fish),
        create: ({ data }: NamedCreateInput) => {
          const row = namedRow(nextId('fish'), data.name, data.nameNormalized);
          draft.fish.push(row);
          return Promise.resolve(row);
        },
      },
      bait: {
        findMany: () => Promise.resolve(draft.baits),
        create: ({ data }: BaitCreateInput) => {
          const row = {
            ...namedRow(nextId('bait'), data.name, data.nameNormalized),
            type: data.type,
          };
          draft.baits.push(row);
          return Promise.resolve(row);
        },
      },
      screenAnchor: {
        findMany: () => Promise.resolve(draft.screenAnchors),
        create: ({ data }: NamedCreateInput) => {
          const row = namedRow(nextId('anchor'), data.name, data.nameNormalized);
          draft.screenAnchors.push(row);
          return Promise.resolve(row);
        },
      },
      location: {
        findMany: () => Promise.resolve(draft.locations),
        create: ({ data }: LocationCreateInput) => {
          const row = {
            ...namedRow(nextId('location'), data.name, data.nameNormalized),
            fishingBaseId: data.fishingBaseId,
            number: data.number,
          };
          draft.locations.push(row);
          return Promise.resolve(row);
        },
      },
      fishingBaseFish: {
        findMany: () => Promise.resolve(draft.memberships),
        create: ({ data }: MembershipCreateInput) => {
          draft.memberships.push(data);
          return Promise.resolve(data);
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
  void it('contains the exact approved additive Amur catalog shape', () => {
    const validated = validateCatalogSeedData(REAL_CATALOG_DATA);

    assert.equal(AMUR_FISH.length, 64);
    assert.equal(validated.fish.length, 64);
    assert.equal(validated.bases.length, 1);
    assert.equal(validated.bases[0]?.name, 'Амур');
    assert.deepEqual(
      validated.bases[0]?.locations.map(({ number, name }) => ({ number, name })),
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
    assert.equal(validated.bases[0]?.fishNormalized.length, 64);
    assert.equal(validated.baits.length, 0);
    assert.deepEqual(
      validated.screenAnchors.map((item) => item.name),
      ['Удочка', 'Леска', 'Блокнот', 'Рюкзак', 'Катушка', 'Чат', 'Снасти', 'События'],
    );
    assert.equal(AMUR_FISH.includes('Морская свянья обыкновенная'), true);
    assert.equal(
      AMUR_FISH.some((name) => name.endsWith(' (спиннинг)')),
      false,
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
    const database = new InMemoryCatalogDatabase(initial);

    const first = await seedCatalog(asPrisma(database));
    const second = await seedCatalog(asPrisma(database));

    assert.deepEqual(first, {
      fishingBases: { created: 1, reused: 0 },
      locations: { created: 9, reused: 0 },
      fish: { created: 64, reused: 0 },
      baits: { created: 0, reused: 0 },
      screenAnchors: { created: 8, reused: 0 },
      fishingBaseFish: { created: 64, reused: 0 },
      conflicts: 0,
      warnings: [],
    });
    assert.deepEqual(second, {
      fishingBases: { created: 0, reused: 1 },
      locations: { created: 0, reused: 9 },
      fish: { created: 0, reused: 64 },
      baits: { created: 0, reused: 0 },
      screenAnchors: { created: 0, reused: 8 },
      fishingBaseFish: { created: 0, reused: 64 },
      conflicts: 0,
      warnings: [],
    });
    assert.equal(database.state.fishingBases.length, 2);
    assert.equal(database.state.locations.length, 10);
    assert.equal(database.state.fish.length, 65);
    assert.equal(database.state.memberships.length, 64);
    assert.equal(database.state.screenAnchors.length, 8);
    assert.equal(database.state.baits.length, 1);
    assert.ok(database.state.fishingBases.some((item) => item.id === 'tutorial-base'));
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

  void it('fails safely if an exact legacy spinning Fish remains in the database', async () => {
    const initial = emptyState();
    initial.fish.push(namedRow('legacy-fish', 'Кижуч (спиннинг)', 'кижуч (спиннинг)'));
    const database = new InMemoryCatalogDatabase(initial);

    await assert.rejects(seedCatalog(asPrisma(database)), CatalogSeedConflictError);
    assert.deepEqual(database.state, initial);
  });
});
