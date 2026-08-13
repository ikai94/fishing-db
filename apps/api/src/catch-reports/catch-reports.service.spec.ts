import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { encodeCatchReportCursor } from './catch-report-pagination.js';
import { CatchReportsService } from './catch-reports.service.js';
import type { CreateCatchReportDto } from './dto/create-catch-report.dto.js';

const USER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '10000000-0000-4000-8000-000000000002';
const REPORT_ID = '20000000-0000-4000-8000-000000000001';
const LOCATION_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_LOCATION_ID = '30000000-0000-4000-8000-000000000002';
const FISH_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_FISH_ID = '40000000-0000-4000-8000-000000000002';
const BAIT_ID = '50000000-0000-4000-8000-000000000001';
const OTHER_BAIT_ID = '50000000-0000-4000-8000-000000000002';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';
const CREATED_AT = new Date('2026-08-09T10:00:00.000Z');
const UPDATED_AT = new Date('2026-08-09T10:05:00.000Z');

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function hasCode(expectedCode: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof HttpException)) return false;
    const response = error.getResponse();
    return typeof response === 'object' && response !== null && 'code' in response
      ? response.code === expectedCode
      : false;
  };
}

function hasFieldError(field: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    if (!(error instanceof HttpException)) return false;
    const response = asObject(error.getResponse());
    const errors = asObject(response.errors);
    return Array.isArray(errors[field]) && errors[field].length > 0;
  };
}

function withTransaction<T extends object>(
  database: T,
  conflictsBeforeSuccess = 0,
  actorIsBanned = false,
): T {
  let attempts = 0;
  return Object.assign(database, {
    $queryRaw: () => Promise.resolve([{ isBanned: actorIsBanned }]),
    $transaction: <Result>(callback: (tx: T) => Promise<Result>): Promise<Result> => {
      attempts += 1;
      return attempts <= conflictsBeforeSuccess
        ? Promise.reject(Object.assign(new Error('Transaction conflict'), { code: 'P2034' }))
        : callback(database);
    },
  });
}

function reportRecord(
  overrides: Partial<{
    fishingMethod: 'BAIT_FISHING' | 'SPINNING';
    holeDepthCm: number | null;
    spinningSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
    spinningSpeed: 'SLOW' | 'MEDIUM' | 'FAST' | null;
    rawSourceText: string | null;
  }> = {},
) {
  return {
    id: REPORT_ID,
    weightGrams: 40,
    fishingMethod: overrides.fishingMethod ?? 'BAIT_FISHING',
    holeDepthCm: overrides.holeDepthCm === undefined ? 600 : overrides.holeDepthCm,
    spotPositionRaw: '  удочка  ',
    fishingNote: null,
    spinningSize: overrides.spinningSize === undefined ? null : overrides.spinningSize,
    spinningSpeed: overrides.spinningSpeed === undefined ? null : overrides.spinningSpeed,
    userNoteRaw: 'Комментарий',
    rawSourceText:
      overrides.rawSourceText === undefined ? 'Исходная строка' : overrides.rawSourceText,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    user: { id: USER_ID, nickname: 'Рыболов' },
    location: {
      id: LOCATION_ID,
      number: 1,
      name: 'Берег',
      fishingBase: { id: BASE_ID, name: 'База' },
    },
    fish: { id: FISH_ID, name: 'Рыба' },
    bait: { id: BAIT_ID, name: 'Мотыль' },
  };
}

function reportScalarRecord(
  overrides: Parameters<typeof reportRecord>[0] = {},
): Record<string, unknown> {
  const report = reportRecord(overrides);
  return {
    id: report.id,
    userId: USER_ID,
    locationId: LOCATION_ID,
    fishId: FISH_ID,
    baitId: BAIT_ID,
    weightGrams: report.weightGrams,
    fishingMethod: report.fishingMethod,
    holeDepthCm: report.holeDepthCm,
    spotPositionRaw: report.spotPositionRaw,
    fishingNote: report.fishingNote,
    spinningSize: report.spinningSize,
    spinningSpeed: report.spinningSpeed,
    userNoteRaw: report.userNoteRaw,
    rawSourceText: report.rawSourceText,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  };
}

