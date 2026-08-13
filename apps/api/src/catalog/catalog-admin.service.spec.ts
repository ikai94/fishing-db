import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import type { UpdateLocationDto } from './dto/update-location.dto.js';

const NOW = new Date('2026-08-08T12:00:00.000Z');

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function hasCode(expectedCode: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof HttpException)) {
      return false;
    }

    const response = error.getResponse();
    return typeof response === 'object' && response !== null && 'code' in response
      ? response.code === expectedCode
      : false;
  };
}

function namedItem(id: string, name: string, isActive = true) {
  return { id, name, isActive, createdAt: NOW, updatedAt: NOW };
}

function knownPrismaError(code: string, meta?: unknown): Error & { code: string; meta?: unknown } {
  return Object.assign(new Error(`Prisma ${code}`), { code, meta });
}

function withCatalogLocks<T extends object>(database: T, lockStates: Array<boolean | null>): T {
  let lockIndex = 0;
  const transactionClient = Object.assign(database, {
    $queryRaw: () => {
      const state = lockStates[lockIndex];
      lockIndex += 1;
      return Promise.resolve(state === null || state === undefined ? [] : [{ isActive: state }]);
    },
  });

  return Object.assign(transactionClient, {
    $transaction: <Result>(callback: (tx: T) => Promise<Result>): Promise<Result> =>
      callback(transactionClient),
  });
}

