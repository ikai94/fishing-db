import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CatalogQueryService } from './catalog-query.service.js';

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
  void it('uses an active-only safe projection for the public base list', async () => {
    let query: unknown;
    const prisma = {
      fishingBase: {
        findMany: (input: unknown) => {
          query = input;
          return Promise.resolve([{ id: 'base-id', name: 'Амур' }]);
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

    const result = await service.listPublicFishingBases();
    const queryObject = asObject(query);

    assert.deepEqual(queryObject.where, { isActive: true });
    assert.deepEqual(Object.keys(asObject(queryObject.select)).sort(), ['id', 'name']);
    assert.deepEqual(result, { items: [{ id: 'base-id', name: 'Амур' }] });
  });

  void it('returns only active locations in public base detail', async () => {
    let query: unknown;
    const prisma = {
      fishingBase: {
        findFirst: (input: unknown) => {
          query = input;
          return Promise.resolve({
            id: 'base-id',
            name: 'Амур',
            locations: [{ id: 'location-id', number: 1, name: 'Протока' }],
          });
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

    await service.getPublicFishingBase('base-id');
    const queryObject = asObject(query);
    const select = asObject(queryObject.select);
    const locations = asObject(select.locations);

    assert.deepEqual(queryObject.where, { id: 'base-id', isActive: true });
    assert.deepEqual(locations.where, { isActive: true });
    assert.deepEqual(Object.keys(asObject(locations.select)).sort(), ['id', 'name', 'number']);
  });

  void it('treats an inactive or missing public base as not found', async () => {
    const prisma = {
      fishingBase: { findFirst: () => Promise.resolve(null) },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

    await assert.rejects(
      () => service.getPublicFishingBase('base-id'),
      hasCode('FISHING_BASE_NOT_FOUND'),
    );
  });

  void it('requires an active parent and projects only active fish for a public location', async () => {
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
            fishLinks: [
              { fish: { id: 'fish-1', name: 'Осётр' } },
              { fish: { id: 'fish-2', name: 'Щука' } },
            ],
          });
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

    const result = await service.getPublicLocation('location-id');
    const queryObject = asObject(query);
    const where = asObject(queryObject.where);
    const select = asObject(queryObject.select);
    const fishLinks = asObject(select.fishLinks);

    assert.deepEqual(where, {
      id: 'location-id',
      isActive: true,
      fishingBase: { isActive: true },
    });
    assert.deepEqual(fishLinks.where, { fish: { isActive: true } });
    assert.deepEqual(result.location.fish, [
      { id: 'fish-1', name: 'Осётр' },
      { id: 'fish-2', name: 'Щука' },
    ]);
    assert.equal('fishLinks' in result.location, false);
  });

  void it('treats an inactive location or a location under an inactive base as not found', async () => {
    const prisma = {
      location: { findFirst: () => Promise.resolve(null) },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

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
    const service = new CatalogQueryService(prisma);

    const all = await service.listAdminFish();
    await service.listAdminFish('inactive');

    assert.deepEqual(asObject(queries[0]).where, {});
    assert.deepEqual(asObject(queries[1]).where, { isActive: false });
    assert.equal(all.items[0]?.isActive, false);
    assert.equal('nameNormalized' in (all.items[0] ?? {}), false);
  });

  void it('maps admin LocationFish rows to an explicit safe response', async () => {
    const createdAt = new Date('2026-08-08T12:00:00.000Z');
    const prisma = {
      location: {
        findUnique: () =>
          Promise.resolve({
            id: 'location-id',
            fishingBaseId: 'base-id',
            number: 1,
            name: 'Протока',
            isActive: true,
            createdAt,
            updatedAt: createdAt,
            fishingBase: { id: 'base-id', name: 'Амур', isActive: true },
            fishLinks: [
              {
                createdAt,
                fish: { id: 'fish-id', name: 'Осётр', isActive: false },
              },
            ],
          }),
      },
    } as unknown as PrismaService;
    const service = new CatalogQueryService(prisma);

    const result = await service.getAdminLocation('location-id');

    assert.deepEqual(result.location.fish, [
      {
        id: 'fish-id',
        name: 'Осётр',
        isActive: false,
        relationCreatedAt: createdAt,
      },
    ]);
    assert.equal('fishLinks' in result.location, false);
  });
});