function createDto(overrides: Partial<CreateCatchReportDto> = {}): CreateCatchReportDto {
  return {
    locationId: LOCATION_ID,
    fishId: FISH_ID,
    baitId: BAIT_ID,
    weightGrams: 40,
    holeDepthCm: 600,
    spotPositionRaw: '  удочка  ',
    fishingNote: null,
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: 'Комментарий',
    rawSourceText: 'Исходная строка',
    ...overrides,
  };
}

interface CreateMockOptions {
  baitType?: 'BAIT' | 'LURE';
  location?: unknown;
  fish?: unknown;
  membership?: unknown;
  bait?: unknown;
  created?: ReturnType<typeof reportRecord>;
  transactionConflicts?: number;
}

function createPrisma(options: CreateMockOptions = {}) {
  const calls: string[] = [];
  let createQuery: unknown;
  const prisma = withTransaction(
    {
      user: { findUnique: () => Promise.resolve({ id: USER_ID, nickname: 'Рыболов' }) },
      location: {
        findUnique: (query: unknown) => {
          if ('isActive' in asObject(asObject(query).select)) calls.push('location');
          return Promise.resolve(
            options.location === undefined
              ? {
                  id: LOCATION_ID,
                  fishingBaseId: BASE_ID,
                  number: 1,
                  name: 'Берег',
                  isActive: true,
                  fishingBase: { isActive: true },
                }
              : options.location,
          );
        },
      },
      fish: {
        findUnique: (query: unknown) => {
          if ('isActive' in asObject(asObject(query).select)) calls.push('fish');
          return Promise.resolve(
            options.fish === undefined
              ? { id: FISH_ID, name: 'Рыба', isActive: true }
              : options.fish,
          );
        },
      },
      fishingBaseFish: {
        findUnique: () => {
          calls.push('membership');
          return Promise.resolve(
            options.membership === undefined ? { fishingBaseId: BASE_ID } : options.membership,
          );
        },
      },
      bait: {
        findUnique: (query: unknown) => {
          if ('isActive' in asObject(asObject(query).select)) calls.push('bait');
          return Promise.resolve(
            options.bait === undefined
              ? { id: BAIT_ID, name: 'Мотыль', isActive: true, type: options.baitType ?? 'BAIT' }
              : options.bait,
          );
        },
      },
      catchReport: {
        create: (query: unknown) => {
          calls.push('create');
          createQuery = query;
          return Promise.resolve(options.created ?? reportRecord());
        },
        findFirst: () => Promise.resolve(reportScalarRecord()),
      },
      fishingBase: {
        findUnique: () => Promise.resolve({ id: BASE_ID, name: 'База' }),
      },
    },
    options.transactionConflicts,
  ) as unknown as PrismaService;

  return { prisma, calls, createQuery: () => createQuery };
}

