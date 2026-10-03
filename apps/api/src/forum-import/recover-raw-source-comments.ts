import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { loadCatalogSnapshot } from './catalog-source.js';
import { COMMENT_RECOVERY_PREFIXES, snapshotCommentParser } from './comment-recovery.js';
import { readRecoveryRows } from './comment-recovery-writer.js';
import { readJsonFile, sha256Hex, writeFileAtomic, writeJsonAtomic } from './cache.js';
import {
  RAW_COMMENT_BATCH_SIZE,
  readRawCommentRows,
  validateRawCommentBatch,
  verifyRawCommentRow,
  writeRawCommentBatch,
  type RawCommentCandidate,
  type RawCommentRow,
} from './raw-source-comment-recovery.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIRECTORY = join(API_ROOT, '.local/raw-source-comment-recovery/frozen');
const MANIFEST_PATH = join(DIRECTORY, 'manifest.json');
const BASELINE_PATH = join(DIRECTORY, 'baseline.json');
const CHECKPOINT_PATH = join(DIRECTORY, 'checkpoint.json');
const EXPECTED_CANDIDATES = 792;
const EXPECTED_FORUM_POPULATION = 69_403;
const SELECTION =
  'raw-source-suffix-v1; current-parser-resolved-nonempty-comment; null-only; no-core-field-rewrite';

/** Время запуска не входит в manifest: независимые снимки должны дать одинаковые байты. */
interface Manifest {
  version: 1;
  selection: string;
  inputs: Awaited<ReturnType<typeof currentInputs>>;
  baselineSha256: string;
  candidates: RawCommentCandidate[];
}

/** Baseline охватывает также ложные prefilter-совпадения и защищённые внешние популяции. */
interface Baseline {
  guards: Array<{ id: string; nonCommentSha256: string; userNoteRaw: string | null }>;
  protected: Awaited<ReturnType<typeof protectedState>>;
}

/** Checkpoint продвигается лишь после COMMIT; прежний пакет допускает безопасный replay. */
interface Checkpoint {
  manifestSha256: string;
  nextIndex: number;
  updated: number;
  replayed: number;
}

/** Канонический JSON не содержит временных меток; bigint counters сохраняются точными строками. */
function serialized(value: unknown): string {
  return `${JSON.stringify(value, (_key: string, field: unknown) => (typeof field === 'bigint' ? field.toString() : field), 2)}\n`;
}

/** Hash включает текущий parser, его словари/типы и recovery-код; generated client закреплён schema/lockfile. */
async function codeInputs() {
  const parserDirectory = join(API_ROOT, 'src/catch-reports/parser');
  const files = [
    ...(await readdir(parserDirectory))
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
      .map((name) => `src/catch-reports/parser/${name}`),
    'src/catch-reports/catch-report-raw-note.ts',
    'src/catch-reports/catch-reports.constants.ts',
    'src/catch-reports/catch-reports.errors.ts',
    'src/catalog/catalog-lookup.ts',
    'src/catalog/catalog-normalization.ts',
    'src/catalog/catalog.constants.ts',
    'src/prisma/prisma-adapter.ts',
    'src/prisma/prisma.service.ts',
    'src/forum-import/comment-recovery.ts',
    'src/forum-import/comment-recovery-writer.ts',
    'src/forum-import/catalog-source.ts',
    'src/forum-import/cache.ts',
    'src/forum-import/raw-source-comment-recovery.ts',
    'src/forum-import/recover-raw-source-comments.ts',
    'prisma/schema.prisma',
    '../../pnpm-lock.yaml',
  ].sort();
  return Promise.all(
    files.map(async (path) => ({ path, sha256: sha256Hex(await readFile(join(API_ROOT, path))) })),
  );
}

/** Словари и anchors читаются в одном read-only snapshot; сортировка делает hash устойчивым. */
async function currentInputs(prisma: PrismaClient) {
  const code = await codeInputs();
  const catalog = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const data = await loadCatalogSnapshot(tx);
      const anchors = await tx.screenAnchor.findMany({
        where: { isActive: true },
        select: { name: true, nameNormalized: true },
        orderBy: [{ nameNormalized: 'asc' }, { name: 'asc' }],
      });
      return { fingerprint: data.fingerprint, anchorsSha256: sha256Hex(JSON.stringify(anchors)) };
    },
    { isolationLevel: 'RepeatableRead', timeout: 30_000 },
  );
  return { code, ...catalog, nodeVersion: process.version };
}

