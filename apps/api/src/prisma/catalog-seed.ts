import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { CATALOG_BAIT_TYPES, type CatalogBaitType } from '../catalog/catalog.constants.js';
import {
  CatalogNameValidationError,
  normalizeCatalogName,
  type NormalizedCatalogName,
} from '../catalog/catalog-normalization.js';
import { REAL_CATALOG_DATA, type CatalogSeedData } from './catalog-seed-data.js';

const POSTGRESQL_INTEGER_MAX = 2_147_483_647;
const SPINNING_FISH_SUFFIX = ' (спиннинг)';

interface ValidatedSeedLocation extends NormalizedCatalogName {
  number: number;
}

interface ValidatedSeedFishingBase extends NormalizedCatalogName {
  locations: ValidatedSeedLocation[];
  fishNormalized: string[];
}

interface ValidatedSeedBait extends NormalizedCatalogName {
  type: CatalogBaitType;
}

export interface ValidatedCatalogSeedData {
  fish: NormalizedCatalogName[];
  bases: ValidatedSeedFishingBase[];
  baits: ValidatedSeedBait[];
  screenAnchors: NormalizedCatalogName[];
}

export interface CatalogSeedCounter {
  created: number;
  reused: number;
}

export interface CatalogSeedSummary {
  fishingBases: CatalogSeedCounter;
  locations: CatalogSeedCounter;
  fish: CatalogSeedCounter;
  baits: CatalogSeedCounter;
  screenAnchors: CatalogSeedCounter;
  fishingBaseFish: CatalogSeedCounter;
  conflicts: 0;
  warnings: string[];
}

export class CatalogSeedValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Catalog seed data is invalid:\n- ${issues.join('\n- ')}`);
    this.name = 'CatalogSeedValidationError';
  }
}

export class CatalogSeedConflictError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Catalog seed conflicts with existing data:\n- ${issues.join('\n- ')}`);
    this.name = 'CatalogSeedConflictError';
  }
}

function validatedName(
  value: string,
  path: string,
  issues: string[],
): NormalizedCatalogName | undefined {
  try {
    return normalizeCatalogName(value);
  } catch (error: unknown) {
    if (error instanceof CatalogNameValidationError) {
      issues.push(`${path}: ${error.message}`);
      return undefined;
    }

    throw error;
  }
}

function recordDuplicate(
  seen: Map<string, string>,
  normalized: NormalizedCatalogName,
  path: string,
  kind: string,
  issues: string[],
): void {
  const previous = seen.get(normalized.nameNormalized);

  if (previous !== undefined) {
    issues.push(
      `${path}: duplicate normalized ${kind} name "${normalized.name}" (already declared at ${previous})`,
    );
    return;
  }

  seen.set(normalized.nameNormalized, path);
}

