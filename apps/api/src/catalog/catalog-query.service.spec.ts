import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';
import type { FishImageDelivery } from './fish-image-delivery.js';

function catalogQueryService(
  prisma: PrismaService,
  fishImageDelivery: FishImageDelivery = new DisabledFishImageDelivery(),
): CatalogQueryService {
  return new CatalogQueryService(prisma, fishImageDelivery);
}

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function hasCode(expectedCode: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof NotFoundException)) {
      return false;
    }

    const response = error.getResponse();
    return typeof response === 'object' && response !== null && 'code' in response
      ? response.code === expectedCode
      : false;
  };
}

void describe('CatalogQueryService', () => {
  void it('counts active Locations and active Fish in one public Base-list query', async () => {
    let query: unknown;
    let queriesCount = 0;
    const prisma = {
      fishingBase: {
        findMany: (input: unknown) => {
          query = input;
          queriesCount += 1;
          return Promise.resolve([
            {
              id: 'base-id',
              name: 'Амур',
              _count: { locations: 2, fishLinks: 3 },
            },
          ]);
        },
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    const result = await service.listPublicFishingBases();
    const queryObject = asObject(query);

    assert.deepEqual(queryObject.where, { isActive: true });
    const select = asObject(queryObject.select);
    const countSelect = asObject(asObject(select._count).select);
    assert.equal(queriesCount, 1);
    assert.deepEqual(Object.keys(select).sort(), ['_count', 'id', 'name']);
    assert.deepEqual(asObject(countSelect.locations).where, { isActive: true });
    assert.deepEqual(asObject(countSelect.fishLinks).where, { fish: { isActive: true } });
    assert.deepEqual(result, {
      items: [
        {
          id: 'base-id',
          name: 'Амур',
          locationsCount: 2,
          fishCount: 3,
        },
      ],
    });
    assert.equal('_count' in result.items[0], false);
  });

  void it('returns only active locations and active Base fish in public base detail', async () => {
    let query: unknown;
    const prisma = {
      fishingBase: {
        findFirst: (input: unknown) => {
          query = input;
          return Promise.resolve({
            id: 'base-id',
            name: 'Амур',
            locations: [{ id: 'location-id', number: 1, name: 'Протока' }],
            fishLinks: [
              { fish: { id: 'fish-1', name: 'Осётр' } },
              { fish: { id: 'fish-2', name: 'Щука' } },
            ],
          });
        },
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    await service.getPublicFishingBase('base-id');
    const queryObject = asObject(query);
    const select = asObject(queryObject.select);
    const locations = asObject(select.locations);
    const fishLinks = asObject(select.fishLinks);

    assert.deepEqual(queryObject.where, { id: 'base-id', isActive: true });
    assert.deepEqual(locations.where, { isActive: true });
    assert.deepEqual(Object.keys(asObject(locations.select)).sort(), ['id', 'name', 'number']);
    assert.deepEqual(fishLinks.where, { fish: { isActive: true } });
    assert.deepEqual((await service.getPublicFishingBase('base-id')).base.fish, [
      { id: 'fish-1', name: 'Осётр' },
      { id: 'fish-2', name: 'Щука' },
    ]);
  });

  void it('treats an inactive or missing public base as not found', async () => {
    const prisma = {
      fishingBase: { findFirst: () => Promise.resolve(null) },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    await assert.rejects(
      () => service.getPublicFishingBase('base-id'),
      hasCode('FISHING_BASE_NOT_FOUND'),
    );
  });

  void it('projects public Fish images without serializing persisted delivery metadata', async () => {
    let query: unknown;
    const deliverySources: unknown[] = [];
    const prisma = {
      fish: {
        findMany: (input: unknown) => {
          query = input;
          return Promise.resolve([
            {
              id: 'fish-id',
              name: 'Сом',
              officialFishImageKey: 1463,
            },
          ]);
        },
      },
    } as unknown as PrismaService;
    const delivery = {
      resolvePublicImage: (source: unknown) => {
        deliverySources.push(source);
        return { url: '/fish-images/fish-id.webp' };
      },
    } as FishImageDelivery;
    const service = catalogQueryService(prisma, delivery);

    const result = await service.listPublicFish();
    const select = asObject(asObject(query).select);

    assert.deepEqual(Object.keys(select).sort(), ['id', 'name', 'officialFishImageKey']);
    assert.equal('forumTopicId' in select, false);
    assert.deepEqual(deliverySources, [{ fishId: 'fish-id', officialFishImageKey: 1463 }]);
    assert.deepEqual(result, {
      items: [
        {
          id: 'fish-id',
          name: 'Сом',
          image: { url: '/fish-images/fish-id.webp' },
        },
      ],
    });
    assert.equal('officialFishImageKey' in result.items[0], false);
  });

  void it('returns an active Fish with only its active related Bases in stable order', async () => {
    let query: unknown;
    const prisma = {
      fish: {
        findFirst: (input: unknown) => {
          query = input;
          return Promise.resolve({
            id: 'fish-id',
            name: 'Сом',
            officialFishImageKey: 1463,
            fishingBaseLinks: [
              {
                minWeightGrams: 100,
                maxWeightGrams: 20_000,
                fishingBase: { id: 'base-1', name: 'Ахтуба' },
              },
              {
                minWeightGrams: null,
                maxWeightGrams: 25_000,
                fishingBase: { id: 'base-2', name: 'Волга' },
              },
            ],
          });
        },
      },
    } as unknown as PrismaService;
    const deliverySources: unknown[] = [];
    const delivery = {
      resolvePublicImage: (source: unknown) => {
        deliverySources.push(source);
        return null;
      },
    } as FishImageDelivery;
    const service = catalogQueryService(prisma, delivery);

    const result = await service.getPublicFish('fish-id');
    const queryObject = asObject(query);
    const select = asObject(queryObject.select);
    const fishingBaseLinks = asObject(select.fishingBaseLinks);

    assert.deepEqual(queryObject.where, { id: 'fish-id', isActive: true });
    assert.equal(select.officialFishImageKey, true);
    assert.equal('forumTopicId' in select, false);
    assert.deepEqual(fishingBaseLinks.where, { fishingBase: { isActive: true } });
    assert.deepEqual(fishingBaseLinks.orderBy, [
      { fishingBase: { nameNormalized: 'asc' } },
      { fishingBaseId: 'asc' },
    ]);
    assert.deepEqual(result, {
      fish: {
        id: 'fish-id',
        name: 'Сом',
        image: null,
        bases: [
          { id: 'base-1', name: 'Ахтуба', minWeightGrams: 100, maxWeightGrams: 20_000 },
          { id: 'base-2', name: 'Волга', minWeightGrams: null, maxWeightGrams: 25_000 },
        ],
      },
    });
    assert.deepEqual(deliverySources, [{ fishId: 'fish-id', officialFishImageKey: 1463 }]);
    assert.equal('officialFishImageKey' in result.fish, false);
    assert.equal('fishingBaseLinks' in result.fish, false);
  });

  void it('supports an active Fish without Base memberships and hides missing or inactive Fish', async () => {
    const rows: unknown[] = [
      { id: 'fish-id', name: 'Сом', officialFishImageKey: null, fishingBaseLinks: [] },
      null,
    ];
    const prisma = {
      fish: { findFirst: () => Promise.resolve(rows.shift()) },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    assert.deepEqual(await service.getPublicFish('fish-id'), {
      fish: { id: 'fish-id', name: 'Сом', image: null, bases: [] },
    });
    await assert.rejects(() => service.getPublicFish('hidden-fish-id'), hasCode('FISH_NOT_FOUND'));
  });

  void it('requires an active parent and does not project fish from a public location', async () => {
    let query: unknown;
    const prisma = {
      location: {
        findFirst: (input: unknown) => {
          query = input;
          return Promise.resolve({
            id: 'location-id',
            number: 1,
            name: 'Протока',
            fishingBase: { id: 'base-id', name: 'Амур' },
          });
        },
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    const result = await service.getPublicLocation('location-id');
    const queryObject = asObject(query);
    const where = asObject(queryObject.where);
    const select = asObject(queryObject.select);

    assert.deepEqual(where, {
      id: 'location-id',
      isActive: true,
      fishingBase: { isActive: true },
    });
    assert.equal('fishLinks' in select, false);
    assert.equal('fish' in result.location, false);
  });

  void it('treats an inactive location or a location under an inactive base as not found', async () => {
    const prisma = {
      location: { findFirst: () => Promise.resolve(null) },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    await assert.rejects(
      () => service.getPublicLocation('location-id'),
      hasCode('LOCATION_NOT_FOUND'),
    );
  });

  void it('allows admin lists to include or filter inactive entities', async () => {
    const queries: unknown[] = [];
    const prisma = {
      fish: {
        findMany: (input: unknown) => {
          queries.push(input);
          return Promise.resolve([
            {
              id: 'fish-id',
              name: 'Осётр',
              isActive: false,
              createdAt: new Date('2026-08-08T12:00:00.000Z'),
              updatedAt: new Date('2026-08-08T12:00:00.000Z'),
            },
          ]);
        },
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    const all = await service.listAdminFish();
    await service.listAdminFish('inactive');

    assert.deepEqual(asObject(queries[0]).where, {});
    assert.deepEqual(asObject(queries[1]).where, { isActive: false });
    assert.equal(all.items[0]?.isActive, false);
    assert.equal('nameNormalized' in (all.items[0] ?? {}), false);
  });

  void it('maps admin FishingBaseFish rows to an explicit safe Base response', async () => {
    const createdAt = new Date('2026-08-08T12:00:00.000Z');
    const prisma = {
      fishingBase: {
        findUnique: () =>
          Promise.resolve({
            id: 'base-id',
            name: 'Амур',
            isActive: true,
            createdAt,
            updatedAt: createdAt,
            locations: [{ id: 'location-id', number: 1, name: 'Протока' }],
            fishLinks: [
              {
                createdAt,
                minWeightGrams: 100,
                maxWeightGrams: 20_000,
                fish: { id: 'fish-id', name: 'Осётр', isActive: false },
              },
            ],
          }),
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    const result = await service.getAdminFishingBase('base-id');

    assert.deepEqual(result.base.fish, [
      {
        id: 'fish-id',
        name: 'Осётр',
        isActive: false,
        relationCreatedAt: createdAt,
        minWeightGrams: 100,
        maxWeightGrams: 20_000,
      },
    ]);
    assert.equal('fishLinks' in result.base, false);
  });

  void it('lists only active public ScreenAnchors and supports admin status filters', async () => {
    const queries: unknown[] = [];
    const prisma = {
      screenAnchor: {
        findMany: (input: unknown) => {
          queries.push(input);
          return Promise.resolve([{ id: 'anchor-id', name: 'Удочка' }]);
        },
      },
    } as unknown as PrismaService;
    const service = catalogQueryService(prisma);

    assert.deepEqual(await service.listPublicScreenAnchors(), {
      items: [{ id: 'anchor-id', name: 'Удочка' }],
    });
    await service.listAdminScreenAnchors('inactive');

    assert.deepEqual(asObject(queries[0]).where, { isActive: true });
    assert.deepEqual(asObject(queries[1]).where, { isActive: false });
  });
});