/** Форумные/held записи защищены полным hash популяции, а fish counters и activity — отдельными hash. */
async function protectedState(prisma: PrismaClient) {
  const forum = await readRecoveryRows(prisma);
  if (forum.length !== EXPECTED_FORUM_POPULATION)
    throw new Error('Historical forum population drift');
  const fish = await prisma.fish.findMany({ orderBy: { id: 'asc' } });
  const activity = await prisma.activityEvent.aggregate({ _count: true, _max: { id: true } });
  const heldArtifact = await readFile(
    join(API_ROOT, '.local/forum-import/rus-fishsoft/comment-recovery/dry-run/cases.jsonl'),
  );
  return {
    forumCount: forum.length,
    forumSha256: sha256Hex(JSON.stringify(forum)),
    heldArtifactSha256: sha256Hex(heldArtifact),
    fishSha256: sha256Hex(serialized(fish)),
    activity: { count: activity._count, maxId: activity._max.id?.toString() ?? null },
  };
}

/** Независимый проход заново читает DB и запускает тот же current parser без прежнего плана. */
async function discover(prisma: PrismaClient): Promise<{ manifest: Manifest; baseline: Baseline }> {
  const codeBefore = await codeInputs();
  const snapshot = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await readRawCommentRows(tx);
      const catalog = await loadCatalogSnapshot(tx);
      const anchors = await tx.screenAnchor.findMany({
        where: { isActive: true },
        select: { name: true, nameNormalized: true },
        orderBy: [{ nameNormalized: 'asc' }, { name: 'asc' }],
      });
      return { rows, catalog, anchors };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120_000 },
  );
  const parser = snapshotCommentParser(snapshot.catalog, snapshot.anchors);
  const candidates: RawCommentCandidate[] = [];
  for (let index = 0; index < snapshot.rows.length; index += 1000) {
    const batch = snapshot.rows.slice(index, index + 1000);
    const drafts = batch.every((row) => !/[\r\n]/u.test(row.rawSourceText ?? ''))
      ? (await parser.parseBatch(batch.map((row) => row.rawSourceText).join('\n'))).rows.map(
          (row) => row.draft,
        )
      : await Promise.all(
          batch.map(async (row) => (await parser.parse(row.rawSourceText ?? '')).draft),
        );
    if (drafts.length !== batch.length) throw new Error('Parser source-row identity drift');
    for (const [offset, row] of batch.entries()) {
      const comment = drafts[offset].fields.userNoteRaw;
      if (comment.status !== 'RESOLVED') throw new Error(`Invalid parser comment: ${row.id}`);
      if (!comment.value) continue;
      if (row.userNoteRaw !== null) throw new Error(`Existing-comment conflict: ${row.id}`);
      if (COMMENT_RECOVERY_PREFIXES.some((prefix) => row.importKey?.startsWith(prefix)))
        throw new Error('Historical forum candidate forbidden');
      candidates.push({
        id: row.id,
        rawSourceTextSha256: row.rawSourceTextSha256 ?? '',
        userNoteRaw: comment.value,
        nonCommentSha256: row.nonCommentSha256,
      });
    }
  }
  if (candidates.length !== EXPECTED_CANDIDATES)
    throw new Error(`Candidate population drift: ${candidates.length}`);
  for (let index = 0; index < candidates.length; index += RAW_COMMENT_BATCH_SIZE)
    validateRawCommentBatch(candidates.slice(index, index + RAW_COMMENT_BATCH_SIZE));
  const inputs = await currentInputs(prisma);
  if (
    JSON.stringify(codeBefore) !== JSON.stringify(inputs.code) ||
    inputs.fingerprint !== snapshot.catalog.fingerprint ||
    inputs.anchorsSha256 !== sha256Hex(JSON.stringify(snapshot.anchors))
  )
    throw new Error('Parser inputs changed during discovery');
  const baseline: Baseline = {
    guards: guards(snapshot.rows),
    protected: await protectedState(prisma),
  };
  return {
    baseline,
    manifest: {
      version: 1,
      selection: SELECTION,
      inputs,
      baselineSha256: sha256Hex(serialized(baseline)),
      candidates,
    },
  };
}

/** Полный non-comment row hash и исходный комментарий нужны для проверки всех out-of-plan строк. */
function guards(rows: readonly RawCommentRow[]): Baseline['guards'] {
  return rows.map((row) => ({
    id: row.id,
    nonCommentSha256: row.nonCommentSha256,
    userNoteRaw: row.userNoteRaw,
  }));
}

