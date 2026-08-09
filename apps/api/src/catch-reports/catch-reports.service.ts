import { Inject, Injectable } from '@nestjs/common';
import type { CatalogBaitType } from '../catalog/catalog.constants.js';
import { catalogErrors, isPrismaError } from '../catalog/catalog-errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildCatchReportPage,
  catchReportCursorWhere,
  decodeCatchReportCursor,
  InvalidCatchReportCursorError,
  type CatchReportCursorWhere,
} from './catch-report-pagination.js';
import { normalizeUserNoteRaw } from './catch-report-raw-note.js';
import {
  CATCH_REPORT_DEFAULT_LIMIT,
  type CatchReportFishingNote,
  type CatchReportSpotLandmark,
} from './catch-reports.constants.js';
import { catchReportErrors } from './catch-reports.errors.js';
import type { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import type { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';

const PUBLIC_CATCH_REPORT_SELECT = {
  id: true,
  weightGrams: true,
  holeDepthCm: true,
  spotLandmark: true,
  fishingNote: true,
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
      type: true,
    },
  },
} as const;

interface PublicCatchReportRecord {
  id: string;
  weightGrams: number;
  holeDepthCm: number | null;
  spotLandmark: CatchReportSpotLandmark | null;
  fishingNote: CatchReportFishingNote | null;
  userNoteRaw: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    nickname: string;
  };
  location: {
    id: string;
    number: number;
    name: string;
    fishingBase: {
      id: string;
      name: string;
    };
  };
  fish: {
    id: string;
    name: string;
  };
  bait: {
    id: string;
    name: string;
    type: CatalogBaitType;
  };
}

interface CatchReportWriteData {
  locationId?: string;
  fishId?: string;
  baitId?: string;
  weightGrams?: number;
  holeDepthCm?: number | null;
  spotLandmark?: CatchReportSpotLandmark | null;
  fishingNote?: CatchReportFishingNote | null;
  userNoteRaw?: string | null;
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
      type: record.bait.type,
    },
    weightGrams: record.weightGrams,
    holeDepthCm: record.holeDepthCm,
    spotLandmark: record.spotLandmark,
    fishingNote: record.fishingNote,
    userNoteRaw: record.userNoteRaw,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function updateHasNoDefinedValues(dto: UpdateCatchReportDto): boolean {
  return [
    dto.locationId,
    dto.fishId,
    dto.baitId,
    dto.weightGrams,
    dto.holeDepthCm,
    dto.spotLandmark,
    dto.fishingNote,
    dto.userNoteRaw,
  ].every((value) => value === undefined);
}

function buildUpdateData(dto: UpdateCatchReportDto): CatchReportWriteData {
  const data: CatchReportWriteData = {};

  if (dto.locationId !== undefined) {
    data.locationId = dto.locationId;
  }

  if (dto.fishId !== undefined) {
    data.fishId = dto.fishId;
  }

  if (dto.baitId !== undefined) {
    data.baitId = dto.baitId;
  }

  if (dto.weightGrams !== undefined) {
    data.weightGrams = dto.weightGrams;
  }

  if (dto.holeDepthCm !== undefined) {
    data.holeDepthCm = dto.holeDepthCm;
  }

  if (dto.spotLandmark !== undefined) {
    data.spotLandmark = dto.spotLandmark;
  }

  if (dto.fishingNote !== undefined) {
    data.fishingNote = dto.fishingNote;
  }

  if (dto.userNoteRaw !== undefined) {
    data.userNoteRaw = normalizeUserNoteRaw(dto.userNoteRaw);
  }

  return data;
}

