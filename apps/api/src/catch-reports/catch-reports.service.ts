import { Inject, Injectable } from '@nestjs/common';
import type { CatalogBaitType } from '../catalog/catalog.constants.js';
import { catalogErrors, isPrismaError } from '../catalog/catalog-errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  catchReportObservationErrors,
  isCatchReportObservationComplete,
  type CatchReportObservation,
} from './catch-report-observation.js';
import {
  buildCatchReportPage,
  catchReportCursorWhere,
  decodeCatchReportCursor,
  InvalidCatchReportCursorError,
  type CatchReportCursorWhere,
} from './catch-report-pagination.js';
import {
  normalizeRawSourceText,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
} from './catch-report-raw-note.js';
import {
  CATCH_REPORT_DEFAULT_LIMIT,
  type CatchReportFishingMethod,
  type CatchReportFishingNote,
  type CatchReportSpinningSize,
  type CatchReportSpinningSpeed,
} from './catch-reports.constants.js';
import { catchReportErrors } from './catch-reports.errors.js';
import type { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import type { PublicCatchReportListQueryDto } from './dto/public-catch-report-list-query.dto.js';
import type { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';

const PUBLIC_CATCH_REPORT_SELECT = {
  id: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      nickname: true,
    },
  },
  location: {
    select: {
      id: true,
      number: true,
      name: true,
      fishingBase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  fish: {
    select: {
      id: true,
      name: true,
    },
  },
  bait: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const OWNER_CATCH_REPORT_SELECT = {
  id: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  rawSourceText: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      nickname: true,
    },
  },
  location: {
    select: {
      id: true,
      number: true,
      name: true,
      fishingBase: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  fish: {
    select: {
      id: true,
      name: true,
    },
  },
  bait: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

const OWNER_CATCH_REPORT_SCALAR_SELECT = {
  id: true,
  userId: true,
  locationId: true,
  fishId: true,
  baitId: true,
  weightGrams: true,
  fishingMethod: true,
  holeDepthCm: true,
  spotPositionRaw: true,
  fishingNote: true,
  spinningSize: true,
  spinningSpeed: true,
  userNoteRaw: true,
  rawSourceText: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

interface PublicCatchReportRecord {
  id: string;
  weightGrams: number;
  fishingMethod: CatchReportFishingMethod;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: CatchReportFishingNote | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
  userNoteRaw: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; nickname: string };
  location: {
    id: string;
    number: number;
    name: string;
    fishingBase: { id: string; name: string };
  };
  fish: { id: string; name: string };
  bait: { id: string; name: string };
}

interface OwnerCatchReportRecord extends PublicCatchReportRecord {
  rawSourceText: string | null;
}

interface CurrentCatchReportState {
  userId: string;
  locationId: string;
  fishId: string;
  baitId: string;
  fishingMethod: CatchReportFishingMethod;
  holeDepthCm: number | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
}

interface CatchReportWriteData {
  locationId?: string;
  fishId?: string;
  baitId?: string;
  weightGrams?: number;
  fishingMethod?: CatchReportFishingMethod;
  holeDepthCm?: number | null;
  spotPositionRaw?: string | null;
  fishingNote?: CatchReportFishingNote | null;
  spinningSize?: CatchReportSpinningSize | null;
  spinningSpeed?: CatchReportSpinningSpeed | null;
  userNoteRaw?: string | null;
}

interface PublicCatchReportFilters {
  fishId?: string;
  baseIds?: string[];
}

function toPublicCatchReport(record: PublicCatchReportRecord) {
  return {
    id: record.id,
    author: {
      id: record.user.id,
      nickname: record.user.nickname,
    },
    fishingBase: {
      id: record.location.fishingBase.id,
      name: record.location.fishingBase.name,
    },
    location: {
      id: record.location.id,
      number: record.location.number,
      name: record.location.name,
    },
    fish: {
      id: record.fish.id,
      name: record.fish.name,
    },
    bait: {
      id: record.bait.id,
      name: record.bait.name,
    },
    weightGrams: record.weightGrams,
    fishingMethod: record.fishingMethod,
    holeDepthCm: record.holeDepthCm,
    spotPositionRaw: record.spotPositionRaw,
    fishingNote: record.fishingNote,
    spinningSize: record.spinningSize,
    spinningSpeed: record.spinningSpeed,
    userNoteRaw: record.userNoteRaw,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toOwnerCatchReport(record: OwnerCatchReportRecord) {
  const publicReport = toPublicCatchReport(record);

  return {
    id: publicReport.id,
    author: publicReport.author,
    fishingBase: publicReport.fishingBase,
    location: publicReport.location,
    fish: publicReport.fish,
    bait: publicReport.bait,
    weightGrams: publicReport.weightGrams,
    fishingMethod: publicReport.fishingMethod,
    holeDepthCm: publicReport.holeDepthCm,
    spotPositionRaw: publicReport.spotPositionRaw,
    fishingNote: publicReport.fishingNote,
    spinningSize: publicReport.spinningSize,
    spinningSpeed: publicReport.spinningSpeed,
    userNoteRaw: publicReport.userNoteRaw,
    rawSourceText: record.rawSourceText,
    createdAt: publicReport.createdAt,
    updatedAt: publicReport.updatedAt,
  };
}

function updateHasNoDefinedValues(dto: UpdateCatchReportDto): boolean {
  return [
    dto.locationId,
    dto.fishId,
    dto.baitId,
    dto.weightGrams,
    dto.holeDepthCm,
    dto.spotPositionRaw,
    dto.fishingNote,
    dto.spinningSize,
    dto.spinningSpeed,
    dto.userNoteRaw,
  ].every((value) => value === undefined);
}

function buildUpdateData(dto: UpdateCatchReportDto): CatchReportWriteData {
  const data: CatchReportWriteData = {};

  if (dto.locationId !== undefined) data.locationId = dto.locationId;
  if (dto.fishId !== undefined) data.fishId = dto.fishId;
  if (dto.baitId !== undefined) data.baitId = dto.baitId;
  if (dto.weightGrams !== undefined) data.weightGrams = dto.weightGrams;
  if (dto.holeDepthCm !== undefined) data.holeDepthCm = dto.holeDepthCm;
  if (dto.spotPositionRaw !== undefined) {
    data.spotPositionRaw = normalizeSpotPositionRaw(dto.spotPositionRaw);
  }
  if (dto.fishingNote !== undefined) data.fishingNote = dto.fishingNote;
  if (dto.spinningSize !== undefined) data.spinningSize = dto.spinningSize;
  if (dto.spinningSpeed !== undefined) data.spinningSpeed = dto.spinningSpeed;
  if (dto.userNoteRaw !== undefined) data.userNoteRaw = normalizeUserNoteRaw(dto.userNoteRaw);

  return data;
}

function deriveFishingMethod(type: CatalogBaitType): CatchReportFishingMethod {
  return type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
}

function currentObservation(current: CurrentCatchReportState): CatchReportObservation {
  return {
    fishingMethod: current.fishingMethod,
    holeDepthCm: current.holeDepthCm,
    spinningSize: current.spinningSize,
    spinningSpeed: current.spinningSpeed,
  };
}

@Injectable()
export class CatchReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublic(query: PublicCatchReportListQueryDto) {
    return this.list(query, undefined, {
      fishId: query.fishId,
      baseIds: query.baseIds,
    });
  }

  async listMine(actorUserId: string, query: CatchReportListQueryDto) {
    return this.list(query, actorUserId);
  }

  async getPublic(reportId: string) {
    const record = await this.prisma.catchReport.findUnique({
      where: { id: reportId },
      select: PUBLIC_CATCH_REPORT_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();
    return { report: toPublicCatchReport(record) };
  }

  async getMine(actorUserId: string, reportId: string) {
    const record = await this.prisma.catchReport.findFirst({
      where: { id: reportId, userId: actorUserId },
      select: OWNER_CATCH_REPORT_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();
    return { report: toOwnerCatchReport(record) };
  }

  async create(actorUserId: string, dto: CreateCatchReportDto) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const location = await this.validateLocation(tx, dto.locationId);
        await this.validateFish(tx, dto.fishId);
        await this.validateFishingBaseFish(tx, location.fishingBaseId, dto.fishId);
        const bait = await this.validateBait(tx, dto.baitId);
        const fishingMethod = deriveFishingMethod(bait.type);
        const observation: CatchReportObservation = {
          fishingMethod,
          holeDepthCm: dto.holeDepthCm ?? null,
          spinningSize: dto.spinningSize ?? null,
          spinningSpeed: dto.spinningSpeed ?? null,
        };
        this.assertObservation(observation);

        const record = await tx.catchReport.create({
          data: {
            userId: actorUserId,
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
          select: { id: true },
        });

        return this.getMineInTransaction(tx, actorUserId, record.id);
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  async update(actorUserId: string, reportId: string, dto: UpdateCatchReportDto) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const current = await tx.catchReport.findUnique({
          where: { id: reportId },
          select: {
            userId: true,
            locationId: true,
            fishId: true,
            baitId: true,
            fishingMethod: true,
            holeDepthCm: true,
            spinningSize: true,
            spinningSpeed: true,
          },
        });

        if (current === null) throw catchReportErrors.notFound();
        if (current.userId !== actorUserId) throw catchReportErrors.notOwned();
        if (updateHasNoDefinedValues(dto)) throw catchReportErrors.emptyUpdate();

        const locationChanged =
          dto.locationId !== undefined && dto.locationId !== current.locationId;
        const fishChanged = dto.fishId !== undefined && dto.fishId !== current.fishId;
        const baitChanged = dto.baitId !== undefined && dto.baitId !== current.baitId;

        if (locationChanged || fishChanged) {
          const resultingLocationId = dto.locationId ?? current.locationId;
          const resultingFishId = dto.fishId ?? current.fishId;
          const location = await this.validateLocation(tx, resultingLocationId);
          await this.validateFish(tx, resultingFishId);
          await this.validateFishingBaseFish(tx, location.fishingBaseId, resultingFishId);
        }

        let fishingMethod: CatchReportFishingMethod = current.fishingMethod;
        const data = buildUpdateData(dto);

        if (baitChanged) {
          const bait = await this.validateBait(tx, dto.baitId ?? current.baitId);
          fishingMethod = deriveFishingMethod(bait.type);
          data.fishingMethod = fishingMethod;
        }

        let resultingSpinningSize =
          dto.spinningSize === undefined ? current.spinningSize : dto.spinningSize;
        let resultingSpinningSpeed =
          dto.spinningSpeed === undefined ? current.spinningSpeed : dto.spinningSpeed;

        if (baitChanged && fishingMethod === 'BAIT_FISHING') {
          resultingSpinningSize = null;
          resultingSpinningSpeed = null;
        }

        const observation: CatchReportObservation = {
          fishingMethod,
          holeDepthCm: dto.holeDepthCm === undefined ? current.holeDepthCm : dto.holeDepthCm,
          spinningSize: resultingSpinningSize,
          spinningSpeed: resultingSpinningSpeed,
        };
        const methodFieldsTouched =
          dto.holeDepthCm !== undefined ||
          dto.spinningSize !== undefined ||
          dto.spinningSpeed !== undefined;

        if (
          baitChanged ||
          methodFieldsTouched ||
          isCatchReportObservationComplete(currentObservation(current))
        ) {
          this.assertObservation(observation);
        }

        if (baitChanged && fishingMethod === 'BAIT_FISHING') {
          data.spinningSize = null;
          data.spinningSpeed = null;
        }

        const record = await tx.catchReport.update({
          where: { id: reportId, userId: actorUserId },
          data,
          select: { id: true },
        });

        return this.getMineInTransaction(tx, actorUserId, record.id);
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) throw catchReportErrors.notFound();
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  async delete(actorUserId: string, reportId: string): Promise<void> {
    try {
      await this.runSerializableTransaction(async (tx) => {
        await this.assertActorCanMutate(tx, actorUserId);
        const current = await tx.catchReport.findUnique({
          where: { id: reportId },
          select: { userId: true },
        });

        if (current === null) throw catchReportErrors.notFound();
        if (current.userId !== actorUserId) throw catchReportErrors.notOwned();

        await tx.catchReport.delete({
          where: { id: reportId, userId: actorUserId },
        });
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) throw catchReportErrors.notFound();
      if (isPrismaError(error, 'P2003') || isPrismaError(error, 'P2034')) {
        throw catchReportErrors.referenceConflict();
      }
      throw error;
    }
  }

  private async list(
    query: CatchReportListQueryDto,
    actorUserId?: string,
    publicFilters?: PublicCatchReportFilters,
  ) {
    const limit = query.limit ?? CATCH_REPORT_DEFAULT_LIMIT;
    const cursorWhere = this.cursorWhere(query.cursor);
    const filterWhere =
      publicFilters === undefined
        ? {}
        : {
            ...(publicFilters.fishId === undefined ? {} : { fishId: publicFilters.fishId }),
            ...(publicFilters.baseIds === undefined
              ? {}
              : {
                  location: {
                    fishingBaseId: { in: publicFilters.baseIds },
                  },
                }),
          };
    const where = {
      ...(actorUserId === undefined ? {} : { userId: actorUserId }),
      ...filterWhere,
      ...cursorWhere,
    };
    const fetchedRecords = await this.prisma.catchReport.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: PUBLIC_CATCH_REPORT_SELECT,
    });
    const page = buildCatchReportPage(fetchedRecords, limit);

    return {
      items: page.items.map(toPublicCatchReport),
      nextCursor: page.nextCursor,
    };
  }

  private async runSerializableTransaction<Result>(
    operation: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    let lastConflict: unknown;

    for (let attempt = 1; attempt <= SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
      } catch (error: unknown) {
        if (!isPrismaError(error, 'P2034')) throw error;
        lastConflict = error;
      }
    }

    throw lastConflict;
  }

  private cursorWhere(cursor: string | undefined): CatchReportCursorWhere | object {
    if (cursor === undefined) return {};

    try {
      return catchReportCursorWhere(decodeCatchReportCursor(cursor));
    } catch (error: unknown) {
      if (error instanceof InvalidCatchReportCursorError) {
        throw catchReportErrors.invalidCursor();
      }
      throw error;
    }
  }

  private async validateLocation(
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

  private async assertActorCanMutate(
    database: Prisma.TransactionClient,
    actorUserId: string,
  ): Promise<void> {
    const [actor] = await database.$queryRaw<Array<{ isBanned: boolean }>>`
      SELECT "isBanned"
      FROM "User"
      WHERE "id" = ${actorUserId}::uuid
      FOR SHARE
    `;

    if (actor?.isBanned) throw catchReportErrors.accountBanned();
    if (actor === undefined) throw catchReportErrors.referenceConflict();
  }

  private async getMineInTransaction(
    database: Prisma.TransactionClient,
    actorUserId: string,
    reportId: string,
  ) {
    const record = await database.catchReport.findFirst({
      where: { id: reportId, userId: actorUserId },
      select: OWNER_CATCH_REPORT_SCALAR_SELECT,
    });

    if (record === null) throw catchReportErrors.notFound();

    const user = await database.user.findUnique({
      where: { id: record.userId },
      select: { id: true, nickname: true },
    });
    const location = await database.location.findUnique({
      where: { id: record.locationId },
      select: { id: true, fishingBaseId: true, number: true, name: true },
    });
    const fishingBase =
      location === null
        ? null
        : await database.fishingBase.findUnique({
            where: { id: location.fishingBaseId },
            select: { id: true, name: true },
          });
    const fish = await database.fish.findUnique({
      where: { id: record.fishId },
      select: { id: true, name: true },
    });
    const bait = await database.bait.findUnique({
      where: { id: record.baitId },
      select: { id: true, name: true },
    });

    if (
      user === null ||
      location === null ||
      fishingBase === null ||
      fish === null ||
      bait === null
    ) {
      throw catchReportErrors.referenceConflict();
    }

    const ownerRecord: OwnerCatchReportRecord = {
      id: record.id,
      weightGrams: record.weightGrams,
      fishingMethod: record.fishingMethod,
      holeDepthCm: record.holeDepthCm,
      spotPositionRaw: record.spotPositionRaw,
      fishingNote: record.fishingNote,
      spinningSize: record.spinningSize,
      spinningSpeed: record.spinningSpeed,
      userNoteRaw: record.userNoteRaw,
      rawSourceText: record.rawSourceText,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      user,
      location: {
        id: location.id,
        number: location.number,
        name: location.name,
        fishingBase,
      },
      fish,
      bait,
    };

    return { report: toOwnerCatchReport(ownerRecord) };
  }

  private async validateFish(database: Prisma.TransactionClient, fishId: string): Promise<void> {
    const fish = await database.fish.findUnique({
      where: { id: fishId },
      select: { isActive: true },
    });

    if (fish === null) throw catalogErrors.fishNotFound();
    if (!fish.isActive) throw catalogErrors.fishInactive();
  }

  private async validateBait(
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

  private async validateFishingBaseFish(
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

  private assertObservation(observation: CatchReportObservation): void {
    const errors = catchReportObservationErrors(observation);
    if (Object.keys(errors).length > 0) {
      throw catchReportErrors.observationValidation(errors);
    }
  }
}