/** Hash передаётся явно: замена manifest/baseline никогда не расширяет уже одобренный write. */
async function pinnedArtifacts(
  expected: string,
): Promise<{ manifest: Manifest; baseline: Baseline }> {
  if (!/^[0-9a-f]{64}$/u.test(expected)) throw new Error('Explicit manifest SHA-256 required');
  const source = await readFile(MANIFEST_PATH, 'utf8');
  if (sha256Hex(source) !== expected) throw new Error('Frozen manifest drift');
  const manifest = JSON.parse(source) as Manifest;
  const baselineSource = await readFile(BASELINE_PATH, 'utf8');
  if (sha256Hex(baselineSource) !== manifest.baselineSha256)
    throw new Error('Frozen baseline drift');
  if (
    manifest.version !== 1 ||
    manifest.selection !== SELECTION ||
    manifest.candidates.length !== EXPECTED_CANDIDATES ||
    new Set(manifest.candidates.map((item) => item.id)).size !== EXPECTED_CANDIDATES
  )
    throw new Error('Frozen candidate set drift');
  return { manifest, baseline: JSON.parse(baselineSource) as Baseline };
}

/** Сверяет всю исходную область и защищённые популяции; нормализация replay производится только в памяти. */
async function integrity(
  prisma: PrismaClient,
  manifest: Manifest,
  baseline: Baseline,
  complete: boolean,
) {
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return readRawCommentRows(tx);
    },
    { isolationLevel: 'RepeatableRead', timeout: 120_000 },
  );
  const planById = new Map(manifest.candidates.map((item) => [item.id, item]));
  let applied = 0;
  for (const row of rows) {
    const candidate = planById.get(row.id);
    if (candidate) {
      if (verifyRawCommentRow(row, candidate) === 'REPLAY') applied += 1;
      row.userNoteRaw = null;
    }
  }
  if (JSON.stringify(guards(rows)) !== JSON.stringify(baseline.guards))
    throw new Error('Population/out-of-plan/non-comment drift');
  if (JSON.stringify(await protectedState(prisma)) !== JSON.stringify(baseline.protected))
    throw new Error('Forum/held/fish/activity drift');
  if (complete && applied !== manifest.candidates.length) throw new Error('Incomplete recovery');
  return {
    applied,
    remaining: manifest.candidates.length - applied,
    nonUserNoteRawChanges: 0,
    forumRowsChanged: 0,
    heldRowsChanged: 0,
  };
}

