import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { sha256Hex } from './cache.js';
import {
  COMMENT_RECOVERY_PREFIXES,
  isHistoricalForumKey,
  type RecoveryRow,
} from './comment-recovery.js';
import {
  VALID_USER_NOTE_RAW_PATTERN,
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
} from '../catch-reports/catch-report-raw-note.js';

/** Одобренный план не пересчитывается: новый parser не может расширить область записи. */
export const APPROVED_COMMENT_PLAN_SHA256 =
  'dec6addb917a9d7e4aca4cb2bfc276d3e37e0df63f9ad18cf2aa4798edcf14b8';
export const APPROVED_COMMENT_REPORT_SHA256 =
  '0fbce6f96ad01be7edc07442627e7e6b48e95753f0ad0189c7bc0585754ad55c';
export const APPROVED_COMMENT_DATABASE_SHA256 =
  '8d7073e8b6a83d606ac6bf5cc9109234637920e28d1b58acd4243f425eaa931a';
export const COMMENT_WRITE_BATCH_SIZE = 100;

/** Единственное записываемое значение и прежний отпечаток строки. */
export interface RecoveryWriteCandidate {
  id: string;
  importKey: string;
  userNoteRaw: string;
  baselineSha256: string;
  parserDisagreements: string[];
}

/** Checkpoint отражает только завершённые транзакции, а не намерение записать пакет. */
export interface RecoveryWriteCheckpoint {
  version: 1;
  planSha256: string;
  reportSha256: string;
  databaseSnapshotSha256: string;
  nextIndex: number;
  committedBatches: number;
  updated: number;
  replayed: number;
}

/** Порядок колонок повторяет dry-run; Prisma @updatedAt обходится только при DML ниже. */
const ROW_COLUMNS = Prisma.sql`
  "id", "userId", "contributorKey", "importKey", "fishId", "baitId", "locationId",
  "weightGrams", "fishingMethod", "holeDepthCm", "spotPositionRaw", "fishingNote",
  "spinningSize", "spinningSpeed", "userNoteRaw", "rawSourceText", "createdAt", "updatedAt"
`;

