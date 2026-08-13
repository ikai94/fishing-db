import { readFileSync } from 'node:fs';
import { CATALOG_BAIT_TYPES, type CatalogBaitType } from '../catalog/catalog.constants.js';

const CATALOG_SCHEMA_VERSION = 1;

export interface CatalogSeedLocationData {
  number: number;
  name: string;
}

export interface CatalogSeedFishingBaseData {
  name: string;
  locations: readonly CatalogSeedLocationData[];
  fish: readonly string[];
}

export interface CatalogSeedBaitData {
  name: string;
  type: CatalogBaitType;
}

export interface CatalogSeedData {
  fish: readonly string[];
  bases: readonly CatalogSeedFishingBaseData[];
  baits: readonly CatalogSeedBaitData[];
  screenAnchors: readonly string[];
}

export interface CanonicalFishingCatalogData {
  schemaVersion: 1;
  bases: readonly CatalogSeedFishingBaseData[];
}

export interface CanonicalBaitCatalogData {
  schemaVersion: 1;
  baits: readonly CatalogSeedBaitData[];
}

export interface CatalogSeedSnapshotCounts {
  fishingBases: number;
  locations: number;
  fish: number;
  fishingBaseFish: number;
  baits: number;
  baitTypes: Readonly<Record<CatalogBaitType, number>>;
  screenAnchors: number;
}

export const AUTHORITATIVE_CATALOG_COUNTS = {
  fishingBases: 77,
  locations: 853,
  fish: 1_255,
  fishingBaseFish: 5_369,
  baits: 249,
  baitTypes: {
    BAIT: 68,
    LURE: 181,
  },
  screenAnchors: 8,
} as const satisfies CatalogSeedSnapshotCounts;

export const CATALOG_SCREEN_ANCHORS = [
  'Удочка',
  'Леска',
  'Блокнот',
  'Рюкзак',
  'Катушка',
  'Чат',
  'Снасти',
  'События',
] as const;

export class CatalogSeedDataDecodeError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Catalog seed JSON is invalid:\n- ${issues.join('\n- ')}`);
    this.name = 'CatalogSeedDataDecodeError';
  }
}

export class CatalogSeedSnapshotError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Authoritative catalog snapshot has unexpected counts:\n- ${issues.join('\n- ')}`);
    this.name = 'CatalogSeedSnapshotError';
  }
}

type JsonObject = Record<string, unknown>;

function decodeFailure(path: string, message: string): never {
  throw new CatalogSeedDataDecodeError([`${path}: ${message}`]);
}

function decodeObject(value: unknown, path: string, expectedKeys: readonly string[]): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return decodeFailure(path, 'must be an object');
  }

  const object = value as JsonObject;
  const expected = new Set(expectedKeys);
  const missingKeys = expectedKeys.filter((key) => !Object.hasOwn(object, key));
  const unexpectedKeys = Object.keys(object).filter((key) => !expected.has(key));
  const issues = [
    ...missingKeys.map((key) => `${path}: missing required key "${key}"`),
    ...unexpectedKeys.map((key) => `${path}: unexpected key "${key}"`),
  ];

  if (issues.length > 0) {
    throw new CatalogSeedDataDecodeError(issues);
  }

  return object;
}

function decodeArray<T>(
  value: unknown,
  path: string,
  decodeItem: (item: unknown, itemPath: string) => T,
): T[] {
  if (!Array.isArray(value)) {
    return decodeFailure(path, 'must be an array');
  }

  return value.map((item, index) => decodeItem(item, `${path}[${index}]`));
}

function decodeString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    return decodeFailure(path, 'must be a string');
  }

  return value;
}

function decodeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return decodeFailure(path, 'must be a finite number');
  }

  return value;
}

function decodeSchemaVersion(value: unknown, path: string): 1 {
  if (value !== CATALOG_SCHEMA_VERSION) {
    return decodeFailure(path, `must equal ${CATALOG_SCHEMA_VERSION}`);
  }

  return CATALOG_SCHEMA_VERSION;
}

function decodeLocation(value: unknown, path: string): CatalogSeedLocationData {
  const object = decodeObject(value, path, ['number', 'name']);

  return {
    number: decodeNumber(object.number, `${path}.number`),
    name: decodeString(object.name, `${path}.name`),
  };
}

function decodeFishingBase(value: unknown, path: string): CatalogSeedFishingBaseData {
  const object = decodeObject(value, path, ['name', 'locations', 'fish']);

  return {
    name: decodeString(object.name, `${path}.name`),
    locations: decodeArray(object.locations, `${path}.locations`, decodeLocation),
    fish: decodeArray(object.fish, `${path}.fish`, decodeString),
  };
}

function decodeBaitType(value: unknown, path: string): CatalogBaitType {
  if (typeof value !== 'string' || !CATALOG_BAIT_TYPES.includes(value as CatalogBaitType)) {
    return decodeFailure(path, 'must be BAIT or LURE');
  }

  return value as CatalogBaitType;
}

