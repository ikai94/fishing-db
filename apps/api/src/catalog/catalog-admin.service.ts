import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogBaitType } from './catalog.constants.js';
import {
  catalogErrors,
  catalogNameValidationException,
  emptyUpdateException,
  isPrismaError,
  isPrismaUniqueConstraintErrorFor,
} from './catalog-errors.js';
import {
  CatalogNameValidationError,
  normalizeCatalogName,
  type NormalizedCatalogName,
} from './catalog-normalization.js';
import type { AddLocationFishDto } from './dto/add-location-fish.dto.js';
import type { CreateBaitDto } from './dto/create-bait.dto.js';
import type { CreateFishDto } from './dto/create-fish.dto.js';
import type { CreateFishingBaseDto } from './dto/create-fishing-base.dto.js';
import type { CreateLocationDto } from './dto/create-location.dto.js';
import type { UpdateBaitDto } from './dto/update-bait.dto.js';
import type { UpdateFishDto } from './dto/update-fish.dto.js';
import type { UpdateFishingBaseDto } from './dto/update-fishing-base.dto.js';
import type { UpdateLocationDto } from './dto/update-location.dto.js';

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

function hasNoDefinedValues(values: unknown[]): boolean {
  return values.every((item) => item === undefined);
}

@Injectable()
export class CatalogAdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createFishingBase(dto: CreateFishingBaseDto) {
    const name = validatedCatalogName(dto.name);

    try {
      const fishingBase = await this.prisma.fishingBase.create({
        data: name,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { base: fishingBase };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishingBaseNameExists();
      }

      throw error;
    }
  }

  async updateFishingBase(baseId: string, dto: UpdateFishingBaseDto) {
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
      const fishingBase = await this.prisma.fishingBase.update({
        where: { id: baseId },
        data,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { base: fishingBase };
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

  async createLocation(baseId: string, dto: CreateLocationDto) {
    const fishingBase = await this.prisma.fishingBase.findUnique({
      where: { id: baseId },
      select: { isActive: true },
    });

    if (fishingBase === null) {
      throw catalogErrors.fishingBaseNotFound();
    }

    if (!fishingBase.isActive) {
      throw catalogErrors.fishingBaseInactive();
    }

    const name = validatedCatalogName(dto.name);

    try {
      const location = await this.prisma.location.create({
        data: {
          fishingBaseId: baseId,
          number: dto.number,
          ...name,
        },
        select: ADMIN_LOCATION_SELECT,
      });

      return { location };
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

  async updateLocation(locationId: string, dto: UpdateLocationDto) {
    if (hasNoDefinedValues([dto.number, dto.name, dto.isActive])) {
      throw emptyUpdateException();
    }

    const currentLocation = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        fishingBase: { select: { isActive: true } },
      },
    });

    if (currentLocation === null) {
      throw catalogErrors.locationNotFound();
    }

    if (dto.isActive === true && !currentLocation.fishingBase.isActive) {
      throw catalogErrors.fishingBaseInactive();
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
      const location = await this.prisma.location.update({
        where: { id: locationId },
        data,
        select: ADMIN_LOCATION_SELECT,
      });

      return { location };
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

  async createFish(dto: CreateFishDto) {
    const name = validatedCatalogName(dto.name);

    try {
      const fish = await this.prisma.fish.create({
        data: name,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { fish };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.fishNameExists();
      }

      throw error;
    }
  }

  async updateFish(fishId: string, dto: UpdateFishDto) {
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
      const fish = await this.prisma.fish.update({
        where: { id: fishId },
        data,
        select: ADMIN_NAMED_ITEM_SELECT,
      });

      return { fish };
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

  async createBait(dto: CreateBaitDto) {
    const name = validatedCatalogName(dto.name);

    try {
      const bait = await this.prisma.bait.create({
        data: {
          ...name,
          type: dto.type,
        },
        select: {
          ...ADMIN_NAMED_ITEM_SELECT,
          type: true,
        },
      });

      return { bait };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.baitNameExists();
      }

      throw error;
    }
  }

  async updateBait(baitId: string, dto: UpdateBaitDto) {
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
      const bait = await this.prisma.bait.update({
        where: { id: baitId },
        data,
        select: {
          ...ADMIN_NAMED_ITEM_SELECT,
          type: true,
        },
      });

      return { bait };
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

  async addFishToLocation(locationId: string, dto: AddLocationFishDto) {
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

    const fish = await this.prisma.fish.findUnique({
      where: { id: dto.fishId },
      select: { isActive: true },
    });

    if (fish === null) {
      throw catalogErrors.fishNotFound();
    }

    if (!fish.isActive) {
      throw catalogErrors.fishInactive();
    }

    try {
      const locationFish = await this.prisma.locationFish.create({
        data: {
          locationId,
          fishId: dto.fishId,
        },
        select: {
          locationId: true,
          fishId: true,
          createdAt: true,
        },
      });

      return { locationFish };
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw catalogErrors.locationFishExists();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catalogErrors.locationFishRelationInvalid();
      }

      throw error;
    }
  }

  async removeFishFromLocation(locationId: string, fishId: string): Promise<void> {
    try {
      await this.prisma.locationFish.delete({
        where: {
          locationId_fishId: { locationId, fishId },
        },
      });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw catalogErrors.locationFishNotFound();
      }

      if (isPrismaError(error, 'P2003')) {
        throw catalogErrors.locationFishRelationInvalid();
      }

      throw error;
    }
  }
}
