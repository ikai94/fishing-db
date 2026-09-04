import { Inject, Injectable } from '@nestjs/common';
import { ActivityEventWriter } from '../activity/activity-event-writer.service.js';
import type {
  ActivityChange,
  FishingBaseFishActivitySnapshot,
} from '../activity/activity-event.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogBaitType } from './catalog.constants.js';
import {
  catalogErrors,
  catalogNameValidationException,
  emptyUpdateException,
  invalidFishingBaseFishWeightBoundsException,
  isPrismaError,
  isPrismaUniqueConstraintErrorFor,
} from './catalog-errors.js';
import {
  CatalogNameValidationError,
  normalizeCatalogName,
  type NormalizedCatalogName,
} from './catalog-normalization.js';
import type { AddFishingBaseFishDto } from './dto/add-fishing-base-fish.dto.js';
import type { CreateBaitDto } from './dto/create-bait.dto.js';
import type { CreateFishDto } from './dto/create-fish.dto.js';
import type { CreateFishingBaseDto } from './dto/create-fishing-base.dto.js';
import type { CreateLocationDto } from './dto/create-location.dto.js';
import type { CreateScreenAnchorDto } from './dto/create-screen-anchor.dto.js';
import type { UpdateBaitDto } from './dto/update-bait.dto.js';
import type { UpdateFishDto } from './dto/update-fish.dto.js';
import type { UpdateFishingBaseFishDto } from './dto/update-fishing-base-fish.dto.js';
import type { UpdateFishingBaseDto } from './dto/update-fishing-base.dto.js';
import type { UpdateLocationDto } from './dto/update-location.dto.js';
import type { UpdateScreenAnchorDto } from './dto/update-screen-anchor.dto.js';

const ADMIN_NAMED_ITEM_SELECT = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADMIN_LOCATION_SELECT = {
  id: true,
  fishingBaseId: true,
  number: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADMIN_FISHING_BASE_FISH_SELECT = {
  fishingBaseId: true,
  fishId: true,
  minWeightGrams: true,
  maxWeightGrams: true,
  createdAt: true,
} as const;

const ACTIVITY_FISHING_BASE_FISH_SELECT = {
  ...ADMIN_FISHING_BASE_FISH_SELECT,
  fishingBase: { select: { id: true, name: true } },
  fish: { select: { id: true, name: true } },
} as const;

const LEGACY_SPINNING_FISH_SUFFIX = ' (спиннинг)';
const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

function validatedCatalogName(value: string): NormalizedCatalogName {
  try {
    return normalizeCatalogName(value);
  } catch (error: unknown) {
    if (error instanceof CatalogNameValidationError) {
      throw catalogNameValidationException(error.issue);
    }

    throw error;
  }
}

function validatedFishName(value: string): NormalizedCatalogName {
  const name = validatedCatalogName(value);

  if (name.name.endsWith(LEGACY_SPINNING_FISH_SUFFIX)) {
    throw catalogNameValidationException({
      field: 'name',
      code: 'INVALID_CATALOG_NAME',
      message: 'Название рыбы не должно содержать устаревшую пометку «(спиннинг)»',
    });
  }

  return name;
}

function hasNoDefinedValues(values: unknown[]): boolean {
  return values.every((item) => item === undefined);
}

function activityChanges(
  entries: Array<
    [
      field: string,
      before: string | number | boolean | null,
      after: string | number | boolean | null,
    ]
  >,
): ActivityChange[] {
  return entries
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({ field, before, after }));
}

function membershipActivitySnapshot(record: {
  fishingBase: { id: string; name: string };
  fish: { id: string; name: string };
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}): FishingBaseFishActivitySnapshot {
  return {
    fishingBase: record.fishingBase,
    fish: record.fish,
    minWeightGrams: record.minWeightGrams,
    maxWeightGrams: record.maxWeightGrams,
  };
}

