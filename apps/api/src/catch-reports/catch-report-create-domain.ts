import type { CatalogBaitType } from '../catalog/catalog.constants.js';
import { catalogErrors } from '../catalog/catalog-errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  catchReportObservationErrors,
  type CatchReportObservation,
} from './catch-report-observation.js';
import {
  normalizeRawSourceText,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
} from './catch-report-raw-note.js';
import type {
  CatchReportFishingMethod,
  CatchReportFishingNote,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from './catch-reports.constants.js';
import { catchReportErrors } from './catch-reports.errors.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';

export interface PreparedCatchReportCreate {
  fishingBaseId: string;
  data: {
    locationId: string;
    fishId: string;
    baitId: string;
    weightGrams: number;
    fishingMethod: CatchReportFishingMethod;
    holeDepthCm: number | null;
    spotPositionRaw: string | null;
    fishingNote: CatchReportFishingNote | null;
    spinningSize: CatchReportSpinningSize | null;
    spinningSpeed: CatchReportSpinningSpeed | null;
    userNoteRaw: string | null;
    rawSourceText: string | null;
  };
}

export function deriveFishingMethod(type: CatalogBaitType): CatchReportFishingMethod {
  return type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
}

export function assertCatchReportObservation(observation: CatchReportObservation): void {
  const errors = catchReportObservationErrors(observation);
  if (Object.keys(errors).length > 0) {
    throw catchReportErrors.observationValidation(errors);
  }
}

export async function validateCatchReportLocation(
  database: Prisma.TransactionClient,
  locationId: string,
): Promise<{ fishingBaseId: string }> {
  const location = await database.location.findUnique({
    where: { id: locationId },
    select: {
      fishingBaseId: true,
      isActive: true,
      fishingBase: { select: { isActive: true } },
    },
  });

  if (location === null) throw catalogErrors.locationNotFound();
  if (!location.fishingBase.isActive) throw catalogErrors.fishingBaseInactive();
  if (!location.isActive) throw catalogErrors.locationInactive();
  return { fishingBaseId: location.fishingBaseId };
}

export async function validateCatchReportFish(
  database: Prisma.TransactionClient,
  fishId: string,
): Promise<void> {
  const fish = await database.fish.findUnique({
    where: { id: fishId },
    select: { isActive: true },
  });

  if (fish === null) throw catalogErrors.fishNotFound();
  if (!fish.isActive) throw catalogErrors.fishInactive();
}

export async function validateCatchReportBait(
  database: Prisma.TransactionClient,
  baitId: string,
): Promise<{ type: CatalogBaitType }> {
  const bait = await database.bait.findUnique({
    where: { id: baitId },
    select: { isActive: true, type: true },
  });

  if (bait === null) throw catalogErrors.baitNotFound();
  if (!bait.isActive) throw catalogErrors.baitInactive();
  return { type: bait.type };
}

export async function validateCatchReportFishingBaseFish(
  database: Prisma.TransactionClient,
  fishingBaseId: string,
  fishId: string,
): Promise<void> {
  const relation = await database.fishingBaseFish.findUnique({
    where: { fishingBaseId_fishId: { fishingBaseId, fishId } },
    select: { fishingBaseId: true },
  });

  if (relation === null) throw catalogErrors.fishNotAvailableAtFishingBase();
}

export async function prepareCatchReportCreate(
  database: Prisma.TransactionClient,
  dto: CreateCatchReportDto,
): Promise<PreparedCatchReportCreate> {
  const location = await validateCatchReportLocation(database, dto.locationId);
  await validateCatchReportFish(database, dto.fishId);
  await validateCatchReportFishingBaseFish(database, location.fishingBaseId, dto.fishId);
  const bait = await validateCatchReportBait(database, dto.baitId);
  const fishingMethod = deriveFishingMethod(bait.type);
  const observation: CatchReportObservation = {
    fishingMethod,
    holeDepthCm: dto.holeDepthCm ?? null,
    spinningSize: dto.spinningSize ?? null,
    spinningSpeed: dto.spinningSpeed ?? null,
  };
  assertCatchReportObservation(observation);

  return {
    fishingBaseId: location.fishingBaseId,
    data: {
      locationId: dto.locationId,
      fishId: dto.fishId,
      baitId: dto.baitId,
      weightGrams: dto.weightGrams,
      fishingMethod,
      holeDepthCm: observation.holeDepthCm,
      spotPositionRaw: normalizeSpotPositionRaw(dto.spotPositionRaw),
      fishingNote: dto.fishingNote ?? null,
      spinningSize: observation.spinningSize,
      spinningSpeed: observation.spinningSpeed,
      userNoteRaw: normalizeUserNoteRaw(dto.userNoteRaw),
      rawSourceText: normalizeRawSourceText(dto.rawSourceText),
    },
  };
}