/** Freeze/check не имеют DML; apply требует вторую независимую проверку и закреплённый hash. */
async function execute(mode: string, expected: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    if (mode === 'freeze') {
      if ((await readJsonFile(MANIFEST_PATH)) !== null)
        throw new Error('Manifest already frozen; refusing replacement');
      const { manifest, baseline } = await discover(prisma);
      await writeFileAtomic(BASELINE_PATH, serialized(baseline));
      await writeFileAtomic(MANIFEST_PATH, serialized(manifest));
      console.info(
        JSON.stringify({
          candidates: manifest.candidates.length,
          conflicts: 0,
          forumCandidates: 0,
          manifestSha256: sha256Hex(serialized(manifest)),
          examples: manifest.candidates.slice(0, 3).map((item) => item.userNoteRaw),
        }),
      );
      return;
    }
    const { manifest, baseline } = await pinnedArtifacts(expected);
    if (mode === 'check') {
      const second = await discover(prisma);
      if (sha256Hex(serialized(second.manifest)) !== expected)
        throw new Error('Independent manifest drift');
      await writeJsonAtomic(join(DIRECTORY, 'independent-pass.json'), {
        manifestSha256: expected,
        candidates: EXPECTED_CANDIDATES,
        conflicts: 0,
        forumCandidates: 0,
      });
      console.info(
        JSON.stringify({
          independentPassMatches: true,
          candidates: EXPECTED_CANDIDATES,
          manifestSha256: expected,
          conflicts: 0,
          forumCandidates: 0,
        }),
      );
      return;
    }
    const independent = await readJsonFile<{ manifestSha256: string }>(
      join(DIRECTORY, 'independent-pass.json'),
    );
    if (independent?.manifestSha256 !== expected) throw new Error('Independent pass required');
    if (JSON.stringify(await currentInputs(prisma)) !== JSON.stringify(manifest.inputs))
      throw new Error('Parser code/catalog drift');
    const before = await integrity(prisma, manifest, baseline, false);
    let checkpoint = await readJsonFile<Checkpoint>(CHECKPOINT_PATH);
    if (checkpoint === null) {
      if (before.applied !== 0)
        throw new Error('Unexpected completed comments before checkpoint creation');
      checkpoint = { manifestSha256: expected, nextIndex: 0, updated: 0, replayed: 0 };
      await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
    }
    if (
      checkpoint.manifestSha256 !== expected ||
      ![checkpoint.nextIndex, checkpoint.updated, checkpoint.replayed].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      checkpoint.nextIndex > manifest.candidates.length ||
      (checkpoint.nextIndex !== manifest.candidates.length &&
        checkpoint.nextIndex % RAW_COMMENT_BATCH_SIZE !== 0) ||
      checkpoint.updated + checkpoint.replayed !== checkpoint.nextIndex
    )
      throw new Error('Checkpoint drift');
    // Уже продвинутый checkpoint не может пропускать строки, вновь ставшие NULL.
    const committedIndex = checkpoint.nextIndex;
    const committedRows = await prisma.$transaction((tx) =>
      readRawCommentRows(
        tx,
        manifest.candidates.slice(0, committedIndex).map((item) => item.id),
      ),
    );
    const committedById = new Map(committedRows.map((row) => [row.id, row]));
    for (const item of manifest.candidates.slice(0, checkpoint.nextIndex))
      if (verifyRawCommentRow(committedById.get(item.id), item) !== 'REPLAY')
        throw new Error('Committed checkpoint row drift');
    let updated = 0;
    let skipped = before.applied;
    while (checkpoint.nextIndex < manifest.candidates.length && !stopRequested) {
      await pinnedArtifacts(expected);
      if (JSON.stringify(await currentInputs(prisma)) !== JSON.stringify(manifest.inputs))
        throw new Error('Parser inputs changed between batches');
      if (JSON.stringify(await readJsonFile(CHECKPOINT_PATH)) !== JSON.stringify(checkpoint))
        throw new Error('Checkpoint changed between batches');
      const batch = manifest.candidates.slice(
        checkpoint.nextIndex,
        checkpoint.nextIndex + RAW_COMMENT_BATCH_SIZE,
      );
      const result = await writeRawCommentBatch(prisma, batch);
      // Сначала COMMIT; ошибка записи файла допускает повторение лишь уже согласованных значений.
      checkpoint = {
        ...checkpoint,
        nextIndex: checkpoint.nextIndex + batch.length,
        updated: checkpoint.updated + result.updated,
        replayed: checkpoint.replayed + result.skipped,
      };
      await writeJsonAtomic(CHECKPOINT_PATH, checkpoint);
      updated += result.updated;
      console.info(`Committed ${checkpoint.nextIndex}/${manifest.candidates.length}`);
    }
    const complete = checkpoint.nextIndex === manifest.candidates.length;
    const after = await integrity(prisma, manifest, baseline, complete);
    skipped = after.applied - updated;
    const summary = {
      planned: EXPECTED_CANDIDATES,
      updated,
      skipped,
      manifestSha256: expected,
      integrity: after,
      checkpoint,
      ready: complete,
    };
    await writeJsonAtomic(join(DIRECTORY, 'runs', `${randomUUID()}.json`), summary);
    await writeJsonAtomic(join(DIRECTORY, 'last-run.json'), summary);
    console.info(JSON.stringify(summary));
    if (!complete) process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await prisma.$disconnect();
  }
}

/** OS flock исключает двух одновременных writers и автоматически снимается после crash. */
async function locked(mode: string, expected: string): Promise<void> {
  await mkdir(DIRECTORY, { recursive: true, mode: 0o700 });
  const child = spawn(
    'flock',
    [
      '--nonblock',
      '--no-fork',
      join(DIRECTORY, 'writer.lock'),
      process.execPath,
      '--import',
      'tsx',
      fileURLToPath(import.meta.url),
      '--locked',
      mode,
      ...(mode === 'freeze' ? [] : [expected]),
    ],
    { stdio: 'inherit', env: { ...process.env, RAW_COMMENT_LOCK_PARENT: String(process.pid) } },
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const worker = args[0] === '--locked';
  const [mode, expected = ''] = worker ? args.slice(1) : args;
  if (
    (worker && !process.env.RAW_COMMENT_LOCK_PARENT) ||
    !['freeze', 'check', 'apply'].includes(mode) ||
    args.length !== (worker ? (mode === 'freeze' ? 2 : 3) : mode === 'freeze' ? 1 : 2)
  ) {
    console.error('Usage: recover-raw-source-comments.ts freeze | check SHA256 | apply SHA256');
    process.exitCode = 1;
  } else {
    void (worker ? execute(mode, expected) : locked(mode, expected)).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Raw-source recovery failed');
      process.exitCode = 1;
    });
  }
}