/** Канонический порядок ключей сохраняет совместимость с отпечатками принятого dry-run. */
export function canonicalRecoveryRow(row: RecoveryRow): RecoveryRow {
  return {
    id: row.id,
    userId: row.userId,
    contributorKey: row.contributorKey,
    importKey: row.importKey,
    fishId: row.fishId,
    baitId: row.baitId,
    locationId: row.locationId,
    weightGrams: row.weightGrams,
    fishingMethod: row.fishingMethod,
    holeDepthCm: row.holeDepthCm,
    spotPositionRaw: row.spotPositionRaw,
    fishingNote: row.fishingNote,
    spinningSize: row.spinningSize,
    spinningSpeed: row.spinningSpeed,
    userNoteRaw: row.userNoteRaw,
    rawSourceText: row.rawSourceText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Отпечаток включает ownership, timestamps, raw source и каждое доменное поле. */
export function recoveryRowHash(row: RecoveryRow): string {
  return sha256Hex(JSON.stringify(canonicalRecoveryRow(row)));
}

/** Читает весь исторический target в одном коротком согласованном read-only снимке. */
export async function readRecoveryRows(prisma: PrismaClient): Promise<RecoveryRow[]> {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await transaction.$queryRaw<RecoveryRow[]>(Prisma.sql`
      SELECT ${ROW_COLUMNS} FROM "CatchReport"
      WHERE ${Prisma.join(
        COMMENT_RECOVERY_PREFIXES.map((prefix) => Prisma.sql`"importKey" LIKE ${`${prefix}%`}`),
        ' OR ',
      )}
      ORDER BY "id"
    `);
      if (rows.some((row) => !isHistoricalForumKey(row.importKey)))
        throw new Error('Unexpected historical key');
      return rows.map(canonicalRecoveryRow);
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  );
}

/** Не допускает невалидный текст и дубли id/key даже в отдельно тестируемом batch-ядре. */
export function validateWriteBatch(batch: readonly RecoveryWriteCandidate[]): void {
  if (batch.length < 1 || batch.length > COMMENT_WRITE_BATCH_SIZE)
    throw new Error('Invalid recovery batch size');
  if (
    new Set(batch.map((item) => item.id)).size !== batch.length ||
    new Set(batch.map((item) => item.importKey)).size !== batch.length
  )
    throw new Error('Duplicate recovery candidate');
  for (const item of batch) {
    if (
      !isHistoricalForumKey(item.importKey) ||
      !/^[0-9a-f]{64}$/u.test(item.baselineSha256) ||
      !item.userNoteRaw ||
      !VALID_USER_NOTE_RAW_PATTERN.test(item.userNoteRaw) ||
      !USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(item.userNoteRaw)
    )
      throw new Error('Invalid recovery candidate');
    if (
      item.parserDisagreements.some(
        (field) =>
          ![
            'holeDepthCm',
            'spotPositionRaw',
            'fishingNote',
            'spinningSize',
            'spinningSpeed',
          ].includes(field),
      )
    )
      throw new Error('Held/core-mismatch candidate is forbidden');
  }
}

/** Проверяет locked-row baseline; совпавший комментарий разрешает только безопасный replay. */
export function verifyLockedRecoveryRow(
  row: RecoveryRow | undefined,
  candidate: RecoveryWriteCandidate,
): 'UPDATE' | 'REPLAY' {
  if (
    row === undefined ||
    row.id !== candidate.id ||
    row.importKey !== candidate.importKey ||
    row.rawSourceText !== null
  )
    throw new Error(`Recovery row precondition drift: ${candidate.id}`);
  if (row.userNoteRaw !== null && row.userNoteRaw !== candidate.userNoteRaw)
    throw new Error(`Existing non-null comment preserved; precondition drift: ${candidate.id}`);
  if (recoveryRowHash({ ...row, userNoteRaw: null }) !== candidate.baselineSha256)
    throw new Error(`Recovery baseline drift: ${candidate.id}`);
  return row.userNoteRaw === null ? 'UPDATE' : 'REPLAY';
}

/**
 * Один пакет атомарно проверяет все строки до DML и повторно проверяет результат до COMMIT.
 * SET содержит только userNoteRaw: updatedAt и остальные поля не попадают в запись.
 */
export async function writeRecoveryBatch(
  prisma: PrismaClient,
  batch: readonly RecoveryWriteCandidate[],
): Promise<{ updated: number; skipped: number }> {
  validateWriteBatch(batch);
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await transaction.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const ids = Prisma.join(batch.map((item) => Prisma.sql`${item.id}::uuid`));
      const rows = await transaction.$queryRaw<RecoveryRow[]>(Prisma.sql`
      SELECT ${ROW_COLUMNS} FROM "CatchReport" WHERE "id" IN (${ids}) ORDER BY "id" FOR UPDATE
    `);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const pending = batch.filter(
        (item) => verifyLockedRecoveryRow(byId.get(item.id), item) === 'UPDATE',
      );
      if (pending.length > 0) {
        const values = Prisma.join(
          pending.map(
            (item) =>
              Prisma.sql`(${item.id}::uuid, ${item.importKey}::text, ${item.userNoteRaw}::text)`,
          ),
        );
        const changed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "CatchReport" AS report SET "userNoteRaw" = planned.note
        FROM (VALUES ${values}) AS planned(id, import_key, note)
        WHERE report."id" = planned.id AND report."importKey" = planned.import_key
          AND report."userNoteRaw" IS NULL AND report."rawSourceText" IS NULL
        RETURNING report."id"
      `);
        if (
          changed.length !== pending.length ||
          new Set(changed.map((row) => row.id)).size !== pending.length ||
          changed.some((row) => !pending.some((item) => item.id === row.id))
        )
          throw new Error('Recovery affected-row mismatch');
      }
      const after = await transaction.$queryRaw<RecoveryRow[]>(Prisma.sql`
      SELECT ${ROW_COLUMNS} FROM "CatchReport" WHERE "id" IN (${ids}) ORDER BY "id"
    `);
      const afterById = new Map(after.map((row) => [row.id, row]));
      for (const item of batch) {
        if (verifyLockedRecoveryRow(afterById.get(item.id), item) !== 'REPLAY')
          throw new Error('Recovery post-update verification failed');
      }
      return { updated: pending.length, skipped: batch.length - pending.length };
    },
    { maxWait: 2_000, timeout: 10_000 },
  );
}

/** Сначала COMMIT, затем сохранение checkpoint; ошибка файла допускает replay того же пакета. */
export async function commitRecoveryBatchAndCheckpoint(
  prisma: PrismaClient,
  batch: readonly RecoveryWriteCandidate[],
  checkpoint: RecoveryWriteCheckpoint,
  save: (next: RecoveryWriteCheckpoint) => Promise<void>,
): Promise<{ checkpoint: RecoveryWriteCheckpoint; updated: number; skipped: number }> {
  const result = await writeRecoveryBatch(prisma, batch);
  const next = {
    ...checkpoint,
    nextIndex: checkpoint.nextIndex + batch.length,
    committedBatches: checkpoint.committedBatches + 1,
    updated: checkpoint.updated + result.updated,
    replayed: checkpoint.replayed + result.skipped,
  };
  await save(next);
  return { ...result, checkpoint: next };
}

/**
 * Разрешает только уже одобренные комментарии поверх исходного снимка.
 * Все held/out-of-plan строки, существовавшие комментарии и non-userNoteRaw поля должны совпасть.
 */
export function verifyRecoveryIntegrity(
  baseline: readonly RecoveryRow[],
  current: readonly RecoveryRow[],
  plan: readonly RecoveryWriteCandidate[],
  complete: boolean,
) {
  if (current.length !== baseline.length) throw new Error('Recovery population drift');
  const beforeById = new Map(baseline.map((row) => [row.id, row]));
  const planById = new Map(plan.map((item) => [item.id, item]));
  let commentsChanged = 0;
  let existingCommentsPreserved = 0;
  let remaining = 0;
  for (const row of current) {
    const before = beforeById.get(row.id);
    if (before === undefined) throw new Error('Recovery population identity drift');
    const candidate = planById.get(row.id);
    if (candidate !== undefined) {
      if (before.userNoteRaw !== null || recoveryRowHash(before) !== candidate.baselineSha256)
        throw new Error('Candidate does not match original baseline');
      verifyLockedRecoveryRow(row, candidate);
      if (row.userNoteRaw === null) remaining += 1;
      else commentsChanged += 1;
    } else if (recoveryRowHash(row) !== recoveryRowHash(before)) {
      throw new Error(`Held/out-of-plan row changed: ${row.id}`);
    }
    if (before.userNoteRaw !== null) existingCommentsPreserved += 1;
  }
  if (complete && (remaining !== 0 || commentsChanged !== plan.length))
    throw new Error('Recovery incomplete');
  return {
    commentsChanged,
    remaining,
    existingCommentsPreserved,
    existingCommentsOverwritten: 0,
    heldOrOutsidePlanRowsChanged: 0,
    nonUserNoteRawFieldsChanged: 0,
  };
}
