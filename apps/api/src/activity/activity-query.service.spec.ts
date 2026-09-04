import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { describe, it } from 'node:test';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ActivityQueryService } from './activity-query.service.js';
import { encodeActivityCursor } from './activity-pagination.js';

const REPORT_ID = '20000000-0000-4000-8000-000000000001';

function storedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 2n,
    type: 'CATCH_REPORT_CREATED' as const,
    subjectType: 'CATCH_REPORT' as const,
    subjectKey: REPORT_ID,
    actorNicknameSnapshot: 'Рыбак',
    actorRoleSnapshot: 'USER' as const,
    payloadVersion: 1,
    payload: {
      report: {
        reportId: REPORT_ID,
        fish: { id: '40000000-0000-4000-8000-000000000001', name: 'Кижуч' },
        fishingBase: { id: '60000000-0000-4000-8000-000000000001', name: 'Амур' },
        location: {
          id: '30000000-0000-4000-8000-000000000001',
          number: 7,
          name: 'Протока',
        },
        bait: { id: '50000000-0000-4000-8000-000000000001', name: 'Мотыль' },
        weightGrams: 950,
      },
    },
    occurredAt: new Date('2026-09-04T12:00:00.000Z'),
    ...overrides,
  };
}

void describe('ActivityQueryService', () => {
  void it('uses id-only cursor pagination and returns an explicit public projection', async () => {
    let queryInput: unknown;
    const prisma = {
      activityEvent: {
        findMany: (input: unknown) => {
          queryInput = input;
          return Promise.resolve([storedEvent()]);
        },
      },
    } as unknown as PrismaService;

    const result = await new ActivityQueryService(prisma).list({
      limit: 10,
      cursor: encodeActivityCursor(3n),
    });

    assert.deepEqual((queryInput as { where: unknown }).where, { id: { lt: 3n } });
    assert.deepEqual(result, {
      items: [
        {
          id: '2',
          type: 'CATCH_REPORT_CREATED',
          occurredAt: new Date('2026-09-04T12:00:00.000Z'),
          actor: { kind: 'ANGLER', nickname: 'Рыбак' },
          data: storedEvent().payload,
        },
      ],
      nextCursor: null,
    });
    assert.equal(JSON.stringify(result).includes('actorUserId'), false);
    assert.equal(JSON.stringify(result).includes('payloadVersion'), false);
  });

  void it('masks ADMIN identity on catalog events', async () => {
    const prisma = {
      activityEvent: {
        findMany: () =>
          Promise.resolve([
            storedEvent({
              type: 'CATALOG_ITEM_CREATED',
              subjectType: 'FISH',
              subjectKey: '40000000-0000-4000-8000-000000000001',
              actorNicknameSnapshot: 'Secret Admin',
              actorRoleSnapshot: 'ADMIN',
              payload: {
                item: {
                  kind: 'FISH',
                  id: '40000000-0000-4000-8000-000000000001',
                  name: 'Кижуч',
                  isActive: true,
                },
              },
            }),
          ]),
      },
    } as unknown as PrismaService;

    const result = await new ActivityQueryService(prisma).list({ limit: 10 });
    assert.deepEqual(result.items[0]?.actor, { kind: 'ADMINISTRATION' });
    assert.equal(JSON.stringify(result).includes('Secret Admin'), false);
  });

  void it('fails closed for malformed stored payloads and public cursors', async () => {
    const prisma = {
      activityEvent: {
        findMany: () => Promise.resolve([storedEvent({ payload: { rawSourceText: 'private' } })]),
      },
    } as unknown as PrismaService;
    const service = new ActivityQueryService(prisma);

    await assert.rejects(
      () => service.list({ limit: 10 }),
      (error: unknown) => {
        return error instanceof HttpException && error.getStatus() === 500;
      },
    );
    await assert.rejects(
      () => service.list({ limit: 10, cursor: 'invalid+' }),
      (error: unknown) => {
        return error instanceof HttpException && error.getStatus() === 400;
      },
    );
  });
});
