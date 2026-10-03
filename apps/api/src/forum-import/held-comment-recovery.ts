import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from '../catch-reports/catch-report-raw-note.js';
import { isHistoricalForumKey, type RecoveryRow } from './comment-recovery.js';
import { recoveryRowHash } from './comment-recovery-writer.js';

/** Только отдельно одобренный SAFE-план; прежний writer и его ограничения не меняются. */
export const HELD_MANIFEST_SHA256 =
  '08a88182c106ca7f237aa077c9e609922d739a59069af2c26961b494cf2c423a';
export const HELD_BATCH_SIZE = 100;

/** Точная source identity и UTF-16 offsets из замороженного анализа, без нового parsing. */
export interface HeldCommentCandidate {
  id: string;
  importKey: string;
  userNoteRaw: string;
  baselineSha256: string;
  source: {
    forum: 'forum69' | 'forum83';
    topicId: string;
    postId: string;
    candidateOrdinal: number;
    bodySha256: string;
    sourceTextSha256: string;
    sourceLineSha256: string;
    startOffset: number;
    endOffset: number;
    baitStart: number;
    baitEnd: number;
    commentStart: number;
    commentEnd: number;
  };
}

/** PostgreSQL hash дополняет прежнюю проекцию всеми колонками, включая будущие поля. */
export interface HeldCommentRow extends RecoveryRow {
  nonCommentSha256: string;
}

/** Full-row precondition закрепляется отдельным снимком непосредственно перед первой записью. */
export interface HeldWriteCandidate extends HeldCommentCandidate {
  nonCommentSha256: string;
}

/** Checkpoint обозначает только подтверждённые COMMIT и связан с неизменным baseline. */
export interface HeldCheckpoint {
  manifestSha256: string;
  baselineSha256: string;
  nextIndex: number;
  updated: number;
  replayed: number;
  committedBatches: number;
}

/** Читает все строки для integrity либо небольшой пакет с блокировками в порядке id. */
export async function readHeldCommentRows(
  tx: Prisma.TransactionClient,
  ids?: readonly string[],
  lock = false,
): Promise<HeldCommentRow[]> {
  if (lock && (ids === undefined || ids.length > HELD_BATCH_SIZE))
    throw new Error('Unbounded held-comment lock forbidden');
  if (ids?.length === 0) return [];
  await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
  return tx.$queryRaw<HeldCommentRow[]>(Prisma.sql`
    SELECT report.*,
      encode(sha256(convert_to((to_jsonb(report) - 'userNoteRaw')::text, 'UTF8')), 'hex')
        AS "nonCommentSha256"
    FROM "CatchReport" AS report
    ${ids === undefined ? Prisma.empty : Prisma.sql`WHERE report."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`}
    ORDER BY report."id" ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
}

/** Проверяет форму малого пакета до SELECT/DML; содержание source уже закреплено manifest hash. */
export function validateHeldBatch(batch: readonly HeldWriteCandidate[]): void {
  if (
    batch.length < 1 ||
    batch.length > HELD_BATCH_SIZE ||
    new Set(batch.map((item) => item.id)).size !== batch.length ||
    new Set(batch.map((item) => item.importKey)).size !== batch.length
  )
    throw new Error('Invalid held-comment batch');
  for (const item of batch) {
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(item.id) ||
      !isHistoricalForumKey(item.importKey) ||
      !/^[0-9a-f]{64}$/u.test(item.baselineSha256) ||
      !/^[0-9a-f]{64}$/u.test(item.nonCommentSha256) ||
      !item.userNoteRaw ||
      !USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(item.userNoteRaw) ||
      !VALID_USER_NOTE_RAW_PATTERN.test(item.userNoteRaw)
    )
      throw new Error('Invalid held-comment candidate');
  }
}

/** NULL допускает UPDATE; лишь точный прежний результат допускает replay без любого DML. */
export function verifyHeldRow(
  row: HeldCommentRow | undefined,
  item: HeldWriteCandidate,
): 'UPDATE' | 'REPLAY' {
  if (
    row === undefined ||
    row.id !== item.id ||
    row.importKey !== item.importKey ||
    row.rawSourceText !== null ||
    row.nonCommentSha256 !== item.nonCommentSha256 ||
    recoveryRowHash({ ...row, userNoteRaw: null }) !== item.baselineSha256 ||
    (row.userNoteRaw !== null && row.userNoteRaw !== item.userNoteRaw)
  )
    throw new Error(`Held-comment precondition drift: ${item.id}`);
  return row.userNoteRaw === null ? 'UPDATE' : 'REPLAY';
}

/**
 * Проверяет весь пакет до DML и после него; любой drift откатывает транзакцию целиком.
 * SQL меняет только userNoteRaw и обходит Prisma @updatedAt; остальные поля сохраняются.
 */
export async function writeHeldCommentBatch(
  prisma: PrismaClient,
  batch: readonly HeldWriteCandidate[],
): Promise<{ updated: number; skipped: number }> {
  validateHeldBatch(batch);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const ids = batch.map((item) => item.id);
      const before = new Map((await readHeldCommentRows(tx, ids, true)).map((r) => [r.id, r]));
      const pending = batch.filter((item) => verifyHeldRow(before.get(item.id), item) === 'UPDATE');
      if (pending.length > 0) {
        const values = Prisma.join(
          pending.map(
            (item) => Prisma.sql`(${item.id}::uuid, ${item.importKey}::text,
              ${item.userNoteRaw}::text, ${item.nonCommentSha256}::text)`,
          ),
        );
        const changed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "CatchReport" AS report SET "userNoteRaw" = planned.note
          FROM (VALUES ${values}) AS planned(id, import_key, note, row_hash)
          WHERE report."id" = planned.id AND report."importKey" = planned.import_key
            AND report."userNoteRaw" IS NULL AND report."rawSourceText" IS NULL
            AND encode(sha256(convert_to((to_jsonb(report) - 'userNoteRaw')::text, 'UTF8')), 'hex')
              = planned.row_hash
          RETURNING report."id"
        `);
        const expected = new Set(pending.map((item) => item.id));
        if (
          changed.length !== expected.size ||
          new Set(changed.map((r) => r.id)).size !== expected.size ||
          changed.some((r) => !expected.has(r.id))
        )
          throw new Error('Held-comment affected-row drift');
      }
      const after = new Map((await readHeldCommentRows(tx, ids)).map((r) => [r.id, r]));
      for (const item of batch)
        if (verifyHeldRow(after.get(item.id), item) !== 'REPLAY')
          throw new Error('Held-comment post-write drift');
      return { updated: pending.length, skipped: batch.length - pending.length };
    },
    { maxWait: 2_000, timeout: 10_000 },
  );
}

/** Сохранение checkpoint происходит строго после успешного COMMIT; сбой допускает replay. */
export async function commitHeldBatchAndCheckpoint(
  prisma: PrismaClient,
  batch: readonly HeldWriteCandidate[],
  checkpoint: HeldCheckpoint,
  save: (next: HeldCheckpoint) => Promise<void>,
) {
  const result = await writeHeldCommentBatch(prisma, batch);
  const next = {
    ...checkpoint,
    nextIndex: checkpoint.nextIndex + batch.length,
    updated: checkpoint.updated + result.updated,
    replayed: checkpoint.replayed + result.skipped,
    committedBatches: checkpoint.committedBatches + 1,
  };
  await save(next);
  return { ...result, checkpoint: next };
}