@Injectable()
export class CatalogAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityEventWriter) private readonly activityEvents: ActivityEventWriter,
  ) {}

  async createFishingBase(actorUserId: string, dto: CreateFishingBaseDto) {
    const name = validatedCatalogName(dto.name);

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const fishingBase = await tx.fishingBase.create({
          data: name,
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATALOG_ITEM_CREATED',
          subjectType: 'FISHING_BASE',
          subjectKey: fishingBase.id,
          payload: {
            item: {
              kind: 'FISHING_BASE',
              id: fishingBase.id,
              name: fishingBase.name,
              isActive: fishingBase.isActive,
            },
          },
        });
        return { base: fishingBase };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishingBaseNameExists();
      }

      throw error;
    }
  }

  async updateFishingBase(actorUserId: string, baseId: string, dto: UpdateFishingBaseDto) {
    if (hasNoDefinedValues([dto.name, dto.isActive])) {
      throw emptyUpdateException();
    }

    const data: { name?: string; nameNormalized?: string; isActive?: boolean } = {};

    if (dto.name !== undefined) {
      Object.assign(data, validatedCatalogName(dto.name));
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const before = await tx.fishingBase.findUnique({
          where: { id: baseId },
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        if (before === null) throw catalogErrors.fishingBaseNotFound();

        const fishingBase = await tx.fishingBase.update({
          where: { id: baseId },
          data,
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        const changes = activityChanges([
          ['name', before.name, fishingBase.name],
          ['isActive', before.isActive, fishingBase.isActive],
        ]);
        if (changes.length > 0) {
          await this.activityEvents.append(tx, actorUserId, {
            type: 'CATALOG_ITEM_UPDATED',
            subjectType: 'FISHING_BASE',
            subjectKey: fishingBase.id,
            payload: {
              item: {
                kind: 'FISHING_BASE',
                id: fishingBase.id,
                name: fishingBase.name,
                isActive: fishingBase.isActive,
              },
              changes,
            },
          });
        }
        return { base: fishingBase };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.fishingBaseNotFound();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishingBaseNameExists();
      }

      throw error;
    }
  }

  async createLocation(actorUserId: string, baseId: string, dto: CreateLocationDto) {
    const name = validatedCatalogName(dto.name);

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const fishingBase = await tx.fishingBase.findUnique({
          where: { id: baseId },
          select: { id: true, name: true, isActive: true },
        });

        if (fishingBase === null) throw catalogErrors.fishingBaseNotFound();
        if (!fishingBase.isActive) throw catalogErrors.fishingBaseInactive();

        const location = await tx.location.create({
          data: {
            fishingBaseId: baseId,
            number: dto.number,
            ...name,
          },
          select: ADMIN_LOCATION_SELECT,
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATALOG_ITEM_CREATED',
          subjectType: 'LOCATION',
          subjectKey: location.id,
          payload: {
            item: {
              kind: 'LOCATION',
              id: location.id,
              name: location.name,
              number: location.number,
              isActive: location.isActive,
              fishingBase: { id: fishingBase.id, name: fishingBase.name },
            },
          },
        });
        return { location };
      });
    } catch (error: unknown) {
      if (isPrismaUniqueConstraintErrorFor(error, 'number')) {
        throw catalogErrors.locationNumberExists();
      }

      if (isPrismaUniqueConstraintErrorFor(error, 'namenormalized')) {
        throw catalogErrors.locationNameExists();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.catalogConflict();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catalogErrors.fishingBaseNotFound();
      }

      throw error;
    }
  }

  async updateLocation(actorUserId: string, locationId: string, dto: UpdateLocationDto) {
    if (hasNoDefinedValues([dto.number, dto.name, dto.isActive])) {
      throw emptyUpdateException();
    }

    const data: {
      number?: number;
      name?: string;
      nameNormalized?: string;
      isActive?: boolean;
    } = {};

    if (dto.number !== undefined) {
      data.number = dto.number;
    }

    if (dto.name !== undefined) {
      Object.assign(data, validatedCatalogName(dto.name));
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const before = await tx.location.findUnique({
          where: { id: locationId },
          select: {
            ...ADMIN_LOCATION_SELECT,
            fishingBase: { select: { id: true, name: true, isActive: true } },
          },
        });

        if (before === null) throw catalogErrors.locationNotFound();
        if (dto.isActive === true && !before.fishingBase.isActive) {
          throw catalogErrors.fishingBaseInactive();
        }

        const location = await tx.location.update({
          where: { id: locationId },
          data,
          select: ADMIN_LOCATION_SELECT,
        });
        const changes = activityChanges([
          ['name', before.name, location.name],
          ['number', before.number, location.number],
          ['isActive', before.isActive, location.isActive],
        ]);
        if (changes.length > 0) {
          await this.activityEvents.append(tx, actorUserId, {
            type: 'CATALOG_ITEM_UPDATED',
            subjectType: 'LOCATION',
            subjectKey: location.id,
            payload: {
              item: {
                kind: 'LOCATION',
                id: location.id,
                name: location.name,
                number: location.number,
                isActive: location.isActive,
                fishingBase: {
                  id: before.fishingBase.id,
                  name: before.fishingBase.name,
                },
              },
              changes,
            },
          });
        }
        return { location };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.locationNotFound();
      }

      if (isPrismaUniqueConstraintErrorFor(error, 'number')) {
        throw catalogErrors.locationNumberExists();
      }

      if (isPrismaUniqueConstraintErrorFor(error, 'namenormalized')) {
        throw catalogErrors.locationNameExists();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.catalogConflict();
      }

      throw error;
    }
  }

  async createFish(actorUserId: string, dto: CreateFishDto) {
    const name = validatedFishName(dto.name);

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const fish = await tx.fish.create({
          data: name,
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATALOG_ITEM_CREATED',
          subjectType: 'FISH',
          subjectKey: fish.id,
          payload: {
            item: {
              kind: 'FISH',
              id: fish.id,
              name: fish.name,
              isActive: fish.isActive,
            },
          },
        });
        return { fish };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishNameExists();
      }

      throw error;
    }
  }

  async updateFish(actorUserId: string, fishId: string, dto: UpdateFishDto) {
    if (hasNoDefinedValues([dto.name, dto.isActive])) {
      throw emptyUpdateException();
    }

    const data: { name?: string; nameNormalized?: string; isActive?: boolean } = {};

    if (dto.name !== undefined) {
      Object.assign(data, validatedFishName(dto.name));
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const before = await tx.fish.findUnique({
          where: { id: fishId },
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        if (before === null) throw catalogErrors.fishNotFound();

        const fish = await tx.fish.update({
          where: { id: fishId },
          data,
          select: ADMIN_NAMED_ITEM_SELECT,
        });
        const changes = activityChanges([
          ['name', before.name, fish.name],
          ['isActive', before.isActive, fish.isActive],
        ]);
        if (changes.length > 0) {
          await this.activityEvents.append(tx, actorUserId, {
            type: 'CATALOG_ITEM_UPDATED',
            subjectType: 'FISH',
            subjectKey: fish.id,
            payload: {
              item: { kind: 'FISH', id: fish.id, name: fish.name, isActive: fish.isActive },
              changes,
            },
          });
        }
        return { fish };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.fishNotFound();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishNameExists();
      }

      throw error;
    }
  }

  async createBait(actorUserId: string, dto: CreateBaitDto) {
    const name = validatedCatalogName(dto.name);

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const bait = await tx.bait.create({
          data: {
            ...name,
            type: dto.type,
          },
          select: {
            ...ADMIN_NAMED_ITEM_SELECT,
            type: true,
          },
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'CATALOG_ITEM_CREATED',
          subjectType: 'BAIT',
          subjectKey: bait.id,
          payload: {
            item: {
              kind: 'BAIT',
              id: bait.id,
              name: bait.name,
              type: bait.type,
              isActive: bait.isActive,
            },
          },
        });
        return { bait };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.baitNameExists();
      }

      throw error;
    }
  }

  async updateBait(actorUserId: string, baitId: string, dto: UpdateBaitDto) {
    if (hasNoDefinedValues([dto.name, dto.type, dto.isActive])) {
      throw emptyUpdateException();
    }

    const data: {
      name?: string;
      nameNormalized?: string;
      type?: CatalogBaitType;
      isActive?: boolean;
    } = {};

    if (dto.name !== undefined) {
      Object.assign(data, validatedCatalogName(dto.name));
    }

    if (dto.type !== undefined) {
      data.type = dto.type;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      return await this.runSerializableTransaction(async (tx) => {
        const select = { ...ADMIN_NAMED_ITEM_SELECT, type: true } as const;
        const before = await tx.bait.findUnique({ where: { id: baitId }, select });
        if (before === null) throw catalogErrors.baitNotFound();

        const bait = await tx.bait.update({
          where: { id: baitId },
          data,
          select,
        });
        const changes = activityChanges([
          ['name', before.name, bait.name],
          ['type', before.type, bait.type],
          ['isActive', before.isActive, bait.isActive],
        ]);
        if (changes.length > 0) {
          await this.activityEvents.append(tx, actorUserId, {
            type: 'CATALOG_ITEM_UPDATED',
            subjectType: 'BAIT',
            subjectKey: bait.id,
            payload: {
              item: {
                kind: 'BAIT',
                id: bait.id,
                name: bait.name,
                type: bait.type,
                isActive: bait.isActive,
              },
              changes,
            },
          });
        }
        return { bait };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.baitNotFound();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.baitNameExists();
      }

      throw error;
    }
  }

  async createScreenAnchor(dto: CreateScreenAnchorDto) {
    const name = validatedCatalogName(dto.name);

    try {
      const screenAnchor = await this.prisma.screenAnchor.create({
        data: name,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { screenAnchor };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.screenAnchorNameExists();
      }

      throw error;
    }
  }

  async updateScreenAnchor(anchorId: string, dto: UpdateScreenAnchorDto) {
    if (hasNoDefinedValues([dto.name, dto.isActive])) {
      throw emptyUpdateException();
    }

    const data: { name?: string; nameNormalized?: string; isActive?: boolean } = {};

    if (dto.name !== undefined) {
      Object.assign(data, validatedCatalogName(dto.name));
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      const screenAnchor = await this.prisma.screenAnchor.update({
        where: { id: anchorId },
        data,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { screenAnchor };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.screenAnchorNotFound();
      }

      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.screenAnchorNameExists();
      }

      throw error;
    }
  }

  async addFishToFishingBase(actorUserId: string, baseId: string, dto: AddFishingBaseFishDto) {
    try {
      return await this.runSerializableTransaction(async (tx) => {
        const [fishingBase] = await tx.$queryRaw<
          Array<{ id: string; name: string; isActive: boolean }>
        >`
          SELECT "id", "name", "isActive"
          FROM "FishingBase"
          WHERE "id" = ${baseId}::uuid
          FOR SHARE
        `;

        if (fishingBase === undefined) {
          throw catalogErrors.fishingBaseNotFound();
        }

        if (!fishingBase.isActive) {
          throw catalogErrors.fishingBaseInactive();
        }

        const [fish] = await tx.$queryRaw<Array<{ id: string; name: string; isActive: boolean }>>`
          SELECT "id", "name", "isActive"
          FROM "Fish"
          WHERE "id" = ${dto.fishId}::uuid
          FOR SHARE
        `;

        if (fish === undefined) {
          throw catalogErrors.fishNotFound();
        }

        if (!fish.isActive) {
          throw catalogErrors.fishInactive();
        }

        const record = await tx.fishingBaseFish.create({
          data: {
            fishingBaseId: baseId,
            fishId: dto.fishId,
          },
          select: ADMIN_FISHING_BASE_FISH_SELECT,
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'FISHING_BASE_FISH_ADDED',
          subjectType: 'FISHING_BASE_FISH',
          subjectKey: `${baseId}:${dto.fishId}`,
          payload: {
            membership: {
              fishingBase: { id: fishingBase.id, name: fishingBase.name },
              fish: { id: fish.id, name: fish.name },
              minWeightGrams: record.minWeightGrams,
              maxWeightGrams: record.maxWeightGrams,
            },
          },
        });

        return {
          fishingBaseFish: {
            fishingBaseId: record.fishingBaseId,
            fishId: record.fishId,
            createdAt: record.createdAt,
          },
        };
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishingBaseFishExists();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catalogErrors.fishingBaseFishRelationInvalid();
      }

      throw error;
    }
  }

  async removeFishFromFishingBase(
    actorUserId: string,
    baseId: string,
    fishId: string,
  ): Promise<void> {
    try {
      await this.runSerializableTransaction(async (tx) => {
        const before = await tx.fishingBaseFish.findUnique({
          where: { fishingBaseId_fishId: { fishingBaseId: baseId, fishId } },
          select: ACTIVITY_FISHING_BASE_FISH_SELECT,
        });
        if (before === null) throw catalogErrors.fishingBaseFishNotFound();

        await tx.fishingBaseFish.delete({
          where: { fishingBaseId_fishId: { fishingBaseId: baseId, fishId } },
        });
        await this.activityEvents.append(tx, actorUserId, {
          type: 'FISHING_BASE_FISH_REMOVED',
          subjectType: 'FISHING_BASE_FISH',
          subjectKey: `${baseId}:${fishId}`,
          payload: { membership: membershipActivitySnapshot(before) },
        });
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.fishingBaseFishNotFound();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catalogErrors.fishingBaseFishRelationInvalid();
      }

      throw error;
    }
  }

  async updateFishingBaseFish(
    actorUserId: string,
    baseId: string,
    fishId: string,
    dto: UpdateFishingBaseFishDto,
  ) {
    if (hasNoDefinedValues([dto.minWeightGrams, dto.maxWeightGrams])) {
      throw emptyUpdateException();
    }

    return this.runSerializableTransaction(async (tx) => {
      const [current] = await tx.$queryRaw<
        Array<{ minWeightGrams: number | null; maxWeightGrams: number | null }>
      >`
        SELECT "minWeightGrams", "maxWeightGrams"
        FROM "FishingBaseFish"
        WHERE "fishingBaseId" = ${baseId}::uuid
          AND "fishId" = ${fishId}::uuid
        FOR UPDATE
      `;

      if (current === undefined) {
        throw catalogErrors.fishingBaseFishNotFound();
      }

      const minWeightGrams =
        dto.minWeightGrams === undefined ? current.minWeightGrams : dto.minWeightGrams;
      const maxWeightGrams =
        dto.maxWeightGrams === undefined ? current.maxWeightGrams : dto.maxWeightGrams;

      if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
        throw invalidFishingBaseFishWeightBoundsException();
      }

      const record = await tx.fishingBaseFish.update({
        where: {
          fishingBaseId_fishId: { fishingBaseId: baseId, fishId },
        },
        data: {
          ...(dto.minWeightGrams !== undefined ? { minWeightGrams: dto.minWeightGrams } : {}),
          ...(dto.maxWeightGrams !== undefined ? { maxWeightGrams: dto.maxWeightGrams } : {}),
        },
        select: ACTIVITY_FISHING_BASE_FISH_SELECT,
      });

      const changes = activityChanges([
        ['minWeightGrams', current.minWeightGrams, record.minWeightGrams],
        ['maxWeightGrams', current.maxWeightGrams, record.maxWeightGrams],
      ]);
      if (changes.length > 0) {
        await this.activityEvents.append(tx, actorUserId, {
          type: 'FISHING_BASE_FISH_UPDATED',
          subjectType: 'FISHING_BASE_FISH',
          subjectKey: `${baseId}:${fishId}`,
          payload: { membership: membershipActivitySnapshot(record), changes },
        });
      }

      return {
        fishingBaseFish: {
          fishingBaseId: record.fishingBaseId,
          fishId: record.fishId,
          minWeightGrams: record.minWeightGrams,
          maxWeightGrams: record.maxWeightGrams,
          createdAt: record.createdAt,
        },
      };
    });
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
}
