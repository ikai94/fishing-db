import { createHash, randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RECORDS_MAPPING_VERSION,
  RECORDS_PARSER_VERSION,
  RECORDS_SYNC_INTERVAL_MS,
  RECORDS_SYNC_LEASE_MS,
} from './records.constants.js';
import { getOfficialFishMapping, resolveOfficialRecordRows } from './records-catalog-resolver.js';
import { fetchOfficialRecords } from './records-source.js';
import { getRecordsWeek } from './records-week.js';

// Верхняя граница backoff не позволяет длительной ошибке откладывать проверку более чем на час.
const RETRY_MAX_MS = 60 * 60_000;

/**
 * Фоново синхронизирует официальные недельные рекорды в неизменяемые снимки PostgreSQL.
 * Межпроцессная аренда не допускает одновременную запись несколькими экземплярами API, а
 * локальный флаг защищает один экземпляр от наложения запусков таймера.
 */
@Injectable()
export class RecordsSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecordsSyncService.name);
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.enabled = config.getOrThrow<boolean>('RECORDS_SYNC_ENABLED');
  }

  /** Запускает минутный планировщик и немедленную первую попытку, когда синхронизация включена. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.runScheduledSync(), 60_000);
    this.timer.unref();
    void this.runScheduledSync();
  }

  /** Освобождает локальный таймер при штатной остановке Nest-приложения. */
  onApplicationShutdown(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /**
   * Пытается захватить аренду, загрузить источник и атомарно принять снимок текущей недели.
   * Возвращает false, если другой экземпляр уже работает или следующая попытка ещё не наступила;
   * ошибки после захвата сохраняют диагностическое состояние и пробрасываются вызывающему коду.
   */
  async syncNow(now = new Date()): Promise<boolean> {
    const owner = randomUUID();
    const week = getRecordsWeek(now);
    await this.prisma.officialRecordSyncState.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });

    // Условный update одновременно проверяет расписание и захватывает межпроцессную аренду.
    const claimed = await this.prisma.officialRecordSyncState.updateMany({
      where: {
        id: 1,
        OR: [{ nextAttemptAt: { lte: now } }, { lastSuccessAt: { lt: week.startsAt } }],
        AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }],
      },
      data: {
        lastAttemptAt: now,
        leaseOwner: owner,
        leaseUntil: new Date(now.getTime() + RECORDS_SYNC_LEASE_MS),
      },
    });
    if (claimed.count !== 1) return false;

    try {
      const parsed = await fetchOfficialRecords();
      if (parsed.rows.some((row) => row.caughtAt < week.startsAt || row.caughtAt >= week.endsAt)) {
        throw new Error('Official records source still contains rows outside the current week');
      }

      // Небольшой допуск учитывает расхождение часов источника и API, но отсекает будущие данные.
      if (parsed.rows.some((row) => row.caughtAt.getTime() > now.getTime() + 5 * 60_000)) {
        throw new Error('Official records source contains a future record date');
      }
      const [fish, bases, mapping] = await Promise.all([
        this.prisma.fish.findMany({
          select: {
            id: true,
            nameNormalized: true,
            forumTopicId: true,
            officialFishImageKey: true,
          },
        }),
        this.prisma.fishingBase.findMany({ select: { id: true, nameNormalized: true } }),
        getOfficialFishMapping(),
      ]);
      const rows = resolveOfficialRecordRows(parsed.rows, fish, bases, mapping);

      // Каноническая сортировка делает хеш содержимого независимым от порядка строк в HTML.
      const contentHash = createHash('sha256')
        .update(
          JSON.stringify(
            rows
              .map((row) => ({
                fishId: row.fishId,
                fishingBaseId: row.fishingBaseId,
                weightGrams: row.weightGrams,
                fishName: row.fishName,
                fishPath: row.fishPath,
                waterbody: row.waterbody,
                baitRaw: row.baitRaw,
                playerName: row.playerName,
                caughtAt: row.caughtAt.toISOString(),
                caughtAtRaw: row.caughtAtRaw,
              }))
              .sort((left, right) => left.fishId.localeCompare(right.fishId)),
          ),
        )
        .digest('hex');

      // Блокировка строки повторно подтверждает владение арендой и объединяет снимок со служебным
      // состоянием в одну транзакцию: читатели не увидят частично принятую синхронизацию.
      await this.prisma.$transaction(async (tx) => {
        const state = await tx.$queryRaw<
          Array<{ leaseOwner: string | null; leaseUntil: Date | null }>
        >(Prisma.sql`
          SELECT "leaseOwner", "leaseUntil" FROM "OfficialRecordSyncState" WHERE "id" = 1 FOR UPDATE
        `);
        if (
          state[0]?.leaseOwner !== owner ||
          state[0].leaseUntil === null ||
          state[0].leaseUntil <= new Date()
        ) {
          throw new Error('Official records sync lease was lost');
        }
        const latest = await tx.officialRecordSnapshot.findFirst({
          where: { weekStartsAt: week.startsAt },
          orderBy: { fetchedAt: 'desc' },
          select: { contentHash: true, parserVersion: true, mappingVersion: true },
        });

        // Неизменяемый снимок создаётся только при новом содержимом или версии правил обработки.
        if (
          latest?.contentHash !== contentHash ||
          latest.parserVersion !== RECORDS_PARSER_VERSION ||
          latest.mappingVersion !== RECORDS_MAPPING_VERSION
        ) {
          await tx.officialRecordSnapshot.create({
            data: {
              weekStartsAt: week.startsAt,
              fetchedAt: now,
              contentHash,
              parserVersion: RECORDS_PARSER_VERSION,
              mappingVersion: RECORDS_MAPPING_VERSION,
              rows: {
                create: rows.map((row) => ({
                  fishId: row.fishId,
                  fishingBaseId: row.fishingBaseId,
                  weightGrams: row.weightGrams,
                  sourceFishName: row.fishName,
                  sourceFishPath: row.fishPath,
                  waterbodyRaw: row.waterbody,
                  baitRaw: row.baitRaw,
                  playerNameRaw: row.playerName,
                  caughtAt: row.caughtAt,
                  caughtAtRaw: row.caughtAtRaw,
                })),
              },
            },
          });
        }
        await tx.officialRecordSyncState.update({
          where: { id: 1 },
          data: {
            lastSuccessAt: now,
            lastError: null,
            failureCount: 0,
            nextAttemptAt: new Date(now.getTime() + RECORDS_SYNC_INTERVAL_MS),
            leaseOwner: null,
            leaseUntil: null,
          },
        });
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown records sync error';
      const state = await this.prisma.officialRecordSyncState.findUnique({
        where: { id: 1 },
        select: { failureCount: true },
      });
      const failures = Math.min((state?.failureCount ?? 0) + 1, 10);

      // Экспоненциальная задержка снижает нагрузку при повторяющемся сбое и ограничивается одним часом.
      const delay = Math.min(RECORDS_SYNC_INTERVAL_MS * 2 ** (failures - 1), RETRY_MAX_MS);
      await this.prisma.officialRecordSyncState.updateMany({
        where: { id: 1, leaseOwner: owner },
        data: {
          lastError: message,
          failureCount: failures,
          nextAttemptAt: new Date(now.getTime() + delay),
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      throw error;
    }
  }

  /** Выполняет плановый запуск без наложения и пишет сбой в лог, сохраняя работу планировщика. */
  private async runScheduledSync(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.syncNow();
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Official records sync failed');
    } finally {
      this.running = false;
    }
  }
}