void describe('CatchReportsService v2', () => {
  void it('derives BAIT_FISHING, validates Base membership, preserves text, and ignores spoofed fields', async () => {
    const mock = createPrisma();
    const service = new CatchReportsService(mock.prisma);
    const malicious = {
      ...createDto(),
      userId: OTHER_USER_ID,
      fishingBaseId: OTHER_BASE_ID,
      fishingMethod: 'SPINNING',
    } as unknown as CreateCatchReportDto;

    const result = await service.create(USER_ID, malicious);
    const data = asObject(asObject(mock.createQuery()).data);

    assert.deepEqual(mock.calls, ['location', 'fish', 'membership', 'bait', 'create']);
    assert.deepEqual(data, {
      userId: USER_ID,
      locationId: LOCATION_ID,
      fishId: FISH_ID,
      baitId: BAIT_ID,
      weightGrams: 40,
      fishingMethod: 'BAIT_FISHING',
      holeDepthCm: 600,
      spotPositionRaw: '  удочка  ',
      fishingNote: null,
      spinningSize: null,
      spinningSpeed: null,
      userNoteRaw: 'Комментарий',
      rawSourceText: 'Исходная строка',
    });
    assert.equal(result.report.rawSourceText, 'Исходная строка');
    assert.equal('type' in result.report.bait, false);
  });

  void it('requires a hole for BAIT and both structured fields for SPINNING', async () => {
    const baitService = new CatchReportsService(createPrisma().prisma);
    await assert.rejects(
      baitService.create(USER_ID, createDto({ holeDepthCm: null })),
      hasFieldError('holeDepthCm'),
    );

    const spinningService = new CatchReportsService(createPrisma({ baitType: 'LURE' }).prisma);
    await assert.rejects(
      spinningService.create(
        USER_ID,
        createDto({ holeDepthCm: 1_078, spinningSize: null, spinningSpeed: null }),
      ),
      hasFieldError('spinningSize'),
    );
  });

  void it('creates SPINNING with size/speed and an optional hole', async () => {
    let query: unknown;
    const mock = createPrisma({
      baitType: 'LURE',
      created: reportRecord({
        fishingMethod: 'SPINNING',
        holeDepthCm: 1_078,
        spinningSize: 'MEDIUM',
        spinningSpeed: 'SLOW',
      }),
    });
    const originalCreate = (
      mock.prisma as unknown as {
        catchReport: { create: (value: unknown) => Promise<unknown> };
      }
    ).catchReport.create;
    (
      mock.prisma as unknown as { catchReport: { create: (value: unknown) => Promise<unknown> } }
    ).catchReport.create = (value) => {
      query = value;
      return originalCreate(value);
    };

    await new CatchReportsService(mock.prisma).create(
      USER_ID,
      createDto({ holeDepthCm: 1_078, spinningSize: 'MEDIUM', spinningSpeed: 'SLOW' }),
    );

    assert.deepEqual(asObject(asObject(query).data), {
      userId: USER_ID,
      locationId: LOCATION_ID,
      fishId: FISH_ID,
      baitId: BAIT_ID,
      weightGrams: 40,
      fishingMethod: 'SPINNING',
      holeDepthCm: 1_078,
      spotPositionRaw: '  удочка  ',
      fishingNote: null,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
      userNoteRaw: 'Комментарий',
      rawSourceText: 'Исходная строка',
    });
  });

  void it('returns stable catalog errors for missing Base/Fish membership', async () => {
    const service = new CatchReportsService(createPrisma({ membership: null }).prisma);
    await assert.rejects(
      service.create(USER_ID, createDto()),
      hasCode('FISH_NOT_AVAILABLE_AT_FISHING_BASE'),
    );
  });

  void it('retries serializable transaction conflicts before writing', async () => {
    const mock = createPrisma({ transactionConflicts: 2 });
    const result = await new CatchReportsService(mock.prisma).create(USER_ID, createDto());

    assert.equal(result.report.id, REPORT_ID);
    assert.deepEqual(mock.calls, ['location', 'fish', 'membership', 'bait', 'create']);
  });

  void it('uses persisted method for observation-only and redundant same-bait updates', async () => {
    const calls: string[] = [];
    let updateQuery: unknown;
    const prisma = withTransaction({
      user: { findUnique: () => Promise.resolve({ id: USER_ID, nickname: 'Рыболов' }) },
      catchReport: {
        findUnique: () =>
          Promise.resolve({
            userId: USER_ID,
            locationId: LOCATION_ID,
            fishId: FISH_ID,
            baitId: BAIT_ID,
            fishingMethod: 'BAIT_FISHING',
            holeDepthCm: 600,
            spinningSize: null,
            spinningSpeed: null,
          }),
        update: (query: unknown) => {
          updateQuery = query;
          return Promise.resolve(reportRecord());
        },
        findFirst: () => Promise.resolve(reportScalarRecord()),
      },
      bait: {
        findUnique: (query: unknown) => {
          if ('type' in asObject(asObject(query).select)) calls.push('bait');
          return Promise.resolve({ id: BAIT_ID, name: 'Мотыль', isActive: true, type: 'LURE' });
        },
      },
      location: {
        findUnique: () =>
          Promise.resolve({
            id: LOCATION_ID,
            fishingBaseId: BASE_ID,
            number: 1,
            name: 'Берег',
          }),
      },
      fishingBase: { findUnique: () => Promise.resolve({ id: BASE_ID, name: 'База' }) },
      fish: { findUnique: () => Promise.resolve({ id: FISH_ID, name: 'Рыба' }) },
    }) as unknown as PrismaService;

    await new CatchReportsService(prisma).update(USER_ID, REPORT_ID, {
      baitId: BAIT_ID,
      weightGrams: 41,
    });

    assert.deepEqual(calls, []);
    assert.deepEqual(asObject(asObject(updateQuery).data), {
      baitId: BAIT_ID,
      weightGrams: 41,
    });
  });

  void it('re-derives an actual BAIT to LURE change and requires spinning observations', async () => {
    const prisma = updatePrisma({ replacementType: 'LURE' });
    const service = new CatchReportsService(prisma.value);

    await assert.rejects(
      service.update(USER_ID, REPORT_ID, { baitId: OTHER_BAIT_ID }),
      hasFieldError('spinningSize'),
    );

    await service.update(USER_ID, REPORT_ID, {
      baitId: OTHER_BAIT_ID,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
    });
    const data = asObject(asObject(prisma.lastUpdate()).data);
    assert.equal(data.fishingMethod, 'SPINNING');
    assert.equal(data.spinningSize, 'MEDIUM');
    assert.equal(data.spinningSpeed, 'SLOW');
  });

  void it('re-derives LURE to BAIT, requires a hole, and clears stale spinning data', async () => {
    const prisma = updatePrisma({
      currentMethod: 'SPINNING',
      currentHole: null,
      currentSize: 'MEDIUM',
      currentSpeed: 'SLOW',
      replacementType: 'BAIT',
    });
    const service = new CatchReportsService(prisma.value);

    await assert.rejects(
      service.update(USER_ID, REPORT_ID, { baitId: OTHER_BAIT_ID }),
      hasFieldError('holeDepthCm'),
    );

    await service.update(USER_ID, REPORT_ID, {
      baitId: OTHER_BAIT_ID,
      holeDepthCm: 555,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
    });
    assert.deepEqual(asObject(asObject(prisma.lastUpdate()).data), {
      baitId: OTHER_BAIT_ID,
      holeDepthCm: 555,
      fishingMethod: 'BAIT_FISHING',
      spinningSize: null,
      spinningSpeed: null,
    });
  });

  void it('allows unrelated edits on a preserved incomplete legacy row', async () => {
    const prisma = updatePrisma({ currentMethod: 'BAIT_FISHING', currentHole: null });
    await new CatchReportsService(prisma.value).update(USER_ID, REPORT_ID, { weightGrams: 50 });
    assert.deepEqual(asObject(asObject(prisma.lastUpdate()).data), { weightGrams: 50 });
  });

  void it('keeps raw source out of public detail and exposes it only through owner detail', async () => {
    const record = reportRecord();
    const prisma = {
      catchReport: {
        findUnique: () => Promise.resolve(record),
        findFirst: (query: unknown) => {
          assert.deepEqual(asObject(query).where, { id: REPORT_ID, userId: USER_ID });
          return Promise.resolve(record);
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    const publicResult = await service.getPublic(REPORT_ID);
    const ownerResult = await service.getMine(USER_ID, REPORT_ID);
    assert.equal('rawSourceText' in publicResult.report, false);
    assert.equal(ownerResult.report.rawSourceText, 'Исходная строка');
  });

  void it('filters the public list by Fish and multiple Bases in one paginated query', async () => {
    let query: unknown;
    const prisma = {
      catchReport: {
        findMany: (input: unknown) => {
          query = input;
          return Promise.resolve([reportRecord()]);
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);
    const cursorDate = new Date('2026-08-09T11:00:00.000Z');
    const cursor = encodeCatchReportCursor({ createdAt: cursorDate, id: REPORT_ID });

    const result = await service.listPublic({
      limit: 2,
      cursor,
      fishId: FISH_ID,
      baseIds: [BASE_ID, OTHER_BASE_ID],
    });
    const queryObject = asObject(query);

    assert.deepEqual(queryObject.where, {
      fishId: FISH_ID,
      location: { fishingBaseId: { in: [BASE_ID, OTHER_BASE_ID] } },
      OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: REPORT_ID } }],
    });
    assert.deepEqual(queryObject.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.equal(queryObject.take, 3);
    assert.equal('rawSourceText' in asObject(queryObject.select), false);
    assert.equal(result.items.length, 1);
    assert.equal(result.nextCursor, null);
  });

  void it('keeps omitted public filters and owner list queries unfiltered', async () => {
    const queries: unknown[] = [];
    const prisma = {
      catchReport: {
        findMany: (input: unknown) => {
          queries.push(input);
          return Promise.resolve([]);
        },
      },
    } as unknown as PrismaService;
    const service = new CatchReportsService(prisma);

    await service.listPublic({ limit: 20 });
    await service.listMine(USER_ID, { limit: 20 });

    assert.deepEqual(asObject(queries[0]).where, {});
    assert.deepEqual(asObject(queries[1]).where, { userId: USER_ID });
  });

  void it('checks ownership before validating an update', async () => {
    const prisma = updatePrisma({ ownerId: OTHER_USER_ID });
    await assert.rejects(
      new CatchReportsService(prisma.value).update(USER_ID, REPORT_ID, {
        locationId: OTHER_LOCATION_ID,
        fishId: OTHER_FISH_ID,
      }),
      hasCode('CATCH_REPORT_NOT_OWNED'),
    );
  });

  void it('rechecks the actor ban state inside mutations after guard authorization', async () => {
    let createCalled = false;
    const prisma = withTransaction(
      {
        catchReport: {
          create: () => {
            createCalled = true;
            return Promise.resolve({ id: REPORT_ID });
          },
        },
      },
      0,
      true,
    ) as unknown as PrismaService;

    await assert.rejects(
      () => new CatchReportsService(prisma).create(USER_ID, createDto()),
      hasCode('ACCOUNT_BANNED'),
    );
    assert.equal(createCalled, false);
  });
});

interface UpdatePrismaOptions {
  ownerId?: string;
  currentMethod?: 'BAIT_FISHING' | 'SPINNING';
  currentHole?: number | null;
  currentSize?: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  currentSpeed?: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  replacementType?: 'BAIT' | 'LURE';
}

function updatePrisma(options: UpdatePrismaOptions = {}) {
  let updateQuery: unknown;
  const currentMethod = options.currentMethod ?? 'BAIT_FISHING';
  const currentHole = options.currentHole === undefined ? 600 : options.currentHole;
  const currentSize = options.currentSize === undefined ? null : options.currentSize;
  const currentSpeed = options.currentSpeed === undefined ? null : options.currentSpeed;
  const resultRecord = reportRecord({
    fishingMethod: options.replacementType === 'LURE' ? 'SPINNING' : currentMethod,
    holeDepthCm: currentHole,
    spinningSize: currentSize,
    spinningSpeed: currentSpeed,
  });
  const value = withTransaction({
    user: { findUnique: () => Promise.resolve({ id: USER_ID, nickname: 'Рыболов' }) },
    catchReport: {
      findUnique: () =>
        Promise.resolve({
          userId: options.ownerId ?? USER_ID,
          locationId: LOCATION_ID,
          fishId: FISH_ID,
          baitId: BAIT_ID,
          fishingMethod: currentMethod,
          holeDepthCm: currentHole,
          spinningSize: currentSize,
          spinningSpeed: currentSpeed,
        }),
      update: (query: unknown) => {
        updateQuery = query;
        return Promise.resolve(resultRecord);
      },
      findFirst: () =>
        Promise.resolve(
          reportScalarRecord({
            fishingMethod: options.replacementType === 'LURE' ? 'SPINNING' : currentMethod,
            holeDepthCm: currentHole,
            spinningSize: currentSize,
            spinningSpeed: currentSpeed,
          }),
        ),
    },
    bait: {
      findUnique: () =>
        Promise.resolve({
          id: BAIT_ID,
          name: 'Мотыль',
          isActive: true,
          type: options.replacementType ?? 'BAIT',
        }),
    },
    location: {
      findUnique: () =>
        Promise.resolve({
          id: LOCATION_ID,
          fishingBaseId: BASE_ID,
          number: 1,
          name: 'Берег',
        }),
    },
    fishingBase: { findUnique: () => Promise.resolve({ id: BASE_ID, name: 'База' }) },
    fish: { findUnique: () => Promise.resolve({ id: FISH_ID, name: 'Рыба' }) },
  }) as unknown as PrismaService;

  return { value, lastUpdate: () => updateQuery };
}
