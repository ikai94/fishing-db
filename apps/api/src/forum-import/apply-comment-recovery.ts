import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import {
  ForumLocalStore,
  readJsonFile,
  sha256Hex,
  writeFileAtomic,
  writeJsonAtomic,
} from './cache.js';
import {
  APPROVED_COMMENT_PLAN_SHA256,
  APPROVED_COMMENT_REPORT_SHA256,
  APPROVED_COMMENT_DATABASE_SHA256,
  COMMENT_WRITE_BATCH_SIZE,
  commitRecoveryBatchAndCheckpoint,
  readRecoveryRows,
  validateWriteBatch,
  verifyRecoveryIntegrity,
  type RecoveryWriteCandidate,
  type RecoveryWriteCheckpoint,
} from './comment-recovery-writer.js';
import type { RecoveryRow } from './comment-recovery.js';

const ROOT = join(new ForumLocalStore().rootPath, 'comment-recovery');
const DRY_RUN = join(ROOT, 'dry-run');
const WRITE_DIRECTORY = join(ROOT, 'write');
const CHECKPOINT_PATH = join(WRITE_DIRECTORY, 'checkpoint.json');
const BASELINE_PATH = join(WRITE_DIRECTORY, 'baseline.json');
const APPROVED_CASES_SHA256 = 'd26db5419469d04954952e6d604cbf82025a5761c664065b2aaad0a1bf7041df';
const APPROVED_ROWS = 6_191;
const APPROVED_POPULATION = 69_403;
const CORE_FIELDS = ['fishId', 'baitId', 'locationId', 'weightGrams', 'fishingMethod'];

/** Отчёт имеет собственный одобренный hash, поэтому его ссылки нельзя незаметно заменить. */
interface PinnedRecoveryReport {
  readyForWrite: boolean;
  planRows: number;
  planSha256: string;
  databaseSnapshotSha256: string;
  codeHashes: Array<{ path: string; sha256: string }>;
  sources: Array<{ files: Array<{ path: string; sha256: string }> }>;
}

/** Читает исходные байты без нормализации JSON/переводов строк и требует принятого SHA-256. */
async function pinnedFile(path: string, expected: string): Promise<string> {
  const source = await readFile(path, 'utf8');
  if (sha256Hex(source) !== expected) throw new Error(`Pinned artifact drift: ${path}`);
  return source;
}

/** Загружает ровно принятые 6,191 строки, включая доказательство исключения held/core cases. */
async function approvedPlan(): Promise<RecoveryWriteCandidate[]> {
  const report = JSON.parse(
    await pinnedFile(join(DRY_RUN, 'report.json'), APPROVED_COMMENT_REPORT_SHA256),
  ) as PinnedRecoveryReport;
  if (
    !report.readyForWrite ||
    report.planRows !== APPROVED_ROWS ||
    report.planSha256 !== APPROVED_COMMENT_PLAN_SHA256 ||
    report.databaseSnapshotSha256 !== APPROVED_COMMENT_DATABASE_SHA256
  )
    throw new Error('Approved report assumptions changed');
  const rawPlan = await pinnedFile(join(DRY_RUN, 'candidates.jsonl'), APPROVED_COMMENT_PLAN_SHA256);
  if (!rawPlan.endsWith('\n')) throw new Error('Approved plan is truncated');
  const plan = rawPlan
    .slice(0, -1)
    .split('\n')
    .map((line) => JSON.parse(line) as RecoveryWriteCandidate);
  if (
    plan.length !== APPROVED_ROWS ||
    new Set(plan.map((item) => item.id)).size !== plan.length ||
    new Set(plan.map((item) => item.importKey)).size !== plan.length
  )
    throw new Error('Approved candidate population drift');
  for (let index = 0; index < plan.length; index += COMMENT_WRITE_BATCH_SIZE)
    validateWriteBatch(plan.slice(index, index + COMMENT_WRITE_BATCH_SIZE));
  const cases = await pinnedFile(join(DRY_RUN, 'cases.jsonl'), APPROVED_CASES_SHA256);
  const held = new Set(
    cases
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: string; status: string; fields?: string[] })
      .filter(
        (item) =>
          item.status !== 'CURRENT_PARSER_DISAGREEMENT' ||
          item.fields?.some((field) => CORE_FIELDS.includes(field)),
      )
      .map((item) => item.id),
  );
  if (plan.some((item) => held.has(item.id)))
    throw new Error('Approved plan overlaps held/core-mismatch cases');
  for (const file of [...report.codeHashes, ...report.sources.flatMap((source) => source.files)])
    await pinnedFile(file.path, file.sha256);
  return plan;
}

