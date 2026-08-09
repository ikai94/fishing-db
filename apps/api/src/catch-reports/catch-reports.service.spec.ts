import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CatchReportsService } from './catch-reports.service.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import type { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002';
const REPORT_ID = '20000000-0000-4000-8000-000000000001';
const LOCATION_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_LOCATION_ID = '30000000-0000-4000-8000-000000000002';
const FISH_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_FISH_ID = '40000000-0000-4000-8000-000000000002';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_BAIT_ID = '50000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-08-09T10:00:00.000Z');
const UPDATED_AT = new Date('2026-08-09T10:05:00.000Z');

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

function knownPrismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma ${code}`), { code });
}

function publicRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    weightGrams: 40,
    holeDepthCm: 600,
    spotLandmark: 'ROD',
    fishingNote: null,
    userNoteRaw: 'ямка 6,00 удочка',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    user: {
      id: USER_ID,
      nickname: 'Рыболов',
      email: 'secret@example.ru',
      role: 'USER',
      isBanned: false,
    },
    location: {
      id: LOCATION_ID,
      number: 1,
      name: 'Берег слоновьего бивня',
      fishingBase: {
        id: '60000000-0000-4000-8000-000000000001',
        name: 'Озера Танзании',
        isActive: false,
      },
      isActive: false,
    },
    fish: {
      id: FISH_ID,
      name: 'Шамбардия Валберга',
      isActive: false,
    },
    bait: {
      id: BAIT_ID,
      name: 'Мотыль',
      type: 'BAIT',
      isActive: false,
    },
    ...overrides,
  };
}

function createDto(): CreateCatchReportDto {
  return {
    locationId: LOCATION_ID,
    fishId: FISH_ID,
    baitId: BAIT_ID,
    weightGrams: 40,
    holeDepthCm: 600,
    spotLandmark: 'ROD',
    fishingNote: null,
    userNoteRaw: '  ямка 6,00 удочка  ',
  };
}

interface ValidationState {
  location?: unknown;
  fish?: unknown;
  bait?: unknown;
  locationFish?: unknown;
}

function validationPrisma(
  state: ValidationState = {},
  onCreate: (input: unknown) => Promise<unknown> = () => Promise.resolve(publicRecord()),
) {
  const calls: string[] = [];
  const value = (key: keyof ValidationState, fallback: unknown): unknown =>
    Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback;

  const prisma = {
    location: {
      findUnique: () => {
        calls.push('location');
        return Promise.resolve(
          value('location', { isActive: true, fishingBase: { isActive: true } }),
        );
      },
    },
    fish: {
      findUnique: () => {
        calls.push('fish');
        return Promise.resolve(value('fish', { isActive: true }));
      },
    },
    bait: {
      findUnique: () => {
        calls.push('bait');
        return Promise.resolve(value('bait', { isActive: true }));
      },
    },
    locationFish: {
      findUnique: () => {
        calls.push('locationFish');
        return Promise.resolve(value('locationFish', { locationId: LOCATION_ID }));
      },
    },
    catchReport: {
      create: (input: unknown) => {
        calls.push('create');
        return onCreate(input);
      },
    },
  } as unknown as PrismaService;

  return { prisma, calls };
}

void describe('CatchReportsService', () => {
  void it('uses the actor as owner, validates the catalog in order, and maps data explicitly', async () => {
    let createQuery: unknown;
    const { prisma, calls } = validationPrisma({}, (input) => {
      createQuery = input;
      return Promise.resolve(publicRecord());
    });
    const service = new CatchReportsService(prisma);
    const maliciousDto = {
      ...createDto(),
      userId: OTHER_USER_ID,
      fishingBaseId: '60000000-0000-4000-8000-000000000002',
      createdAt: new Date(0),
      relation: { connect: { id: OTHER_USER_ID } },
    } as unknown as CreateCatchReportDto;

    const result = await service.create(USER_ID, maliciousDto);
    const query = asObject(createQuery);

    assert.deepEqual(calls, ['location', 'fish', 'bait', 'locationFish', 'create']);
    assert.deepEqual(asObject(query.data), {
      userId: USER_ID,
      locationId: LOCATION_ID,
      fishId: FISH_ID,
      baitId: BAIT_ID,
      weightGrams: 40,
      holeDepthCm: 600,
      spotLandmark: 'ROD',
      fishingNote: null,
      userNoteRaw: '  ямка 6,00 удочка  ',
    });
    assert.deepEqual(result.report.author, { id: USER_ID, nickname: 'Рыболов' });
    assert.equal('email' in result.report.author, false);
    assert.equal('user' in result.report, false);
    assert.equal('isActive' in result.report.location, false);
    assert.equal('fishingBase' in result.report.location, false);
  });

  void it('returns stable errors for every invalid create catalog state', async () => {
    const scenarios: { state: ValidationState; code: string; calls: string[] }[] = [
      { state: { location: null }, code: 'LOCATION_NOT_FOUND', calls: ['location'] },
      {
        state: { location: { isActive: true, fishingBase: { isActive: false } } },
        code: 'FISHING_BASE_INACTIVE',
        calls: ['location'],
      },
      {
        state: { location: { isActive: false, fishingBase: { isActive: true } } },
        code: 'LOCATION_INACTIVE',
        calls: ['location'],
      },
      { state: { fish: null }, code: 'FISH_NOT_FOUND', calls: ['location', 'fish'] },
      {
        state: { fish: { isActive: false } },
        code: 'FISH_INACTIVE',
        calls: ['location', 'fish'],
      },
      {
        state: { bait: null },
        code: 'BAIT_NOT_FOUND',
        calls: ['location', 'fish', 'bait'],
      },
      {
        state: { bait: { isActive: false } },
        code: 'BAIT_INACTIVE',
        calls: ['location', 'fish', 'bait'],
      },
      {
        state: { locationFish: null },
        code: 'FISH_NOT_AVAILABLE_AT_LOCATION',
        calls: ['location', 'fish', 'bait', 'locationFish'],
      },
    ];

    for (const scenario of scenarios) {
      const { prisma, calls } = validationPrisma(scenario.state);
      const service = new CatchReportsService(prisma);

      await assert.rejects(() => service.create(USER_ID, createDto()), hasCode(scenario.code));
      assert.deepEqual(calls, scenario.calls);
    }
  });

  void it('updates observations without revalidating historical or same-id catalog references', async () => {
    let updateQuery: unknown;
    let findCalls = 0;
    const prisma = {
      catchReport: {
        findUnique: () => {
          findCalls += 1;
          return Promise.resolve({
            userId: USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          });
        },
        update: (input: unknown) => {
          updateQuery = input;
          return Promise.resolve(
            publicRecord({ weightGrams: 50, holeDepthCm: null, userNoteRaw: null }),
          );
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);
    const dto = {
      locationId: LOCATION_ID,
      fishId: FISH_ID,
      baitId: BAIT_ID,
      weightGrams: 50,
      holeDepthCm: null,
      userNoteRaw: '',
      userId: OTHER_USER_ID,
    } as unknown as UpdateCatchReportDto;

    await service.update(USER_ID, REPORT_ID, dto);
    const query = asObject(updateQuery);

    assert.equal(findCalls, 1);
    assert.deepEqual(query.where, { id: REPORT_ID, userId: USER_ID });
    assert.deepEqual(asObject(query.data), {
      locationId: LOCATION_ID,
      fishId: FISH_ID,
      baitId: BAIT_ID,
      weightGrams: 50,
      holeDepthCm: null,
      userNoteRaw: null,
    });
    assert.equal('userId' in asObject(query.data), false);
  });

  void it('validates an actually changed Bait and rejects an inactive replacement', async () => {
    let baitQuery: unknown;
    let updateCalled = false;
    const activePrisma = {
      catchReport: {
        findUnique: () =>
          Promise.resolve({
            userId: USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          }),
        update: () => {
          updateCalled = true;
          return Promise.resolve(
            publicRecord({ bait: { id: OTHER_BAIT_ID, name: 'Блесна', type: 'LURE' } }),
          );
        },
      },
      bait: {
        findUnique: (input: unknown) => {
          baitQuery = input;
          return Promise.resolve({ isActive: true });
        },
      },
    } as unknown as PrismaService;
    const activeService = new CatchReportsService(activePrisma);

    await activeService.update(USER_ID, REPORT_ID, { baitId: OTHER_BAIT_ID });

    assert.deepEqual(asObject(baitQuery).where, { id: OTHER_BAIT_ID });
    assert.equal(updateCalled, true);

    const inactivePrisma = {
      catchReport: activePrisma.catchReport,
      bait: { findUnique: () => Promise.resolve({ isActive: false }) },
    } as unknown as PrismaService;
    const inactiveService = new CatchReportsService(inactivePrisma);

    await assert.rejects(
      () => inactiveService.update(USER_ID, REPORT_ID, { baitId: OTHER_BAIT_ID }),
      hasCode('BAIT_INACTIVE'),
    );
  });

  void it('validates the resulting LocationFish pair when location or fish actually changes', async () => {
    const scenarios = [
      {
        dto: { locationId: OTHER_LOCATION_ID },
        expectedLocationId: OTHER_LOCATION_ID,
        expectedFishId: FISH_ID,
      },
      {
        dto: { fishId: OTHER_FISH_ID },
        expectedLocationId: LOCATION_ID,
        expectedFishId: OTHER_FISH_ID,
      },
    ];

    for (const scenario of scenarios) {
      let locationQuery: unknown;
      let fishQuery: unknown;
      let relationQuery: unknown;
      const calls: string[] = [];
      const prisma = {
        catchReport: {
          findUnique: () =>
            Promise.resolve({
              userId: USER_ID,
              locationId: LOCATION_ID,
              fishId: FISH_ID,
              baitId: BAIT_ID,
            }),
          update: () => Promise.resolve(publicRecord()),
        },
        location: {
          findUnique: (input: unknown) => {
            calls.push('location');
            locationQuery = input;
            return Promise.resolve({ isActive: true, fishingBase: { isActive: true } });
          },
        },
        fish: {
          findUnique: (input: unknown) => {
            calls.push('fish');
            fishQuery = input;
            return Promise.resolve({ isActive: true });
          },
        },
        locationFish: {
          findUnique: (input: unknown) => {
            calls.push('locationFish');
            relationQuery = input;
            return Promise.resolve({ locationId: scenario.expectedLocationId });
          },
        },
      } as unknown as PrismaService;
      const service = new CatchReportsService(prisma);

      await service.update(USER_ID, REPORT_ID, scenario.dto);

      assert.deepEqual(calls, ['location', 'fish', 'locationFish']);
      assert.deepEqual(asObject(locationQuery).where, { id: scenario.expectedLocationId });
      assert.deepEqual(asObject(fishQuery).where, { id: scenario.expectedFishId });
      assert.deepEqual(asObject(asObject(relationQuery).where).locationId_fishId, {
        locationId: scenario.expectedLocationId,
        fishId: scenario.expectedFishId,
      });
    }
  });

  void it('checks ownership before validating catalog changes', async () => {
    let updateCalled = false;
    const prisma = {
      catchReport: {
        findUnique: () =>
          Promise.resolve({
            userId: OTHER_USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          }),
        update: () => {
          updateCalled = true;
          return Promise.resolve(publicRecord());
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    await assert.rejects(
      () => service.update(USER_ID, REPORT_ID, { locationId: OTHER_LOCATION_ID }),
      hasCode('CATCH_REPORT_NOT_OWNED'),
    );
    assert.equal(updateCalled, false);
  });

  void it('checks report existence and ownership before rejecting an empty PATCH', async () => {
    let findCalled = false;
    const prisma = {
      catchReport: {
        findUnique: () => {
          findCalled = true;
          return Promise.resolve({
            userId: USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          });
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    await assert.rejects(() => service.update(USER_ID, REPORT_ID, {}), hasCode('VALIDATION_ERROR'));
    assert.equal(findCalled, true);
  });

  void it('does not let an empty PATCH bypass not-found and ownership errors', async () => {
    const missingService = new CatchReportsService({
      catchReport: { findUnique: () => Promise.resolve(null) },
    } as unknown as PrismaService);
    const foreignService = new CatchReportsService({
      catchReport: {
        findUnique: () =>
          Promise.resolve({
            userId: OTHER_USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          }),
      },
    } as unknown as PrismaService);

    await assert.rejects(
      () => missingService.update(USER_ID, REPORT_ID, {}),
      hasCode('CATCH_REPORT_NOT_FOUND'),
    );
    await assert.rejects(
      () => foreignService.update(USER_ID, REPORT_ID, {}),
      hasCode('CATCH_REPORT_NOT_OWNED'),
    );
  });

  void it('maps P2003 and P2025 races to stable application errors', async () => {
    const { prisma: createPrisma } = validationPrisma({}, () =>
      Promise.reject(knownPrismaError('P2003')),
    );
    const createService = new CatchReportsService(createPrisma);

    await assert.rejects(
      () => createService.create(USER_ID, createDto()),
      hasCode('CATCH_REPORT_REFERENCE_CONFLICT'),
    );

    const mutationPrisma = {
      catchReport: {
        findUnique: () =>
          Promise.resolve({
            userId: USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
          }),
        update: () => Promise.reject(knownPrismaError('P2025')),
        delete: () => Promise.reject(knownPrismaError('P2025')),
      },
    } as unknown as PrismaService;
    const mutationService = new CatchReportsService(mutationPrisma);

    await assert.rejects(
      () => mutationService.update(USER_ID, REPORT_ID, { weightGrams: 41 }),
      hasCode('CATCH_REPORT_NOT_FOUND'),
    );
    await assert.rejects(
      () => mutationService.delete(USER_ID, REPORT_ID),
      hasCode('CATCH_REPORT_NOT_FOUND'),
    );
  });

  void it('filters my list by the authenticated actor and fetches limit plus one', async () => {
    let listQuery: unknown;
    const prisma = {
      catchReport: {
        findMany: (input: unknown) => {
          listQuery = input;
          return Promise.resolve([publicRecord()]);
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    const result = await service.listMine(USER_ID, { limit: 20 });
    const query = asObject(listQuery);

    assert.deepEqual(query.where, { userId: USER_ID });
    assert.deepEqual(query.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.equal(query.take, 21);
    assert.deepEqual(result.items[0]?.author, { id: USER_ID, nickname: 'Рыболов' });
    assert.equal(result.nextCursor, null);
  });

  void it('reads historical reports through direct relations without active filters', async () => {
    let detailQuery: unknown;
    const prisma = {
      catchReport: {
        findUnique: (input: unknown) => {
          detailQuery = input;
          return Promise.resolve(publicRecord());
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    const result = await service.getPublic(REPORT_ID);
    const query = asObject(detailQuery);

    assert.deepEqual(query.where, { id: REPORT_ID });
    assert.equal('where' in asObject(query.select), false);
    assert.deepEqual(result.report.fishingBase, {
      id: '60000000-0000-4000-8000-000000000001',
      name: 'Озера Танзании',
    });
    assert.equal('isActive' in result.report.fishingBase, false);
  });
});
