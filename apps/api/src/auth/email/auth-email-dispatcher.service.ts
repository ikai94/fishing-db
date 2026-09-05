import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AuthTokenPurpose } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AUTH_EMAIL_DISPATCH_BATCH_SIZE,
  AUTH_EMAIL_DISPATCH_INTERVAL_MS,
  AUTH_EMAIL_CLEANUP_INTERVAL_MS,
  AUTH_EMAIL_COMPLETED_RETENTION_MS,
  AUTH_EMAIL_LEASE_MS,
  AUTH_TOKEN_RETENTION_MS,
} from '../auth.constants.js';
import { AUTH_EMAIL_TRANSPORT, type AuthEmailTransport } from './auth-email.transport.js';
import { AuthEmailTokenCipher } from './auth-email-token-cipher.service.js';

interface ClaimedAuthEmail {
  id: string;
  recipientEmail: string;
  encryptedToken: string;
  attemptCount: number;
  purpose: AuthTokenPurpose;
  expiresAt: Date;
}

const INITIAL_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

function retryDelay(attemptCount: number): number {
  return Math.min(INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1), MAX_RETRY_DELAY_MS);
}

@Injectable()
export class AuthEmailDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuthEmailDispatcher.name);
  private readonly nodeEnvironment: string;
  private readonly webOrigin: string;
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;
  private lastCleanupAt = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) configService: ConfigService,
    @Inject(AuthEmailTokenCipher) private readonly cipher: AuthEmailTokenCipher,
    @Inject(AUTH_EMAIL_TRANSPORT) private readonly transport: AuthEmailTransport,
  ) {
    this.nodeEnvironment = configService.getOrThrow<string>('NODE_ENV');
    this.webOrigin = configService.getOrThrow<string>('WEB_ORIGIN');
  }

  onApplicationBootstrap(): void {
    if (this.nodeEnvironment === 'test') {
      return;
    }

    this.timer = setInterval(
      () => void this.runScheduledDispatch(),
      AUTH_EMAIL_DISPATCH_INTERVAL_MS,
    );
    this.timer.unref();
    void this.runScheduledDispatch();
  }

  onApplicationShutdown(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async dispatchPending(limit = AUTH_EMAIL_DISPATCH_BATCH_SIZE): Promise<number> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + AUTH_EMAIL_LEASE_MS);

    if (now.getTime() - this.lastCleanupAt >= AUTH_EMAIL_CLEANUP_INTERVAL_MS) {
      await this.cleanupOldRecords(now);
      this.lastCleanupAt = now.getTime();
    }

    await this.prisma.$executeRaw`
      UPDATE "AuthEmailOutbox" AS outbox
      SET "cancelledAt" = ${now}, "leaseUntil" = NULL
      WHERE outbox."sentAt" IS NULL
        AND outbox."cancelledAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "AuthToken" AS token
          WHERE token."id" = outbox."authTokenId"
            AND (
              token."consumedAt" IS NOT NULL
              OR token."invalidatedAt" IS NOT NULL
              OR token."expiresAt" <= ${now}
            )
        )
    `;

    const claimed = await this.prisma.$queryRaw<ClaimedAuthEmail[]>(Prisma.sql`
      WITH candidates AS (
        SELECT
          outbox."id",
          token."purpose",
          token."expiresAt"
        FROM "AuthEmailOutbox" AS outbox
        INNER JOIN "AuthToken" AS token ON token."id" = outbox."authTokenId"
        WHERE outbox."sentAt" IS NULL
          AND outbox."cancelledAt" IS NULL
          AND outbox."availableAt" <= ${now}
          AND (outbox."leaseUntil" IS NULL OR outbox."leaseUntil" <= ${now})
          AND token."consumedAt" IS NULL
          AND token."invalidatedAt" IS NULL
          AND token."expiresAt" > ${now}
        ORDER BY outbox."availableAt" ASC, outbox."createdAt" ASC
        FOR UPDATE OF outbox SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "AuthEmailOutbox" AS outbox
      SET
        "leaseUntil" = ${leaseUntil},
        "attemptCount" = outbox."attemptCount" + 1
      FROM candidates
      WHERE outbox."id" = candidates."id"
      RETURNING
        outbox."id",
        outbox."recipientEmail",
        outbox."encryptedToken",
        outbox."attemptCount",
        candidates."purpose",
        candidates."expiresAt"
    `);

    await Promise.all(claimed.map((message) => this.deliver(message)));
    return claimed.length;
  }

  private async runScheduledDispatch(): Promise<void> {
    if (this.dispatching) {
      return;
    }

    this.dispatching = true;

    try {
      await this.dispatchPending();
    } catch (error: unknown) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`Auth email dispatch cycle failed (${errorName})`);
    } finally {
      this.dispatching = false;
    }
  }

  private async deliver(message: ClaimedAuthEmail): Promise<void> {
    try {
      const rawToken = this.cipher.decrypt(message.encryptedToken);
      const path = message.purpose === 'EMAIL_VERIFICATION' ? '/verify-email' : '/reset-password';
      const actionUrl = `${this.webOrigin}${path}#token=${encodeURIComponent(rawToken)}`;

      await this.transport.send({
        recipientEmail: message.recipientEmail,
        purpose: message.purpose,
        actionUrl,
        expiresAt: message.expiresAt,
      });
      await this.prisma.authEmailOutbox.updateMany({
        where: { id: message.id, sentAt: null, cancelledAt: null },
        data: { sentAt: new Date(), leaseUntil: null },
      });
    } catch (error: unknown) {
      const now = new Date();
      const availableAt = new Date(now.getTime() + retryDelay(message.attemptCount));
      const errorName = error instanceof Error ? error.name : 'UnknownError';

      this.logger.warn(`Auth email delivery ${message.id} failed (${errorName})`);
      await this.prisma.authEmailOutbox.updateMany({
        where: { id: message.id, sentAt: null, cancelledAt: null },
        data:
          availableAt >= message.expiresAt
            ? { cancelledAt: now, leaseUntil: null }
            : { availableAt, leaseUntil: null },
      });
    }
  }

  private async cleanupOldRecords(now: Date): Promise<void> {
    const completedBefore = new Date(now.getTime() - AUTH_EMAIL_COMPLETED_RETENTION_MS);
    const tokenBefore = new Date(now.getTime() - AUTH_TOKEN_RETENTION_MS);

    await this.prisma.authEmailOutbox.deleteMany({
      where: {
        OR: [{ sentAt: { lt: completedBefore } }, { cancelledAt: { lt: completedBefore } }],
      },
    });
    await this.prisma.authToken.deleteMany({ where: { expiresAt: { lt: tokenBefore } } });
  }
}
