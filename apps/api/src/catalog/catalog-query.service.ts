import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogStatus } from './catalog.constants.js';
import { catalogErrors } from './catalog-errors.js';
import { FishImageDelivery } from './fish-image-delivery.js';

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
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FishImageDelivery) private readonly fishImageDelivery: FishImageDelivery,
  ) {}

  async listPublicFishingBases() {
    const fishingBases = await this.prisma.fishingBase.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: {
        ...PUBLIC_NAMED_ITEM_SELECT,
        _count: {
          select: {
            locations: { where: { isActive: true } },
            fishLinks: { where: { fish: { isActive: true } } },
          },
        },
      },
    });

    return {
      items: fishingBases.map((fishingBase) => ({
        id: fishingBase.id,
        name: fishingBase.name,
        locationsCount: fishingBase._count.locations,
        fishCount: fishingBase._count.fishLinks,
      })),
    };
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
        fishLinks: {
          where: { fish: { isActive: true } },
          orderBy: [{ fish: { nameNormalized: 'asc' } }, { fishId: 'asc' }],
          select: { fish: { select: PUBLIC_NAMED_ITEM_SELECT } },
        },
      },
    });

    if (fishingBase === null) {
      throw catalogErrors.fishingBaseNotFound();
    }

    return {
      base: {
        id: fishingBase.id,
        name: fishingBase.name,
        locations: fishingBase.locations,
        fish: fishingBase.fishLinks.map((link) => link.fish),
      },
    };
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
      },
    });

    if (location === null) {
      throw catalogErrors.locationNotFound();
    }

    return { location };
  }

  async listPublicFish() {
    const fish = await this.prisma.fish.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: {
        ...PUBLIC_NAMED_ITEM_SELECT,
        officialFishImageKey: true,
      },
    });

    return {
      items: fish.map((item) => ({
        id: item.id,
        name: item.name,
        image: this.fishImageDelivery.resolvePublicImage({
          fishId: item.id,
          officialFishImageKey: item.officialFishImageKey,
        }),
      })),
    };
  }

  async getPublicFish(fishId: string) {
    const fish = await this.prisma.fish.findFirst({
      where: { id: fishId, isActive: true },
      select: {
        ...PUBLIC_NAMED_ITEM_SELECT,
        officialFishImageKey: true,
        fishingBaseLinks: {
          where: { fishingBase: { isActive: true } },
          orderBy: [{ fishingBase: { nameNormalized: 'asc' } }, { fishingBaseId: 'asc' }],
          select: { fishingBase: { select: PUBLIC_NAMED_ITEM_SELECT } },
        },
      },
    });

    if (fish === null) {
      throw catalogErrors.fishNotFound();
    }

    return {
      fish: {
        id: fish.id,
        name: fish.name,
        image: this.fishImageDelivery.resolvePublicImage({
          fishId: fish.id,
          officialFishImageKey: fish.officialFishImageKey,
        }),
        bases: fish.fishingBaseLinks.map((link) => link.fishingBase),
      },
    };
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

  async listPublicScreenAnchors() {
    const items = await this.prisma.screenAnchor.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: PUBLIC_NAMED_ITEM_SELECT,
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

    if (fishingBase === null) {
      throw catalogErrors.fishingBaseNotFound();
    }

    return {
      base: {
        id: fishingBase.id,
        name: fishingBase.name,
        isActive: fishingBase.isActive,
        createdAt: fishingBase.createdAt,
        updatedAt: fishingBase.updatedAt,
        locations: fishingBase.locations,
        fish: fishingBase.fishLinks.map((link) => ({
          id: link.fish.id,
          name: link.fish.name,
          isActive: link.fish.isActive,
          relationCreatedAt: link.createdAt,
        })),
      },
    };
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
      },
    });

    if (location === null) {
      throw catalogErrors.locationNotFound();
    }

    return { location };
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

  async listAdminScreenAnchors(status?: CatalogStatus) {
    const items = await this.prisma.screenAnchor.findMany({
      where: statusWhere(status),
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: ADMIN_NAMED_ITEM_SELECT,
    });

    return { items };
  }
}
