import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogStatus } from './catalog.constants.js';
import { catalogErrors } from './catalog-errors.js';

const PUBLIC_NAMED_ITEM_SELECT = {
  id: true,
  name: true,
} as const;

const ADMIN_NAMED_ITEM_SELECT = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function statusWhere(status: CatalogStatus | undefined): { isActive?: boolean } {
  if (status === 'active') {
    return { isActive: true };
  }

  if (status === 'inactive') {
    return { isActive: false };
  }

  return {};
}

@Injectable()
export class CatalogQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listPublicFishingBases() {
    const items = await this.prisma.fishingBase.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: PUBLIC_NAMED_ITEM_SELECT,
    });

    return { items };
  }

  async getPublicFishingBase(baseId: string) {
    const fishingBase = await this.prisma.fishingBase.findFirst({
      where: { id: baseId, isActive: true },
      select: {
        ...PUBLIC_NAMED_ITEM_SELECT,
        locations: {
          where: { isActive: true },
          orderBy: [{ number: 'asc' }, { nameNormalized: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            number: true,
            name: true,
          },
        },
      },
    });

    if (fishingBase === null) {
      throw catalogErrors.fishingBaseNotFound();
    }

    return { base: fishingBase };
  }

  async getPublicLocation(locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: {
        id: locationId,
        isActive: true,
        fishingBase: { isActive: true },
      },
      select: {
        id: true,
        number: true,
        name: true,
        fishingBase: { select: PUBLIC_NAMED_ITEM_SELECT },
        fishLinks: {
          where: { fish: { isActive: true } },
          orderBy: [{ fish: { nameNormalized: 'asc' } }, { fishId: 'asc' }],
          select: { fish: { select: PUBLIC_NAMED_ITEM_SELECT } },
        },
      },
    });

    if (location === null) {
      throw catalogErrors.locationNotFound();
    }

    return {
      location: {
        id: location.id,
        number: location.number,
        name: location.name,
        fishingBase: location.fishingBase,
        fish: location.fishLinks.map((link) => link.fish),
      },
    };
  }

  async listPublicFish() {
    const items = await this.prisma.fish.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: PUBLIC_NAMED_ITEM_SELECT,
    });

    return { items };
  }

  async listPublicBaits() {
    const items = await this.prisma.bait.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: {
        ...PUBLIC_NAMED_ITEM_SELECT,
        type: true,
      },
    });

    return { items };
  }

  async listAdminFishingBases(status?: CatalogStatus) {
    const items = await this.prisma.fishingBase.findMany({
      where: statusWhere(status),
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: ADMIN_NAMED_ITEM_SELECT,
    });

    return { items };
  }

  async getAdminFishingBase(baseId: string) {
    const fishingBase = await this.prisma.fishingBase.findUnique({
      where: { id: baseId },
      select: {
        ...ADMIN_NAMED_ITEM_SELECT,
        locations: {
          orderBy: [{ number: 'asc' }, { nameNormalized: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            number: true,
            name: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (fishingBase === null) {
      throw catalogErrors.fishingBaseNotFound();
    }

    return { base: fishingBase };
  }

  async getAdminLocation(locationId: string) {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: {
        id: true,
        fishingBaseId: true,
        number: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        fishingBase: {
          select: {
            id: true,
            name: true,
            isActive: true,
          },
        },
        fishLinks: {
          orderBy: [{ fish: { nameNormalized: 'asc' } }, { fishId: 'asc' }],
          select: {
            createdAt: true,
            fish: {
              select: {
                id: true,
                name: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (location === null) {
      throw catalogErrors.locationNotFound();
    }

    return {
      location: {
        id: location.id,
        fishingBaseId: location.fishingBaseId,
        number: location.number,
        name: location.name,
        isActive: location.isActive,
        createdAt: location.createdAt,
        updatedAt: location.updatedAt,
        fishingBase: location.fishingBase,
        fish: location.fishLinks.map((link) => ({
          id: link.fish.id,
          name: link.fish.name,
          isActive: link.fish.isActive,
          relationCreatedAt: link.createdAt,
        })),
      },
    };
  }

  async listAdminFish(status?: CatalogStatus) {
    const items = await this.prisma.fish.findMany({
      where: statusWhere(status),
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: ADMIN_NAMED_ITEM_SELECT,
    });

    return { items };
  }

  async listAdminBaits(status?: CatalogStatus) {
    const items = await this.prisma.bait.findMany({
      where: statusWhere(status),
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: {
        ...ADMIN_NAMED_ITEM_SELECT,
        type: true,
      },
    });

    return { items };
  }
}