export function validateCatalogSeedData(data: CatalogSeedData): ValidatedCatalogSeedData {
  const issues: string[] = [];
  const fish: NormalizedCatalogName[] = [];
  const fishNames = new Map<string, string>();
  const semanticFishNames = new Map<string, string>();

  data.fish.forEach((value, index) => {
    const path = `fish[${index}]`;
    const normalized = validatedName(value, path, issues);

    if (normalized === undefined) {
      return;
    }

    recordDuplicate(fishNames, normalized, path, 'Fish', issues);
    fish.push(normalized);

    const hasMarker = normalized.name.endsWith(SPINNING_FISH_SUFFIX);
    const semanticName = hasMarker
      ? normalized.name.slice(0, -SPINNING_FISH_SUFFIX.length)
      : normalized.name;
    const semanticNormalized = validatedName(semanticName, `${path} canonical form`, issues);

    if (semanticNormalized !== undefined) {
      recordDuplicate(semanticFishNames, semanticNormalized, path, 'canonical Fish', issues);
    }

    if (hasMarker) {
      issues.push(`${path}: exact trailing "${SPINNING_FISH_SUFFIX}" marker is not allowed`);
    }
  });

  const fishIdentity = new Set(fish.map((item) => item.nameNormalized));
  const bases: ValidatedSeedFishingBase[] = [];
  const baseNames = new Map<string, string>();

  data.bases.forEach((baseValue, baseIndex) => {
    const basePath = `bases[${baseIndex}]`;
    const baseName = validatedName(baseValue.name, `${basePath}.name`, issues);
    const locations: ValidatedSeedLocation[] = [];
    const locationNumbers = new Map<number, string>();
    const locationNames = new Map<string, string>();

    baseValue.locations.forEach((locationValue, locationIndex) => {
      const locationPath = `${basePath}.locations[${locationIndex}]`;

      if (
        !Number.isInteger(locationValue.number) ||
        locationValue.number < 1 ||
        locationValue.number > POSTGRESQL_INTEGER_MAX
      ) {
        issues.push(`${locationPath}.number: must be a positive PostgreSQL integer`);
      }

      const previousNumber = locationNumbers.get(locationValue.number);

      if (previousNumber !== undefined) {
        issues.push(
          `${locationPath}.number: duplicate Location number ${locationValue.number} (already declared at ${previousNumber})`,
        );
      } else {
        locationNumbers.set(locationValue.number, locationPath);
      }

      const locationName = validatedName(locationValue.name, `${locationPath}.name`, issues);

      if (locationName !== undefined) {
        recordDuplicate(locationNames, locationName, locationPath, 'Location', issues);
        locations.push({ number: locationValue.number, ...locationName });
      }
    });

    const membershipNames = new Map<string, string>();
    const fishNormalized: string[] = [];

    baseValue.fish.forEach((fishValue, fishIndex) => {
      const membershipPath = `${basePath}.fish[${fishIndex}]`;
      const fishName = validatedName(fishValue, membershipPath, issues);

      if (fishName === undefined) {
        return;
      }

      recordDuplicate(
        membershipNames,
        fishName,
        membershipPath,
        'FishingBase/Fish membership',
        issues,
      );

      if (!fishIdentity.has(fishName.nameNormalized)) {
        issues.push(`${membershipPath}: references an unknown global Fish "${fishName.name}"`);
      }

      fishNormalized.push(fishName.nameNormalized);
    });

    if (baseName !== undefined) {
      recordDuplicate(baseNames, baseName, basePath, 'FishingBase', issues);
      bases.push({ ...baseName, locations, fishNormalized });
    }
  });

  const baitNames = new Map<string, string>();
  const baits: ValidatedSeedBait[] = [];

  data.baits.forEach((baitValue, index) => {
    const path = `baits[${index}]`;
    const baitName = validatedName(baitValue.name, `${path}.name`, issues);

    if (baitName !== undefined) {
      recordDuplicate(baitNames, baitName, path, 'Bait', issues);
    }

    if (!CATALOG_BAIT_TYPES.includes(baitValue.type)) {
      issues.push(`${path}.type: must be BAIT or LURE`);
      return;
    }

    if (baitName !== undefined) {
      baits.push({ ...baitName, type: baitValue.type });
    }
  });

  const anchorNames = new Map<string, string>();
  const screenAnchors: NormalizedCatalogName[] = [];

  data.screenAnchors.forEach((value, index) => {
    const path = `screenAnchors[${index}]`;
    const anchorName = validatedName(value, path, issues);

    if (anchorName !== undefined) {
      recordDuplicate(anchorNames, anchorName, path, 'ScreenAnchor', issues);
      screenAnchors.push(anchorName);
    }
  });

  if (issues.length > 0) {
    throw new CatalogSeedValidationError(issues);
  }

  return { fish, bases, baits, screenAnchors };
}

function emptyCounter(): CatalogSeedCounter {
  return { created: 0, reused: 0 };
}

function emptySummary(): CatalogSeedSummary {
  return {
    fishingBases: emptyCounter(),
    locations: emptyCounter(),
    fish: emptyCounter(),
    baits: emptyCounter(),
    screenAnchors: emptyCounter(),
    fishingBaseFish: emptyCounter(),
    conflicts: 0,
    warnings: [],
  };
}

interface ExistingNamedItem {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
}

function recordReuseWarning(
  kind: string,
  desired: NormalizedCatalogName,
  existing: ExistingNamedItem,
  warnings: string[],
): void {
  if (!existing.isActive) {
    warnings.push(`${kind} "${existing.name}" is inactive and was reused without reactivation`);
  }

  if (existing.name !== desired.name) {
    warnings.push(
      `${kind} normalized identity "${desired.nameNormalized}" already uses display name "${existing.name}"; seed name "${desired.name}" was not written`,
    );
  }
}

function indexNamed(items: ExistingNamedItem[]): Map<string, ExistingNamedItem> {
  return new Map(items.map((item) => [item.nameNormalized, item]));
}

function isPrismaConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'P2002' || error.code === 'P2003' || error.code === 'P2034';
}

function assertCreatedCount(kind: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `Catalog seed internal error: ${kind} createMany planned ${expected} row(s), created ${actual}`,
    );
  }
}