function decodeBait(value: unknown, path: string): CatalogSeedBaitData {
  const object = decodeObject(value, path, ['name', 'type']);

  return {
    name: decodeString(object.name, `${path}.name`),
    type: decodeBaitType(object.type, `${path}.type`),
  };
}

export function decodeFishingCatalog(value: unknown): CanonicalFishingCatalogData {
  const path = 'fishingCatalog';
  const object = decodeObject(value, path, ['schemaVersion', 'bases']);

  return {
    schemaVersion: decodeSchemaVersion(object.schemaVersion, `${path}.schemaVersion`),
    bases: decodeArray(object.bases, `${path}.bases`, decodeFishingBase),
  };
}

export function decodeBaitCatalog(value: unknown): CanonicalBaitCatalogData {
  const path = 'baitCatalog';
  const object = decodeObject(value, path, ['schemaVersion', 'baits']);

  return {
    schemaVersion: decodeSchemaVersion(object.schemaVersion, `${path}.schemaVersion`),
    baits: decodeArray(object.baits, `${path}.baits`, decodeBait),
  };
}

export function createCatalogSeedData(
  fishingCatalog: CanonicalFishingCatalogData,
  baitCatalog: CanonicalBaitCatalogData,
): CatalogSeedData {
  const fish: string[] = [];
  const exactFishNames = new Set<string>();

  for (const fishingBase of fishingCatalog.bases) {
    for (const fishName of fishingBase.fish) {
      if (!exactFishNames.has(fishName)) {
        exactFishNames.add(fishName);
        fish.push(fishName);
      }
    }
  }

  return {
    fish,
    bases: fishingCatalog.bases,
    baits: baitCatalog.baits,
    screenAnchors: CATALOG_SCREEN_ANCHORS,
  };
}

export function getCatalogSeedSnapshotCounts(data: CatalogSeedData): CatalogSeedSnapshotCounts {
  const baitTypes: Record<CatalogBaitType, number> = { BAIT: 0, LURE: 0 };

  for (const bait of data.baits) {
    baitTypes[bait.type] += 1;
  }

  return {
    fishingBases: data.bases.length,
    locations: data.bases.reduce((total, base) => total + base.locations.length, 0),
    fish: data.fish.length,
    fishingBaseFish: data.bases.reduce((total, base) => total + base.fish.length, 0),
    baits: data.baits.length,
    baitTypes,
    screenAnchors: data.screenAnchors.length,
  };
}

export function assertAuthoritativeCatalogCounts(data: CatalogSeedData): void {
  const actual = getCatalogSeedSnapshotCounts(data);
  const expected = AUTHORITATIVE_CATALOG_COUNTS;
  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ['FishingBase', actual.fishingBases, expected.fishingBases],
    ['Location', actual.locations, expected.locations],
    ['Fish', actual.fish, expected.fish],
    ['FishingBaseFish', actual.fishingBaseFish, expected.fishingBaseFish],
    ['Bait', actual.baits, expected.baits],
    ['BAIT', actual.baitTypes.BAIT, expected.baitTypes.BAIT],
    ['LURE', actual.baitTypes.LURE, expected.baitTypes.LURE],
    ['ScreenAnchor', actual.screenAnchors, expected.screenAnchors],
  ];
  const issues = checks
    .filter(([, observed, wanted]) => observed !== wanted)
    .map(([kind, observed, wanted]) => `${kind}: expected ${wanted}, received ${observed}`);

  if (issues.length > 0) {
    throw new CatalogSeedSnapshotError(issues);
  }
}

function readJson(url: URL, label: string): unknown {
  const source = readFileSync(url, 'utf8');

  try {
    return JSON.parse(source) as unknown;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown JSON parse error';
    throw new CatalogSeedDataDecodeError([`${label}: malformed JSON (${detail})`]);
  }
}

export function loadCatalogSeedData(): CatalogSeedData {
  const fishingCatalog = decodeFishingCatalog(
    readJson(
      new URL('../../prisma/catalog-data/fishing-catalog.json', import.meta.url),
      'fishingCatalog',
    ),
  );
  const baitCatalog = decodeBaitCatalog(
    readJson(new URL('../../prisma/catalog-data/baits.json', import.meta.url), 'baitCatalog'),
  );

  return createCatalogSeedData(fishingCatalog, baitCatalog);
}

export const REAL_CATALOG_DATA = loadCatalogSeedData();

assertAuthoritativeCatalogCounts(REAL_CATALOG_DATA);

// Kept as a derived compatibility export; it is not a second source of Fish data.
export const AMUR_FISH =
  REAL_CATALOG_DATA.bases.find((fishingBase) => fishingBase.name === 'Амур')?.fish ?? [];