/** Checkpoint не может сменить план, перескочить пакет или объявить незавершённые строки готовыми. */
export function validateRecoveryCheckpoint(
  checkpoint: RecoveryWriteCheckpoint,
  total: number,
): void {
  if (
    checkpoint.version !== 1 ||
    checkpoint.planSha256 !== APPROVED_COMMENT_PLAN_SHA256 ||
    checkpoint.reportSha256 !== APPROVED_COMMENT_REPORT_SHA256 ||
    checkpoint.databaseSnapshotSha256 !== APPROVED_COMMENT_DATABASE_SHA256
  )
    throw new Error('Recovery checkpoint hash drift');
  const counters = [
    checkpoint.nextIndex,
    checkpoint.committedBatches,
    checkpoint.updated,
    checkpoint.replayed,
  ];
  if (
    counters.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    checkpoint.nextIndex > total ||
    (checkpoint.nextIndex !== total && checkpoint.nextIndex % COMMENT_WRITE_BATCH_SIZE !== 0) ||
    checkpoint.committedBatches !== Math.ceil(checkpoint.nextIndex / COMMENT_WRITE_BATCH_SIZE) ||
    checkpoint.updated + checkpoint.replayed !== checkpoint.nextIndex
  )
    throw new Error('Recovery checkpoint position drift');
}

/** Воспроизводит начальное состояние по одобренному снимку, а не по изменившейся базе. */
async function readBaseline(): Promise<RecoveryRow[]> {
  const source = await pinnedFile(BASELINE_PATH, APPROVED_COMMENT_DATABASE_SHA256);
  const rows = JSON.parse(source) as RecoveryRow[];
  if (rows.length !== APPROVED_POPULATION) throw new Error('Recovery baseline population drift');
  return rows;
}

/** Создаёт первый checkpoint только после полной проверки исходного DB snapshot. */
async function initialCheckpoint(
  rows: RecoveryRow[],
  plan: RecoveryWriteCandidate[],
): Promise<RecoveryWriteCheckpoint> {
  const contents = JSON.stringify(rows);
  if (
    rows.length !== APPROVED_POPULATION ||
    sha256Hex(contents) !== APPROVED_COMMENT_DATABASE_SHA256
  )
    throw new Error('Before-first-write database snapshot drift; no updates performed');
  verifyRecoveryIntegrity(rows, rows, plan, false);
  const checkpoint: RecoveryWriteCheckpoint = {
    version: 1,
    planSha256: APPROVED_COMMENT_PLAN_SHA256,
    reportSha256: APPROVED_COMMENT_REPORT_SHA256,
    databaseSnapshotSha256: APPROVED_COMMENT_DATABASE_SHA256,
    nextIndex: 0,
    committedBatches: 0,
    updated: 0,
    replayed: 0,
  };
  // Снимок сохраняется раньше checkpoint; никакой DML до обоих атомарных файлов нет.
  await writeFileAtomic(BASELINE_PATH, contents);
  await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
  return checkpoint;
}

/** Отпечаток всех historical полей кроме единственного разрешённого значения комментария. */
function nonCommentHash(rows: readonly RecoveryRow[]): string {
  return sha256Hex(
    JSON.stringify(
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([field]) => field !== 'userNoteRaw')),
      ),
    ),
  );
}

