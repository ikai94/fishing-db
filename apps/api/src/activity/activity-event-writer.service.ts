import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { ActivityEventInput } from './activity-event.types.js';

const ACTIVITY_EVENT_ORDERING_LOCK = 8_196_113_781_005_221n;

@Injectable()
export class ActivityEventWriter {
  async append(
    transaction: Prisma.TransactionClient,
    actorUserId: string,
    event: ActivityEventInput,
  ): Promise<void> {
    const actor = await transaction.user.findUnique({
      where: { id: actorUserId },
      select: { nickname: true, role: true },
    });

    if (actor === null) {
      throw new Error('ActivityEvent actor does not exist');
    }

    await transaction.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(${ACTIVITY_EVENT_ORDERING_LOCK}) IS NULL AS "locked"
    `;
    await transaction.activityEvent.create({
      data: {
        type: event.type,
        subjectType: event.subjectType,
        subjectKey: event.subjectKey,
        actorUserId,
        actorNicknameSnapshot: actor.nickname,
        actorRoleSnapshot: actor.role,
        payloadVersion: 1,
        payload: event.payload,
      },
      select: { id: true },
    });
  }
}