@Injectable()
export class CatchReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublic(query: CatchReportListQueryDto) {
    return this.list(query);
  }

  async listMine(actorUserId: string, query: CatchReportListQueryDto) {
    return this.list(query, actorUserId);
  }

  async getPublic(reportId: string) {
    const record = await this.prisma.catchReport.findUnique({
      where: { id: reportId },
      select: PUBLIC_CATCH_REPORT_SELECT,
    });

    if (record === null) {
      throw catchReportErrors.notFound();
    }

    return { report: toPublicCatchReport(record) };
  }

  async create(actorUserId: string, dto: CreateCatchReportDto) {
    await this.validateLocation(dto.locationId);
    await this.validateFish(dto.fishId);
    await this.validateBait(dto.baitId);
    await this.validateLocationFish(dto.locationId, dto.fishId);

    try {
      const record = await this.prisma.catchReport.create({
        data: {
          userId: actorUserId,
          locationId: dto.locationId,
          fishId: dto.fishId,
          baitId: dto.baitId,
          weightGrams: dto.weightGrams,
          holeDepthCm: dto.holeDepthCm ?? null,
          spotLandmark: dto.spotLandmark ?? null,
          fishingNote: dto.fishingNote ?? null,
          userNoteRaw: normalizeUserNoteRaw(dto.userNoteRaw),
        },
        select: PUBLIC_CATCH_REPORT_SELECT,
      });

      return { report: toPublicCatchReport(record) };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2003')) {
        throw catchReportErrors.referenceConflict();
      }

      throw error;
    }
  }

  async update(actorUserId: string, reportId: string, dto: UpdateCatchReportDto) {
    const current = await this.prisma.catchReport.findUnique({
      where: { id: reportId },
      select: {
        userId: true,
        locationId: true,
        fishId: true,
        baitId: true,
      },
    });

    if (current === null) {
      throw catchReportErrors.notFound();
    }

    if (current.userId !== actorUserId) {
      throw catchReportErrors.notOwned();
    }

    if (updateHasNoDefinedValues(dto)) {
      throw catchReportErrors.emptyUpdate();
    }

    const locationChanged = dto.locationId !== undefined && dto.locationId !== current.locationId;
    const fishChanged = dto.fishId !== undefined && dto.fishId !== current.fishId;
    const baitChanged = dto.baitId !== undefined && dto.baitId !== current.baitId;

    if (locationChanged || fishChanged) {
      const resultingLocationId = dto.locationId ?? current.locationId;
      const resultingFishId = dto.fishId ?? current.fishId;

      await this.validateLocation(resultingLocationId);
      await this.validateFish(resultingFishId);
      await this.validateLocationFish(resultingLocationId, resultingFishId);
    }

    if (baitChanged) {
      await this.validateBait(dto.baitId ?? current.baitId);
    }

    try {
      const record = await this.prisma.catchReport.update({
        where: {
          id: reportId,
          userId: actorUserId,
        },
        data: buildUpdateData(dto),
        select: PUBLIC_CATCH_REPORT_SELECT,
      });

      return { report: toPublicCatchReport(record) };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catchReportErrors.notFound();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catchReportErrors.referenceConflict();
      }

      throw error;
    }
  }

  async delete(actorUserId: string, reportId: string): Promise<void> {
    const current = await this.prisma.catchReport.findUnique({
      where: { id: reportId },
      select: { userId: true },
    });

    if (current === null) {
      throw catchReportErrors.notFound();
    }

    if (current.userId !== actorUserId) {
      throw catchReportErrors.notOwned();
    }

    try {
      await this.prisma.catchReport.delete({
        where: {
          id: reportId,
          userId: actorUserId,
        },
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catchReportErrors.notFound();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catchReportErrors.referenceConflict();
      }

      throw error;
    }
  }

  private async list(query: CatchReportListQueryDto, actorUserId?: string) {
    const limit = query.limit ?? CATCH_REPORT_DEFAULT_LIMIT;
    const cursorWhere = this.cursorWhere(query.cursor);
    const where = actorUserId === undefined ? cursorWhere : { userId: actorUserId, ...cursorWhere };
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

  private cursorWhere(cursor: string | undefined): CatchReportCursorWhere | object {
    if (cursor === undefined) {
      return {};
    }

    try {
      return catchReportCursorWhere(decodeCatchReportCursor(cursor));
    } catch (error: unknown) {
      if (error instanceof InvalidCatchReportCursorError) {
        throw catchReportErrors.invalidCursor();
      }

      throw error;
    }
  }

  private async validateLocation(locationId: string): Promise<void> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        isActive: true,
        fishingBase: { select: { isActive: true } },
      },
    });

    if (location === null) {
      throw catalogErrors.locationNotFound();
    }

    if (!location.fishingBase.isActive) {
      throw catalogErrors.fishingBaseInactive();
    }

    if (!location.isActive) {
      throw catalogErrors.locationInactive();
    }
  }

  private async validateFish(fishId: string): Promise<void> {
    const fish = await this.prisma.fish.findUnique({
      where: { id: fishId },
      select: { isActive: true },
    });

    if (fish === null) {
      throw catalogErrors.fishNotFound();
    }

    if (!fish.isActive) {
      throw catalogErrors.fishInactive();
    }
  }

  private async validateBait(baitId: string): Promise<void> {
    const bait = await this.prisma.bait.findUnique({
      where: { id: baitId },
      select: { isActive: true },
    });

    if (bait === null) {
      throw catalogErrors.baitNotFound();
    }

    if (!bait.isActive) {
      throw catalogErrors.baitInactive();
    }
  }

  private async validateLocationFish(locationId: string, fishId: string): Promise<void> {
    const locationFish = await this.prisma.locationFish.findUnique({
      where: {
        locationId_fishId: { locationId, fishId },
      },
      select: { locationId: true },
    });

    if (locationFish === null) {
      throw catalogErrors.fishNotAvailableAtLocation();
    }
  }
}
