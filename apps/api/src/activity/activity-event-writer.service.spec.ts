import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Prisma } from '../generated/prisma/client.js';
import { ActivityEventWriter } from './activity-event-writer.service.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const REPORT_ID = '20000000-0000-4000-8000-000000000001';

void describe('ActivityEventWriter', () => {
  void it('resolves the actor, takes the ordering lock, then appends the immutable snapshot', async () => {
    const calls: string[] = [];
    let createInput: unknown;
    const transaction = {
      user: {
        findUnique: () => {
          calls.push('actor');
          return Promise.resolve({ nickname: 'Рыбак', role: 'USER' });
        },
      },
      $queryRaw: () => {
        calls.push('lock');
        return Promise.resolve([{ locked: false }]);
      },
      activityEvent: {
        create: (input: unknown) => {
          calls.push('event');
          createInput = input;
          return Promise.resolve({ id: 1n });
        },
      },
    } as unknown as Prisma.TransactionClient;

    await new ActivityEventWriter().append(transaction, ACTOR_ID, {
      type: 'CATCH_REPORT_BATCH_CREATED',
      subjectType: 'CATCH_REPORT_BATCH',
      subjectKey: REPORT_ID,
      payload: { createdCount: 3 },
    });

    assert.deepEqual(calls, ['actor', 'lock', 'event']);
    assert.deepEqual((createInput as { data: unknown }).data, {
      type: 'CATCH_REPORT_BATCH_CREATED',
      subjectType: 'CATCH_REPORT_BATCH',
      subjectKey: REPORT_ID,
      actorUserId: ACTOR_ID,
      actorNicknameSnapshot: 'Рыбак',
      actorRoleSnapshot: 'USER',
      payloadVersion: 1,
      payload: { createdCount: 3 },
    });
  });

  void it('refuses an event without a database actor', async () => {
    const transaction = {
      user: { findUnique: () => Promise.resolve(null) },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () =>
        new ActivityEventWriter().append(transaction, ACTOR_ID, {
          type: 'CATCH_REPORT_BATCH_CREATED',
          subjectType: 'CATCH_REPORT_BATCH',
          subjectKey: REPORT_ID,
          payload: { createdCount: 1 },
        }),
      /actor does not exist/u,
    );
  });
});
