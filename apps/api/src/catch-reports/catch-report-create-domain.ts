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

/** Канонические данные CatchReport после общей проверки ссылок и наблюдений. */
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

/** Сохраняет результат адресной проверки строки без остановки preflight всего batch. */
export type PreparedCatchReportCreateResult =
  { prepared: PreparedCatchReportCreate; error?: never } | { prepared?: never; error: unknown };

type LocationValidationRecord = {
  id: string;
  fishingBaseId: string;
  isActive: boolean;
  fishingBase: { isActive: boolean };
};

type ActiveRecord = { id: string; isActive: boolean };
type BaitValidationRecord = ActiveRecord & { type: CatalogBaitType };

/** Выводит сохраняемый исторический способ ловли из текущего типа выбранной приманки. */
export function deriveFishingMethod(type: CatalogBaitType): CatchReportFishingMethod {
  return type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
}

/** Проверяет совместимость наблюдений с уже выведенным способом ловли. */
export function assertCatchReportObservation(observation: CatchReportObservation): void {
  const errors = catchReportObservationErrors(observation);
  if (Object.keys(errors).length > 0) {
    throw catchReportErrors.observationValidation(errors);
  }
}

/** Проверяет существование и текущую активность Location вместе с владеющей Base. */
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

/** Проверяет, что выбранная Fish существует и активна в момент записи. */
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

/** Проверяет Bait и возвращает его тип для вывода fishingMethod. */
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

/**
 * Проверяет Base-scoped доступность Fish.
 *
 * Связь выводится через Location.fishingBaseId; отдельной Location–Fish membership в домене нет.
 */
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

/**
 * Выполняет общий доменный preflight одной записи для HTTP и offline-import.
 *
 * Подготовка не пишет в БД: она проверяет активные ссылки и Base–Fish membership, выводит
 * fishingMethod и возвращает канонические данные для атомарной вставки вызывающим кодом.
 */
export async function prepareCatchReportCreate(
  database: Prisma.TransactionClient,
  dto: CreateCatchReportDto,
): Promise<PreparedCatchReportCreate> {
  const location = await validateCatchReportLocation(database, dto.locationId);
  await validateCatchReportFish(database, dto.fishId);
  await validateCatchReportFishingBaseFish(database, location.fishingBaseId, dto.fishId);
  const bait = await validateCatchReportBait(database, dto.baitId);
  return buildPreparedCatchReportCreate(dto, location.fishingBaseId, bait.type);
}

/**
 * Выполняет общий batch-preflight с дедуплицированными чтениями каталога.
 *
 * Результат позиционно связан с DTO: HTTP адресует ошибку как reports.<index>.<field>, а
 * offline-import может указать точную исходную строку.
 */
export async function prepareCatchReportCreates(
  database: Prisma.TransactionClient,
  dtos: readonly CreateCatchReportDto[],
): Promise<PreparedCatchReportCreateResult[]> {
  const locationIds = [...new Set(dtos.map((dto) => dto.locationId))];
  const fishIds = [...new Set(dtos.map((dto) => dto.fishId))];
  const baitIds = [...new Set(dtos.map((dto) => dto.baitId))];
  const [locations, fish, baits] = await Promise.all([
    database.location.findMany({
      where: { id: { in: locationIds } },
      select: {
        id: true,
        fishingBaseId: true,
        isActive: true,
        fishingBase: { select: { isActive: true } },
      },
    }),
    database.fish.findMany({
      where: { id: { in: fishIds } },
      select: { id: true, isActive: true },
    }),
    database.bait.findMany({
      where: { id: { in: baitIds } },
      select: { id: true, isActive: true, type: true },
    }),
  ]);
  const locationsById = new Map(locations.map((item) => [item.id, item]));
  const fishById = new Map(fish.map((item) => [item.id, item]));
  const baitsById = new Map(baits.map((item) => [item.id, item]));
  const fishingBaseIds = [...new Set(locations.map((location) => location.fishingBaseId))];
  // Membership загружается по Base, полученным из Location, а не по самим Location.
  const memberships = await database.fishingBaseFish.findMany({
    where: {
      fishingBaseId: { in: fishingBaseIds },
      fishId: { in: fishIds },
    },
    select: { fishingBaseId: true, fishId: true },
  });
  const membershipKeys = new Set(memberships.map((item) => `${item.fishingBaseId}:${item.fishId}`));

  // Ошибка одной строки не останавливает preflight и не скрывает ошибки остальных строк batch.
  return dtos.map((dto) => {
    try {
      const location = validateLocationRecord(locationsById.get(dto.locationId));
      validateFishRecord(fishById.get(dto.fishId));
      if (!membershipKeys.has(`${location.fishingBaseId}:${dto.fishId}`)) {
        throw catalogErrors.fishNotAvailableAtFishingBase();
      }
      const bait = validateBaitRecord(baitsById.get(dto.baitId));
      return { prepared: buildPreparedCatchReportCreate(dto, location.fishingBaseId, bait.type) };
    } catch (error: unknown) {
      return { error };
    }
  });
}

/** Воспроизводит одиночную проверку Location над заранее загруженной batch-записью. */
function validateLocationRecord(
  location: LocationValidationRecord | undefined,
): LocationValidationRecord {
  if (location === undefined) throw catalogErrors.locationNotFound();
  if (!location.fishingBase.isActive) throw catalogErrors.fishingBaseInactive();
  if (!location.isActive) throw catalogErrors.locationInactive();
  return location;
}

/** Воспроизводит одиночную проверку Fish над заранее загруженной batch-записью. */
function validateFishRecord(fish: ActiveRecord | undefined): void {
  if (fish === undefined) throw catalogErrors.fishNotFound();
  if (!fish.isActive) throw catalogErrors.fishInactive();
}

/** Воспроизводит одиночную проверку Bait и возвращает его тип для доменного вывода. */
function validateBaitRecord(bait: BaitValidationRecord | undefined): BaitValidationRecord {
  if (bait === undefined) throw catalogErrors.baitNotFound();
  if (!bait.isActive) throw catalogErrors.baitInactive();
  return bait;
}

/** Собирает одинаковую сохраняемую форму после одиночного или пакетного preflight. */
function buildPreparedCatchReportCreate(
  dto: CreateCatchReportDto,
  fishingBaseId: string,
  baitType: CatalogBaitType,
): PreparedCatchReportCreate {
  const fishingMethod = deriveFishingMethod(baitType);
  const observation: CatchReportObservation = {
    fishingMethod,
    holeDepthCm: dto.holeDepthCm ?? null,
    spinningSize: dto.spinningSize ?? null,
    spinningSpeed: dto.spinningSpeed ?? null,
  };
  assertCatchReportObservation(observation);

  return {
    fishingBaseId,
    data: {
      locationId: dto.locationId,
      fishId: dto.fishId,
      baitId: dto.baitId,
      weightGrams: dto.weightGrams,
      fishingMethod,
      holeDepthCm: observation.holeDepthCm,
      // Непустые raw-поля сохраняются дословно; нормализатор меняет только пустую строку на null.
      spotPositionRaw: normalizeSpotPositionRaw(dto.spotPositionRaw),
      fishingNote: dto.fishingNote ?? null,
      spinningSize: observation.spinningSize,
      spinningSpeed: observation.spinningSpeed,
      userNoteRaw: normalizeUserNoteRaw(dto.userNoteRaw),
      rawSourceText: normalizeRawSourceText(dto.rawSourceText),
    },
  };
}