void describe('CatalogAdminService', () => {
  void it('stores the display name and normalized key explicitly', async () => {
    let createQuery: unknown;
    const prisma = {
      fishingBase: {
        create: (input: unknown) => {
          createQuery = input;
          return Promise.resolve(namedItem('base-id', 'Озера\u00a0  Танзании'));
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await service.createFishingBase({ name: '  Озера\u00a0  Танзании  ' });

    assert.deepEqual(asObject(asObject(createQuery).data), {
      name: 'Озера\u00a0  Танзании',
      nameNormalized: 'озера танзании',
    });
  });

  void it('rejects Location creation under an inactive FishingBase', async () => {
    let createCalled = false;
    const prisma = {
      fishingBase: { findUnique: () => Promise.resolve({ isActive: false }) },
      location: {
        create: () => {
          createCalled = true;
          return Promise.resolve(undefined);
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await assert.rejects(
      () => service.createLocation('base-id', { number: 1, name: 'Протока' }),
      hasCode('FISHING_BASE_INACTIVE'),
    );
    assert.equal(createCalled, false);
  });

  void it('rejects Location activation while its FishingBase is inactive', async () => {
    let updateCalled = false;
    const prisma = {
      location: {
        findUnique: () => Promise.resolve({ fishingBase: { isActive: false } }),
        update: () => {
          updateCalled = true;
          return Promise.resolve(undefined);
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await assert.rejects(
      () => service.updateLocation('location-id', { isActive: true }),
      hasCode('FISHING_BASE_INACTIVE'),
    );
    assert.equal(updateCalled, false);
  });

  void it('never maps fishingBaseId from a Location update into Prisma data', async () => {
    let updateQuery: unknown;
    const prisma = {
      location: {
        findUnique: () => Promise.resolve({ fishingBase: { isActive: true } }),
        update: (input: unknown) => {
          updateQuery = input;
          return Promise.resolve({
            id: 'location-id',
            fishingBaseId: 'base-id',
            number: 2,
            name: 'Новая протока',
            isActive: true,
            createdAt: NOW,
            updatedAt: NOW,
          });
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);
    const maliciousDto = {
      number: 2,
      name: 'Новая протока',
      fishingBaseId: 'other-base-id',
    } as unknown as UpdateLocationDto;

    await service.updateLocation('location-id', maliciousDto);
    const data = asObject(asObject(updateQuery).data);

    assert.equal('fishingBaseId' in data, false);
    assert.equal(data.number, 2);
    assert.equal(data.nameNormalized, 'новая протока');
  });

  void it('maps compound Location uniqueness conflicts to stable errors', async () => {
    const errors = [
      {
        prismaError: knownPrismaError('P2002', {
          target: ['fishingBaseId', 'number'],
        }),
        expectedCode: 'LOCATION_NUMBER_ALREADY_EXISTS',
      },
      {
        prismaError: knownPrismaError('P2002', {
          target: ['fishingBaseId', 'nameNormalized'],
        }),
        expectedCode: 'LOCATION_NAME_ALREADY_EXISTS',
      },
    ];

    for (const { prismaError, expectedCode } of errors) {
      const prisma = {
        fishingBase: { findUnique: () => Promise.resolve({ isActive: true }) },
        location: { create: () => Promise.reject(prismaError) },
      } as unknown as PrismaService;
      const service = new CatalogAdminService(prisma);

      await assert.rejects(
        () => service.createLocation('base-id', { number: 1, name: 'Протока' }),
        hasCode(expectedCode),
      );
    }
  });

  void it('stores the explicitly selected Bait type and maps duplicate names', async () => {
    let createQuery: unknown;
    const successfulPrisma = {
      bait: {
        create: (input: unknown) => {
          createQuery = input;
          return Promise.resolve({ ...namedItem('bait-id', 'Блесна'), type: 'LURE' });
        },
      },
    } as unknown as PrismaService;
    const successfulService = new CatalogAdminService(successfulPrisma);

    const result = await successfulService.createBait({ name: 'Блесна', type: 'LURE' });

    assert.equal(asObject(asObject(createQuery).data).type, 'LURE');
    assert.equal(result.bait.type, 'LURE');

    const duplicatePrisma = {
      bait: { create: () => Promise.reject(knownPrismaError('P2002')) },
    } as unknown as PrismaService;
    const duplicateService = new CatalogAdminService(duplicatePrisma);

    await assert.rejects(
      () => duplicateService.createBait({ name: 'БЛЕСНА', type: 'BAIT' }),
      hasCode('BAIT_NAME_ALREADY_EXISTS'),
    );
  });

  void it('rejects the retired exact Fish spinning suffix on create and rename', async () => {
    let mutationCalled = false;
    const prisma = {
      fish: {
        create: () => {
          mutationCalled = true;
          return Promise.resolve(undefined);
        },
        update: () => {
          mutationCalled = true;
          return Promise.resolve(undefined);
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await assert.rejects(
      () => service.createFish({ name: 'Сайда (спиннинг)' }),
      hasCode('VALIDATION_ERROR'),
    );
    await assert.rejects(
      () => service.updateFish('fish-id', { name: 'Жерех-лысач (спиннинг)' }),
      hasCode('VALIDATION_ERROR'),
    );
    assert.equal(mutationCalled, false);
  });

  void it('adds and removes an active FishingBaseFish relation', async () => {
    const calls: string[] = [];
    let createQuery: unknown;
    let deleteQuery: unknown;
    const prisma = withCatalogLocks(
      {
        fishingBaseFish: {
          create: (input: unknown) => {
            calls.push('create');
            createQuery = input;
            return Promise.resolve({
              fishingBaseId: 'base-id',
              fishId: 'fish-id',
              createdAt: NOW,
            });
          },
          delete: (input: unknown) => {
            calls.push('delete');
            deleteQuery = input;
            return Promise.resolve({});
          },
        },
      },
      [true, true],
    ) as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    const result = await service.addFishToFishingBase('base-id', { fishId: 'fish-id' });
    await service.removeFishFromFishingBase('base-id', 'fish-id');

    assert.deepEqual(calls, ['create', 'delete']);
    assert.deepEqual(asObject(asObject(createQuery).data), {
      fishingBaseId: 'base-id',
      fishId: 'fish-id',
    });
    assert.deepEqual(asObject(asObject(deleteQuery).where).fishingBaseId_fishId, {
      fishingBaseId: 'base-id',
      fishId: 'fish-id',
    });
    assert.deepEqual(result.fishingBaseFish, {
      fishingBaseId: 'base-id',
      fishId: 'fish-id',
      createdAt: NOW,
    });
  });

  void it('rejects duplicate and inactive FishingBaseFish participants', async () => {
    const duplicatePrisma = withCatalogLocks(
      { fishingBaseFish: { create: () => Promise.reject(knownPrismaError('P2002')) } },
      [true, true],
    ) as unknown as PrismaService;
    const duplicateService = new CatalogAdminService(duplicatePrisma);

    await assert.rejects(
      () => duplicateService.addFishToFishingBase('base-id', { fishId: 'fish-id' }),
      hasCode('FISHING_BASE_FISH_ALREADY_EXISTS'),
    );

    const inactiveBasePrisma = withCatalogLocks({}, [false]) as unknown as PrismaService;
    const inactiveBaseService = new CatalogAdminService(inactiveBasePrisma);

    await assert.rejects(
      () => inactiveBaseService.addFishToFishingBase('base-id', { fishId: 'fish-id' }),
      hasCode('FISHING_BASE_INACTIVE'),
    );

    const inactiveFishPrisma = withCatalogLocks({}, [true, false]) as unknown as PrismaService;
    const inactiveFishService = new CatalogAdminService(inactiveFishPrisma);

    await assert.rejects(
      () => inactiveFishService.addFishToFishingBase('base-id', { fishId: 'fish-id' }),
      hasCode('FISH_INACTIVE'),
    );
  });

  void it('deactivates an entity without deleting its relations', async () => {
    let updateQuery: unknown;
    let relationDeleteCalled = false;
    const prisma = {
      fish: {
        update: (input: unknown) => {
          updateQuery = input;
          return Promise.resolve(namedItem('fish-id', 'Осётр', false));
        },
      },
      fishingBaseFish: {
        deleteMany: () => {
          relationDeleteCalled = true;
          return Promise.resolve({ count: 1 });
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    const result = await service.updateFish('fish-id', { isActive: false });

    assert.deepEqual(asObject(asObject(updateQuery).data), { isActive: false });
    assert.equal(result.fish.isActive, false);
    assert.equal(relationDeleteCalled, false);
  });

  void it('creates and updates ScreenAnchors with catalog normalization', async () => {
    const calls: unknown[] = [];
    const prisma = {
      screenAnchor: {
        create: (input: unknown) => {
          calls.push(input);
          return Promise.resolve(namedItem('anchor-id', 'Удочка'));
        },
        update: (input: unknown) => {
          calls.push(input);
          return Promise.resolve(namedItem('anchor-id', 'События', false));
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await service.createScreenAnchor({ name: '  Удочка  ' });
    await service.updateScreenAnchor('anchor-id', { name: 'События', isActive: false });

    assert.deepEqual(asObject(asObject(calls[0]).data), {
      name: 'Удочка',
      nameNormalized: 'удочка',
    });
    assert.deepEqual(asObject(asObject(calls[1]).data), {
      name: 'События',
      nameNormalized: 'события',
      isActive: false,
    });
  });

  void it('rejects empty PATCH bodies before calling Prisma', async () => {
    let updateCalled = false;
    const prisma = {
      fish: {
        update: () => {
          updateCalled = true;
          return Promise.resolve(undefined);
        },
      },
    } as unknown as PrismaService;
    const service = new CatalogAdminService(prisma);

    await assert.rejects(() => service.updateFish('fish-id', {}), hasCode('VALIDATION_ERROR'));
    assert.equal(updateCalled, false);
  });
});
