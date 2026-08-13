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
  const markedFish = existingFish.filter((item) => item.name.endsWith(SPINNING_FISH_SUFFIX));

  if (markedFish.length > 0) {
    conflicts.push(
      `legacy Fish with exact "${SPINNING_FISH_SUFFIX}" suffix remain: ${markedFish.map((item) => item.name).join(', ')}`,
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

  for (const desiredBase of data.bases) {
    const existingBase = baseByNormalized.get(desiredBase.nameNormalized);

    if (existingBase === undefined) {
      continue;
    }

    const locations = existingLocations.filter(
      (location) => location.fishingBaseId === existingBase.id,
    );

    for (const desiredLocation of desiredBase.locations) {
      const byNumber = locations.find((location) => location.number === desiredLocation.number);
      const byName = locations.find(
        (location) => location.nameNormalized === desiredLocation.nameNormalized,
      );

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

  for (const desiredFish of data.fish) {
    let fish = fishByNormalized.get(desiredFish.nameNormalized);

    if (fish === undefined) {
      fish = await tx.fish.create({
        data: desiredFish,
        select: { id: true, name: true, nameNormalized: true, isActive: true },
      });
      fishByNormalized.set(fish.nameNormalized, fish);
      summary.fish.created += 1;
    } else {
      summary.fish.reused += 1;
      recordReuseWarning('Fish', desiredFish, fish, summary.warnings);
    }
  }

  for (const desiredBase of data.bases) {
    let fishingBase = baseByNormalized.get(desiredBase.nameNormalized);

    if (fishingBase === undefined) {
      fishingBase = await tx.fishingBase.create({
        data: { name: desiredBase.name, nameNormalized: desiredBase.nameNormalized },
        select: { id: true, name: true, nameNormalized: true, isActive: true },
      });
      baseByNormalized.set(fishingBase.nameNormalized, fishingBase);
      summary.fishingBases.created += 1;
    } else {
      summary.fishingBases.reused += 1;
      recordReuseWarning('FishingBase', desiredBase, fishingBase, summary.warnings);
    }
  }

  for (const desiredBait of data.baits) {
    let bait = baitByNormalized.get(desiredBait.nameNormalized);

    if (bait === undefined) {
      bait = await tx.bait.create({
        data: desiredBait,
        select: { id: true, name: true, nameNormalized: true, isActive: true, type: true },
      });
      baitByNormalized.set(bait.nameNormalized, bait);
      summary.baits.created += 1;
    } else {
      summary.baits.reused += 1;
      recordReuseWarning('Bait', desiredBait, bait, summary.warnings);
    }
  }

  for (const desiredAnchor of data.screenAnchors) {
    let anchor = anchorByNormalized.get(desiredAnchor.nameNormalized);

    if (anchor === undefined) {
      anchor = await tx.screenAnchor.create({
        data: desiredAnchor,
        select: { id: true, name: true, nameNormalized: true, isActive: true },
      });
      anchorByNormalized.set(anchor.nameNormalized, anchor);
      summary.screenAnchors.created += 1;
    } else {
      summary.screenAnchors.reused += 1;
      recordReuseWarning('ScreenAnchor', desiredAnchor, anchor, summary.warnings);
    }
  }

  for (const desiredBase of data.bases) {
    const fishingBase = baseByNormalized.get(desiredBase.nameNormalized);

    if (fishingBase === undefined) {
      throw new Error('Catalog seed internal error: FishingBase identity is missing');
    }

    const currentLocations = existingLocations.filter(
      (location) => location.fishingBaseId === fishingBase.id,
    );

    for (const desiredLocation of desiredBase.locations) {
      const existingLocation = currentLocations.find(
        (location) =>
          location.number === desiredLocation.number &&
          location.nameNormalized === desiredLocation.nameNormalized,
      );

      if (existingLocation === undefined) {
        const created = await tx.location.create({
          data: {
            fishingBaseId: fishingBase.id,
            number: desiredLocation.number,
            name: desiredLocation.name,
            nameNormalized: desiredLocation.nameNormalized,
          },
          select: { id: true },
        });
        currentLocations.push({
          id: created.id,
          fishingBaseId: fishingBase.id,
          number: desiredLocation.number,
          name: desiredLocation.name,
          nameNormalized: desiredLocation.nameNormalized,
          isActive: true,
        });
        summary.locations.created += 1;
      } else {
        summary.locations.reused += 1;
        recordReuseWarning('Location', desiredLocation, existingLocation, summary.warnings);
      }
    }

    for (const fishNormalized of desiredBase.fishNormalized) {
      const fish = fishByNormalized.get(fishNormalized);

      if (fish === undefined) {
        throw new Error('Catalog seed internal error: Fish identity is missing');
      }

      const membershipKey = `${fishingBase.id}:${fish.id}`;

      if (membershipKeys.has(membershipKey)) {
        summary.fishingBaseFish.reused += 1;
        continue;
      }

      await tx.fishingBaseFish.create({
        data: { fishingBaseId: fishingBase.id, fishId: fish.id },
        select: { fishingBaseId: true },
      });
      membershipKeys.add(membershipKey);
      summary.fishingBaseFish.created += 1;
    }
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