/** Пишет hash-pinned план под OS flock, сохраняя checkpoint только после COMMIT. */
async function executeRecovery(checkOnly: boolean): Promise<void> {
  const plan = await approvedPlan();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const before = await readRecoveryRows(prisma);
    let checkpoint = await readJsonFile<RecoveryWriteCheckpoint>(CHECKPOINT_PATH);
    if (checkOnly && checkpoint === null) {
      if (
        before.length !== APPROVED_POPULATION ||
        sha256Hex(JSON.stringify(before)) !== APPROVED_COMMENT_DATABASE_SHA256
      )
        throw new Error('Before-first-write database snapshot drift');
      verifyRecoveryIntegrity(before, before, plan, false);
      console.info(
        JSON.stringify({
          mode: 'PRE_WRITE_CHECK',
          rowsPlanned: plan.length,
          databaseSnapshotMatches: true,
          candidatePlanMatches: true,
          heldCasesExcluded: true,
          updates: 0,
        }),
      );
      return;
    }
    if (checkpoint === null) checkpoint = await initialCheckpoint(before, plan);
    validateRecoveryCheckpoint(checkpoint, plan.length);
    const baseline = await readBaseline();
    const beforeIntegrity = verifyRecoveryIntegrity(baseline, before, plan, false);
    const beforeById = new Map(before.map((row) => [row.id, row]));
    if (
      plan
        .slice(0, checkpoint.nextIndex)
        .some((item) => beforeById.get(item.id)?.userNoteRaw !== item.userNoteRaw)
    )
      throw new Error('Committed checkpoint no longer matches database');
    if (checkOnly) {
      console.info(
        JSON.stringify({
          mode: 'RESUME_CHECK',
          rowsPlanned: plan.length,
          checkpoint,
          integrity: beforeIntegrity,
          updates: 0,
        }),
      );
      return;
    }
    let updated = 0;
    while (checkpoint.nextIndex < plan.length && !stopRequested) {
      // Даже внешняя замена локального плана/checkpoint между пакетами немедленно запрещает DML.
      await pinnedFile(join(DRY_RUN, 'candidates.jsonl'), APPROVED_COMMENT_PLAN_SHA256);
      await pinnedFile(join(DRY_RUN, 'report.json'), APPROVED_COMMENT_REPORT_SHA256);
      const persistedCheckpoint = await readJsonFile<RecoveryWriteCheckpoint>(CHECKPOINT_PATH);
      if (JSON.stringify(persistedCheckpoint) !== JSON.stringify(checkpoint))
        throw new Error('Recovery checkpoint changed between batches');
      const batch = plan.slice(
        checkpoint.nextIndex,
        checkpoint.nextIndex + COMMENT_WRITE_BATCH_SIZE,
      );
      const result = await commitRecoveryBatchAndCheckpoint(prisma, batch, checkpoint, (next) =>
        writeJsonAtomic(CHECKPOINT_PATH, next),
      );
      updated += result.updated;
      checkpoint = result.checkpoint;
      if (checkpoint.committedBatches % 10 === 0 || checkpoint.nextIndex === plan.length)
        console.info(
          `Committed ${checkpoint.nextIndex}/${plan.length} rows in ${checkpoint.committedBatches} batches`,
        );
    }
    const after = await readRecoveryRows(prisma);
    const complete = checkpoint.nextIndex === plan.length;
    const integrity = verifyRecoveryIntegrity(baseline, after, plan, complete);
    const nonUserNoteRawUnchanged = nonCommentHash(baseline) === nonCommentHash(after);
    if (!nonUserNoteRawUnchanged) throw new Error('Non-userNoteRaw projection changed');
    const summary = {
      mode: 'APPLY',
      planSha256: APPROVED_COMMENT_PLAN_SHA256,
      reportSha256: APPROVED_COMMENT_REPORT_SHA256,
      rowsPlanned: plan.length,
      rowsUpdated: updated,
      rowsSkipped: integrity.commentsChanged - updated,
      rowsRemaining: integrity.remaining,
      checkpoint,
      integrity,
      nonUserNoteRawUnchanged,
      beforeSnapshotSha256: sha256Hex(JSON.stringify(before)),
      afterSnapshotSha256: sha256Hex(JSON.stringify(after)),
      baselineSnapshotSha256: sha256Hex(JSON.stringify(baseline)),
      nonUserNoteRawSha256: nonCommentHash(after),
      ready: complete,
    };
    await writeJsonAtomic(join(WRITE_DIRECTORY, 'runs', `${randomUUID()}.json`), summary);
    await writeJsonAtomic(join(WRITE_DIRECTORY, 'last-run.json'), summary);
    console.info(JSON.stringify(summary, null, 2));
    if (!complete) process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await prisma.$disconnect();
  }
}

/** flock освобождается ядром даже после аварийного выхода; stale lock-файл не мешает restart. */
async function runWithFileLock(): Promise<void> {
  await mkdir(WRITE_DIRECTORY, { recursive: true, mode: 0o700 });
  const child = spawn(
    'flock',
    [
      '--nonblock',
      '--no-fork',
      join(WRITE_DIRECTORY, 'writer.lock'),
      process.execPath,
      '--import',
      'tsx',
      fileURLToPath(import.meta.url),
      '--locked-worker',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, FORUM_COMMENT_RECOVERY_LOCK_PARENT: String(process.pid) },
    },
  );
  const stop = () => {
    child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => {
        process.exitCode = code ?? 1;
        resolve();
      });
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const args = process.argv.slice(2);
  const run =
    args.length === 0
      ? runWithFileLock
      : args.length === 1 && args[0] === '--check'
        ? () => executeRecovery(true)
        : args.length === 1 &&
            args[0] === '--locked-worker' &&
            process.env.FORUM_COMMENT_RECOVERY_LOCK_PARENT === String(process.ppid)
          ? () => executeRecovery(false)
          : () =>
              Promise.reject(new Error('Only --check is supported; plan/output paths are fixed'));
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Forum comment recovery failed');
    process.exitCode = 1;
  });
}
