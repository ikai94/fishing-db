import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import {
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from '../catch-reports/catch-report-raw-note.js';
import { COMMENT_RECOVERY_PREFIXES, type RecoveryRow } from './comment-recovery.js';

/** Замороженная пара id → комментарий; оба hash запрещают изменение исходника и истории. */
export interface RawCommentCandidate {
  id: string;
  rawSourceTextSha256: string;
  userNoteRaw: string;
  nonCommentSha256: string;
}

/** PostgreSQL вычисляет полный отпечаток строки, исключая только разрешённый комментарий. */
export interface RawCommentRow extends RecoveryRow {
  rawSourceTextSha256: string | null;
  nonCommentSha256: string;
}

/** Размер пакета ограничивает время удержания блокировок и совпадает с forum recovery. */
export const RAW_COMMENT_BATCH_SIZE = 100;

/**
 * Читает полный row и hash всех колонок, включая будущие поля и оба timestamps.
 * Без ids используется прежний широкий prefilter: комментарий требует точки после игровой
 * связки и непустого хвоста. Точки внутри Location допускаются; parser убирает ложные совпадения.
 * UTC фиксирует представление timestamptz в JSON между независимыми соединениями.
 */
export async function readRawCommentRows(
  transaction: Prisma.TransactionClient,
  ids?: readonly string[],
  lock = false,
): Promise<RawCommentRow[]> {
  if (ids?.length === 0) return [];
  if (lock && ids === undefined) throw new Error('Unbounded recovery lock forbidden');
  await transaction.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
  const where =
    ids === undefined
      ? Prisma.sql`report."rawSourceText" IS NOT NULL
          AND report."rawSourceText" ~* 'пойман[аоы]?[[:space:]]+на[[:space:]]+.*\\.[[:space:]]*[^[:space:]]'`
      : Prisma.sql`report."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`;
  return transaction.$queryRaw<RawCommentRow[]>(Prisma.sql`
    SELECT report.*,
      encode(sha256(convert_to(report."rawSourceText", 'UTF8')), 'hex') AS "rawSourceTextSha256",
      encode(sha256(convert_to((to_jsonb(report) - 'userNoteRaw')::text, 'UTF8')), 'hex')
        AS "nonCommentSha256"
    FROM "CatchReport" AS report WHERE ${where} ORDER BY report."id"
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}
  `);
}

/** Невалидный план и повторные ids не должны достигать даже SELECT FOR UPDATE. */
export function validateRawCommentBatch(batch: readonly RawCommentCandidate[]): void {
  if (
    batch.length < 1 ||
    batch.length > RAW_COMMENT_BATCH_SIZE ||
    new Set(batch.map((item) => item.id)).size !== batch.length
  )
    throw new Error('Invalid raw-comment recovery batch');
  for (const item of batch) {
    if (
      !/^[0-9a-f-]{36}$/u.test(item.id) ||
      !/^[0-9a-f]{64}$/u.test(item.rawSourceTextSha256) ||
      !/^[0-9a-f]{64}$/u.test(item.nonCommentSha256) ||
      !item.userNoteRaw ||
      !VALID_USER_NOTE_RAW_PATTERN.test(item.userNoteRaw) ||
      !USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(item.userNoteRaw)
    )
      throw new Error('Invalid frozen raw-comment candidate');
  }
}

/**
 * Только исходная NULL-строка либо точный результат прежнего COMMIT допускает продолжение.
 * Любое изменение raw source, истории, ownership, timestamps или чужой комментарий — drift.
 * Два форумных пространства запрещены независимо от наличия raw source.
 */
export function verifyRawCommentRow(
  row: RawCommentRow | undefined,
  candidate: RawCommentCandidate,
): 'UPDATE' | 'REPLAY' {
  if (
    row === undefined ||
    row.id !== candidate.id ||
    row.rawSourceText === null ||
    COMMENT_RECOVERY_PREFIXES.some((prefix) => row.importKey?.startsWith(prefix)) ||
    row.rawSourceTextSha256 !== candidate.rawSourceTextSha256 ||
    row.nonCommentSha256 !== candidate.nonCommentSha256 ||
    (row.userNoteRaw !== null && row.userNoteRaw !== candidate.userNoteRaw)
  )
    throw new Error(`Raw-comment recovery precondition drift: ${candidate.id}`);
  return row.userNoteRaw === null ? 'UPDATE' : 'REPLAY';
}

/**
 * Пакет проверяется целиком до DML и после него; drift откатывает всю транзакцию.
 * Raw SQL обходит Prisma @updatedAt: SET изменяет только userNoteRaw, без событий приложения.
 */
export async function writeRawCommentBatch(
  prisma: PrismaClient,
  batch: readonly RawCommentCandidate[],
): Promise<{ updated: number; skipped: number }> {
  validateRawCommentBatch(batch);
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await transaction.$executeRaw`SET LOCAL statement_timeout = '5s'`;
      const ids = batch.map((item) => item.id);
      const rows = await readRawCommentRows(transaction, ids, true);
      const byId = new Map(rows.map((row) => [row.id, row]));
      const pending = batch.filter(
        (item) => verifyRawCommentRow(byId.get(item.id), item) === 'UPDATE',
      );
      if (pending.length > 0) {
        const values = Prisma.join(
          pending.map(
            (item) =>
              Prisma.sql`(${item.id}::uuid, ${item.rawSourceTextSha256}::text,
                ${item.userNoteRaw}::text, ${item.nonCommentSha256}::text)`,
          ),
        );
        const changed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE "CatchReport" AS report SET "userNoteRaw" = planned.note
          FROM (VALUES ${values}) AS planned(id, source_hash, note, row_hash)
          WHERE report."id" = planned.id AND report."userNoteRaw" IS NULL
            AND report."rawSourceText" IS NOT NULL
            AND encode(sha256(convert_to(report."rawSourceText", 'UTF8')), 'hex') = planned.source_hash
            AND encode(sha256(convert_to((to_jsonb(report) - 'userNoteRaw')::text, 'UTF8')), 'hex')
              = planned.row_hash
          RETURNING report."id"
        `);
        const expected = new Set(pending.map((item) => item.id));
        if (
          changed.length !== expected.size ||
          new Set(changed.map((row) => row.id)).size !== expected.size ||
          changed.some((row) => !expected.has(row.id))
        )
          throw new Error('Raw-comment recovery affected-row drift');
      }
      const after = await readRawCommentRows(transaction, ids);
      const afterById = new Map(after.map((row) => [row.id, row]));
      for (const item of batch) {
        if (verifyRawCommentRow(afterById.get(item.id), item) !== 'REPLAY')
          throw new Error('Raw-comment recovery post-write drift');
      }
      return { updated: pending.length, skipped: batch.length - pending.length };
    },
    { maxWait: 2_000, timeout: 10_000 },
  );
}
