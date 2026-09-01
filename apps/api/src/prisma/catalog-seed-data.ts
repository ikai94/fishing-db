import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CATALOG_BAIT_TYPES, type CatalogBaitType } from '../catalog/catalog.constants.js';

const CATALOG_SCHEMA_VERSION = 1;

export const AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256 =
  '58c13109fe71e3c041f40d6e721b6c6cd0d0bbade43fe7dc1b0063dd8ba7eac3';
export const AUTHORITATIVE_FISHING_BASE_FISH_TARGET_SHA256 =
  '086f34ad8e6a4c283483c02ad80fe4e203c3d1bff8a37f9324809c035c8e48fc';

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

export interface CanonicalFishingBaseFishSourceData {
  fileName: string;
  sha256: string;
  populatedFishRows: number;
  resolvedFishRows: number;
  unresolvedFishRows: number;
}

export interface CanonicalFishingBaseFishBaseData {
  name: string;
  sourceSheet: string;
  fishColumn: string;
  fish: readonly string[];
}

export interface CanonicalFishingBaseFishData {
  schemaVersion: 1;
  sourceWorkbook: CanonicalFishingBaseFishSourceData;
  bases: readonly CanonicalFishingBaseFishBaseData[];
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
  fishingBaseFish: 3_230,
  baits: 248,
  baitTypes: {
    BAIT: 68,
    LURE: 180,
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

function decodeNonNegativeInteger(value: unknown, path: string): number {
  const number = decodeNumber(value, path);

  if (!Number.isSafeInteger(number) || number < 0) {
    return decodeFailure(path, 'must be a non-negative safe integer');
  }

  return number;
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

function decodeFishingBaseFishSource(
  value: unknown,
  path: string,
): CanonicalFishingBaseFishSourceData {
  const object = decodeObject(value, path, [
    'fileName',
    'sha256',
    'populatedFishRows',
    'resolvedFishRows',
    'unresolvedFishRows',
  ]);

  return {
    fileName: decodeString(object.fileName, `${path}.fileName`),
    sha256: decodeString(object.sha256, `${path}.sha256`),
    populatedFishRows: decodeNonNegativeInteger(
      object.populatedFishRows,
      `${path}.populatedFishRows`,
    ),
    resolvedFishRows: decodeNonNegativeInteger(object.resolvedFishRows, `${path}.resolvedFishRows`),
    unresolvedFishRows: decodeNonNegativeInteger(
      object.unresolvedFishRows,
      `${path}.unresolvedFishRows`,
    ),
  };
}

function decodeFishingBaseFishBase(value: unknown, path: string): CanonicalFishingBaseFishBaseData {
  const object = decodeObject(value, path, ['name', 'sourceSheet', 'fishColumn', 'fish']);

  return {
    name: decodeString(object.name, `${path}.name`),
    sourceSheet: decodeString(object.sourceSheet, `${path}.sourceSheet`),
    fishColumn: decodeString(object.fishColumn, `${path}.fishColumn`),
    fish: decodeArray(object.fish, `${path}.fish`, decodeString),
  };
}

export function decodeFishingBaseFishCatalog(value: unknown): CanonicalFishingBaseFishData {
  const path = 'fishingBaseFishCatalog';
  const object = decodeObject(value, path, ['schemaVersion', 'sourceWorkbook', 'bases']);

  return {
    schemaVersion: decodeSchemaVersion(object.schemaVersion, `${path}.schemaVersion`),
    sourceWorkbook: decodeFishingBaseFishSource(object.sourceWorkbook, `${path}.sourceWorkbook`),
    bases: decodeArray(object.bases, `${path}.bases`, decodeFishingBaseFishBase),
  };
}

function assertFishingBaseFishManifest(
  fishingCatalog: CanonicalFishingCatalogData,
  membershipCatalog: CanonicalFishingBaseFishData,
  globalFish: readonly string[],
): void {
  const issues: string[] = [];
  const source = membershipCatalog.sourceWorkbook;

  if (source.fileName !== 'Klevalka-2026.xlsx') {
    issues.push('sourceWorkbook.fileName must equal "Klevalka-2026.xlsx"');
  }
  if (source.sha256 !== AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256) {
    issues.push('sourceWorkbook.sha256 does not match the approved workbook');
  }
  if (source.resolvedFishRows !== AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish) {
    issues.push(
      `sourceWorkbook.resolvedFishRows must equal ${String(AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish)}`,
    );
  }
  if (source.populatedFishRows !== source.resolvedFishRows + source.unresolvedFishRows) {
    issues.push('sourceWorkbook row counts are inconsistent');
  }

  const canonicalBaseNames = new Set(fishingCatalog.bases.map((base) => base.name));
  const canonicalFishNames = new Set(globalFish);
  const seenBases = new Set<string>();
  const seenSheets = new Set<string>();

  for (const [index, base] of membershipCatalog.bases.entries()) {
    const path = `fishingBaseFishCatalog.bases[${String(index)}]`;

    if (!canonicalBaseNames.has(base.name)) {
      issues.push(`${path}.name is not an exact canonical FishingBase name: "${base.name}"`);
    }
    if (seenBases.has(base.name)) issues.push(`${path}.name duplicates "${base.name}"`);
    else seenBases.add(base.name);
    if (seenSheets.has(base.sourceSheet)) {
      issues.push(`${path}.sourceSheet duplicates "${base.sourceSheet}"`);
    } else {
      seenSheets.add(base.sourceSheet);
    }
    if (!/^[A-Z]+$/u.test(base.fishColumn)) {
      issues.push(`${path}.fishColumn must be an uppercase spreadsheet column`);
    }

    const seenFish = new Set<string>();
    for (const [fishIndex, fishName] of base.fish.entries()) {
      const fishPath = `${path}.fish[${String(fishIndex)}]`;
      if (!canonicalFishNames.has(fishName)) {
        issues.push(`${fishPath} is not an exact canonical Fish name: "${fishName}"`);
      }
      if (seenFish.has(fishName)) issues.push(`${fishPath} duplicates "${fishName}"`);
      else seenFish.add(fishName);
    }
  }

  for (const baseName of canonicalBaseNames) {
    if (!seenBases.has(baseName)) {
      issues.push(`membership manifest is missing FishingBase "${baseName}"`);
    }
  }
  if (membershipCatalog.bases.length !== fishingCatalog.bases.length) {
    issues.push(
      `membership manifest must contain ${String(fishingCatalog.bases.length)} FishingBase rows`,
    );
  }
  const membershipCount = membershipCatalog.bases.reduce(
    (total, base) => total + base.fish.length,
    0,
  );
  if (membershipCount !== AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish) {
    issues.push(
      `membership manifest must contain ${String(AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish)} relationships`,
    );
  }
  const targetSha256 = createHash('sha256')
    .update(
      membershipCatalog.bases
        .flatMap((base) => base.fish.map((fishName) => `${base.name}\0${fishName}`))
        .sort()
        .join('\n'),
    )
    .digest('hex');
  if (targetSha256 !== AUTHORITATIVE_FISHING_BASE_FISH_TARGET_SHA256) {
    issues.push(
      'membership manifest canonical target fingerprint does not match the approved target',
    );
  }

  if (issues.length > 0) throw new CatalogSeedDataDecodeError(issues);
}

export function createCatalogSeedData(
  fishingCatalog: CanonicalFishingCatalogData,
  baitCatalog: CanonicalBaitCatalogData,
  membershipCatalog: CanonicalFishingBaseFishData,
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

  assertFishingBaseFishManifest(fishingCatalog, membershipCatalog, fish);
  const membershipByBaseName = new Map(
    membershipCatalog.bases.map((base) => [base.name, base.fish] as const),
  );
  const bases = fishingCatalog.bases.map((base) => {
    const membership = membershipByBaseName.get(base.name);

    if (membership === undefined) {
      throw new CatalogSeedDataDecodeError([
        `membership manifest is missing FishingBase "${base.name}"`,
      ]);
    }

    return { ...base, fish: membership };
  });

  return {
    fish,
    bases,
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
  const membershipCatalog = decodeFishingBaseFishCatalog(
    readJson(
      new URL('../../prisma/catalog-data/fishing-base-fish.json', import.meta.url),
      'fishingBaseFishCatalog',
    ),
  );

  return createCatalogSeedData(fishingCatalog, baitCatalog, membershipCatalog);
}

export const FISHING_BASE_FISH_MANIFEST = decodeFishingBaseFishCatalog(
  readJson(
    new URL('../../prisma/catalog-data/fishing-base-fish.json', import.meta.url),
    'fishingBaseFishCatalog',
  ),
);

export const REAL_CATALOG_DATA = loadCatalogSeedData();

assertAuthoritativeCatalogCounts(REAL_CATALOG_DATA);

// Kept as a derived compatibility export; it is not a second source of Fish data.
export const AMUR_FISH =
  REAL_CATALOG_DATA.bases.find((fishingBase) => fishingBase.name === 'Амур')?.fish ?? [];