interface ExistingLocation extends ExistingNamedItem {
  fishingBaseId: string;
  number: number;
}

interface MissingLocation {
  fishingBaseNormalized: string;
  location: ValidatedSeedLocation;
}

interface MissingMembership {
  fishingBaseNormalized: string;
  fishNormalized: string;
}

interface ReusedLocation {
  desired: ValidatedSeedLocation;
  existing: ExistingLocation;
}

async function executeCatalogSeed(
  tx: Prisma.TransactionClient,
  data: ValidatedCatalogSeedData,
): Promise<CatalogSeedSummary> {
  const summary = emptySummary();
  const existingBases = await tx.fishingBase.findMany({
    where: { nameNormalized: { in: data.bases.map((item) => item.nameNormalized) } },
    select: { id: true, name: true, nameNormalized: true, isActive: true },
  });
  const existingFish = await tx.fish.findMany({
    select: { id: true, name: true, nameNormalized: true, isActive: true },
  });
  const existingBaits = await tx.bait.findMany({
    where: { nameNormalized: { in: data.baits.map((item) => item.nameNormalized) } },
    select: { id: true, name: true, nameNormalized: true, isActive: true, type: true },
  });
  const existingAnchors = await tx.screenAnchor.findMany({
    where: { nameNormalized: { in: data.screenAnchors.map((item) => item.nameNormalized) } },
    select: { id: true, name: true, nameNormalized: true, isActive: true },
  });

  const conflicts: string[] = [];
  const markedFish = existingFish
    .filter((item) => item.name.endsWith(SPINNING_FISH_SUFFIX))
    .map((item) => item.name)
    .sort();

  if (markedFish.length > 0) {
    conflicts.push(
      `legacy Fish with exact "${SPINNING_FISH_SUFFIX}" suffix remain: ${markedFish.join(', ')}`,
    );
  }

  const baseByNormalized = indexNamed(existingBases);
  const fishByNormalized = indexNamed(existingFish);
  const anchorByNormalized = indexNamed(existingAnchors);
  const baitByNormalized = new Map(existingBaits.map((item) => [item.nameNormalized, item]));
  const existingBaseIds = existingBases.map((item) => item.id);
  const existingLocations =
    existingBaseIds.length === 0
      ? []
      : await tx.location.findMany({
          where: { fishingBaseId: { in: existingBaseIds } },
          select: {
            id: true,
            fishingBaseId: true,
            number: true,
            name: true,
            nameNormalized: true,
            isActive: true,
          },
        });
  const desiredFishIdentities = new Set(data.fish.map((item) => item.nameNormalized));
  const existingTargetFishIds = existingFish
    .filter((item) => desiredFishIdentities.has(item.nameNormalized))
    .map((item) => item.id);
  const existingMemberships =
    existingBaseIds.length === 0 || existingTargetFishIds.length === 0
      ? []
      : await tx.fishingBaseFish.findMany({
          where: {
            fishingBaseId: { in: existingBaseIds },
            fishId: { in: existingTargetFishIds },
          },
          select: { fishingBaseId: true, fishId: true },
        });
  const membershipKeys = new Set(
    existingMemberships.map((item) => `${item.fishingBaseId}:${item.fishId}`),
  );
  const locationsByBaseId = new Map<string, ExistingLocation[]>();

  for (const location of existingLocations) {
    const locations = locationsByBaseId.get(location.fishingBaseId) ?? [];
    locations.push(location);
    locationsByBaseId.set(location.fishingBaseId, locations);
  }

  const missingLocations: MissingLocation[] = [];
  const reusedLocations: ReusedLocation[] = [];

  for (const desiredBase of data.bases) {
    const existingBase = baseByNormalized.get(desiredBase.nameNormalized);

    if (existingBase === undefined) {
      for (const desiredLocation of desiredBase.locations) {
        missingLocations.push({
          fishingBaseNormalized: desiredBase.nameNormalized,
          location: desiredLocation,
        });
      }
      continue;
    }

    const locations = locationsByBaseId.get(existingBase.id) ?? [];
    const locationByNumber = new Map(locations.map((location) => [location.number, location]));
    const locationByName = new Map(
      locations.map((location) => [location.nameNormalized, location]),
    );

    for (const desiredLocation of desiredBase.locations) {
      const byNumber = locationByNumber.get(desiredLocation.number);
      const byName = locationByName.get(desiredLocation.nameNormalized);

      if (byNumber !== undefined && byName !== undefined && byNumber.id !== byName.id) {
        conflicts.push(
          `FishingBase "${existingBase.name}": Location number ${desiredLocation.number} and normalized name "${desiredLocation.nameNormalized}" resolve to different rows`,
        );
      } else if (
        byNumber !== undefined &&
        byNumber.nameNormalized !== desiredLocation.nameNormalized
      ) {
        conflicts.push(
          `FishingBase "${existingBase.name}": Location number ${desiredLocation.number} already belongs to "${byNumber.name}"`,
        );
      } else if (byName !== undefined && byName.number !== desiredLocation.number) {
        conflicts.push(
          `FishingBase "${existingBase.name}": Location "${byName.name}" already uses number ${byName.number}`,
        );
      } else {
        const existingLocation = byNumber ?? byName;

        if (existingLocation === undefined) {
          missingLocations.push({
            fishingBaseNormalized: desiredBase.nameNormalized,
            location: desiredLocation,
          });
        } else {
          reusedLocations.push({ desired: desiredLocation, existing: existingLocation });
        }
      }
    }
  }

  for (const desiredBait of data.baits) {
    const existingBait = baitByNormalized.get(desiredBait.nameNormalized);

    if (existingBait !== undefined && existingBait.type !== desiredBait.type) {
      conflicts.push(
        `Bait "${existingBait.name}" has type ${existingBait.type}, expected ${desiredBait.type}`,
      );
    }
  }

  if (conflicts.length > 0) {
    throw new CatalogSeedConflictError(conflicts);
  }

  const missingFish: NormalizedCatalogName[] = [];

  for (const desiredFish of data.fish) {
    const fish = fishByNormalized.get(desiredFish.nameNormalized);

    if (fish === undefined) {
      missingFish.push(desiredFish);
    } else {
      summary.fish.reused += 1;
      recordReuseWarning('Fish', desiredFish, fish, summary.warnings);
    }
  }

  const missingBases: NormalizedCatalogName[] = [];

  for (const desiredBase of data.bases) {
    const fishingBase = baseByNormalized.get(desiredBase.nameNormalized);

    if (fishingBase === undefined) {
      missingBases.push(desiredBase);
    } else {
      summary.fishingBases.reused += 1;
      recordReuseWarning('FishingBase', desiredBase, fishingBase, summary.warnings);
    }
  }

  const missingBaits: ValidatedSeedBait[] = [];

  for (const desiredBait of data.baits) {
    const bait = baitByNormalized.get(desiredBait.nameNormalized);

    if (bait === undefined) {
      missingBaits.push(desiredBait);
    } else {
      summary.baits.reused += 1;
      recordReuseWarning('Bait', desiredBait, bait, summary.warnings);
    }
  }

  const missingAnchors: NormalizedCatalogName[] = [];

  for (const desiredAnchor of data.screenAnchors) {
    const anchor = anchorByNormalized.get(desiredAnchor.nameNormalized);

    if (anchor === undefined) {
      missingAnchors.push(desiredAnchor);
    } else {
      summary.screenAnchors.reused += 1;
      recordReuseWarning('ScreenAnchor', desiredAnchor, anchor, summary.warnings);
    }
  }

  for (const { desired, existing } of reusedLocations) {
    summary.locations.reused += 1;
    recordReuseWarning('Location', desired, existing, summary.warnings);
  }

  const missingMemberships: MissingMembership[] = [];

  for (const desiredBase of data.bases) {
    const fishingBase = baseByNormalized.get(desiredBase.nameNormalized);

    for (const fishNormalized of desiredBase.fishNormalized) {
      const fish = fishByNormalized.get(fishNormalized);
      const membershipKey =
        fishingBase === undefined || fish === undefined
          ? undefined
          : `${fishingBase.id}:${fish.id}`;

      if (membershipKey !== undefined && membershipKeys.has(membershipKey)) {
        summary.fishingBaseFish.reused += 1;
      } else {
        missingMemberships.push({
          fishingBaseNormalized: desiredBase.nameNormalized,
          fishNormalized,
        });
      }
    }
  }

  if (missingFish.length > 0) {
    const created = await tx.fish.createMany({ data: missingFish });
    assertCreatedCount('Fish', created.count, missingFish.length);
  }

  if (missingBases.length > 0) {
    const created = await tx.fishingBase.createMany({
      data: missingBases.map(({ name, nameNormalized }) => ({ name, nameNormalized })),
    });
    assertCreatedCount('FishingBase', created.count, missingBases.length);
  }

  if (missingBaits.length > 0) {
    const created = await tx.bait.createMany({ data: missingBaits });
    assertCreatedCount('Bait', created.count, missingBaits.length);
  }

  if (missingAnchors.length > 0) {
    const created = await tx.screenAnchor.createMany({ data: missingAnchors });
    assertCreatedCount('ScreenAnchor', created.count, missingAnchors.length);
  }

  const targetBases =
    data.bases.length === 0
      ? []
      : await tx.fishingBase.findMany({
          where: { nameNormalized: { in: data.bases.map((item) => item.nameNormalized) } },
          select: { id: true, name: true, nameNormalized: true, isActive: true },
        });
  const targetFish =
    data.fish.length === 0
      ? []
      : await tx.fish.findMany({
          where: { nameNormalized: { in: data.fish.map((item) => item.nameNormalized) } },
          select: { id: true, name: true, nameNormalized: true, isActive: true },
        });
  const targetBaseByNormalized = indexNamed(targetBases);
  const targetFishByNormalized = indexNamed(targetFish);

  for (const desiredBase of data.bases) {
    if (!targetBaseByNormalized.has(desiredBase.nameNormalized)) {
      throw new Error(
        `Catalog seed internal error: FishingBase identity "${desiredBase.nameNormalized}" is missing after createMany`,
      );
    }
  }

  for (const desiredFish of data.fish) {
    if (!targetFishByNormalized.has(desiredFish.nameNormalized)) {
      throw new Error(
        `Catalog seed internal error: Fish identity "${desiredFish.nameNormalized}" is missing after createMany`,
      );
    }
  }

  if (missingLocations.length > 0) {
    const locationRows = missingLocations.map(({ fishingBaseNormalized, location }) => {
      const fishingBase = targetBaseByNormalized.get(fishingBaseNormalized);

      if (fishingBase === undefined) {
        throw new Error('Catalog seed internal error: Location parent identity is missing');
      }

      return {
        fishingBaseId: fishingBase.id,
        number: location.number,
        name: location.name,
        nameNormalized: location.nameNormalized,
      };
    });
    const created = await tx.location.createMany({ data: locationRows });
    assertCreatedCount('Location', created.count, missingLocations.length);
  }

  if (missingMemberships.length > 0) {
    const membershipRows = missingMemberships.map(({ fishingBaseNormalized, fishNormalized }) => {
      const fishingBase = targetBaseByNormalized.get(fishingBaseNormalized);
      const fish = targetFishByNormalized.get(fishNormalized);

      if (fishingBase === undefined || fish === undefined) {
        throw new Error('Catalog seed internal error: FishingBaseFish parent identity is missing');
      }

      return { fishingBaseId: fishingBase.id, fishId: fish.id };
    });
    const created = await tx.fishingBaseFish.createMany({ data: membershipRows });
    assertCreatedCount('FishingBaseFish', created.count, missingMemberships.length);
  }

  summary.fish.created = missingFish.length;
  summary.fishingBases.created = missingBases.length;
  summary.baits.created = missingBaits.length;
  summary.screenAnchors.created = missingAnchors.length;
  summary.locations.created = missingLocations.length;
  summary.fishingBaseFish.created = missingMemberships.length;

  if (
    summary.locations.created + summary.locations.reused !==
    data.bases.reduce((total, base) => total + base.locations.length, 0)
  ) {
    throw new Error('Catalog seed internal error: Location plan is incomplete');
  }

  if (
    summary.fishingBaseFish.created + summary.fishingBaseFish.reused !==
    data.bases.reduce((total, base) => total + base.fishNormalized.length, 0)
  ) {
    throw new Error('Catalog seed internal error: FishingBaseFish plan is incomplete');
  }

  return summary;
}

export async function seedCatalog(
  prisma: PrismaClient,
  source: CatalogSeedData = REAL_CATALOG_DATA,
): Promise<CatalogSeedSummary> {
  const data = validateCatalogSeedData(source);

  try {
    return await prisma.$transaction((tx) => executeCatalogSeed(tx, data), {
      isolationLevel: 'Serializable',
      maxWait: 10_000,
      timeout: 60_000,
    });
  } catch (error: unknown) {
    if (error instanceof CatalogSeedValidationError || error instanceof CatalogSeedConflictError) {
      throw error;
    }

    if (isPrismaConflict(error)) {
      throw new CatalogSeedConflictError([
        'the catalog changed concurrently or a database uniqueness/foreign-key constraint rejected the plan; no seed writes were committed',
      ]);
    }

    throw error;
  }
}
