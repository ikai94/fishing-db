import 'dotenv/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { readJsonFile, sha256Hex, writeFileAtomic, writeJsonAtomic } from './cache.js';
import { readRecoveryRows } from './comment-recovery-writer.js';
import { COMMENT_RECOVERY_PREFIXES, recoverySourceLine } from './comment-recovery.js';
import { Prisma } from '../generated/prisma/client.js';
import type { CandidateIdentityManifest } from './candidate-identity-manifest.js';
import { deriveExternalContributorKey, deriveExternalImportKey } from './identity.js';
import { deriveForum83ImportKey } from './forum83/identity.js';
import {
  HELD_BATCH_SIZE,
  HELD_MANIFEST_SHA256,
  commitHeldBatchAndCheckpoint,
  readHeldCommentRows,
  validateHeldBatch,
  verifyHeldRow,
  type HeldCheckpoint,
  type HeldCommentCandidate,
  type HeldCommentRow,
  type HeldWriteCandidate,
} from './held-comment-recovery.js';

const API_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIRECTORY = join(API_ROOT, '.local/held-comment-analysis');
const WRITE_DIRECTORY = join(DIRECTORY, 'write');
const BASELINE_PATH = join(WRITE_DIRECTORY, 'baseline.json');
const CHECKPOINT_PATH = join(WRITE_DIRECTORY, 'checkpoint.json');
const METADATA_SHA256 = '0830f3ceca5fad026a13581be9d5d26cca09867e63363b53062a1f3aeb78d83d';
const FORUM_ROOT = join(API_ROOT, '.local/forum-import/rus-fishsoft');

/** Закреплённые анализом inputs не заменяются новым parsing или выборкой eligible-строк. */
interface Metadata {
  manifestSha256: string;
  population: number;
  safe: number;
  hold: number;
  sourceVerification: Array<{ forum: string; files: FileHash[] }>;
  codeHashes: FileHash[];
  analysisCodeHashes: FileHash[];
  artifactHashes: Record<string, string>;
  preservation: { preExistingRecordsSortHashes: Record<string, string> };
}

/** Отпечаток exact bytes, исключающий незаметную подмену runtime или frozen artifacts. */
interface FileHash {
  path: string;
  sha256: string;
}

/** Полный row guard сохраняет остальные колонки и первоначальный комментарий каждой строки. */
interface Guard {
  id: string;
  nonCommentSha256: string;
  userNoteRaw: string | null;
}

/** Baseline охватывает весь исторический форум, 792 завершённых строки, counters и activity. */
interface Baseline {
  manifestSha256: string;
  runtime: FileHash[];
  guards: Guard[];
  protected: Snapshot['protected'];
}

/** Один PostgreSQL read-only snapshot нужен для согласованной проверки полной области. */
interface Snapshot {
  rows: HeldCommentRow[];
  guards: Guard[];
  protected: {
    fishSha256: string;
    activityCount: number;
    activityMaxId: string | null;
    catchReportCount: number;
  };
}

/** Bigint в audit сохраняется без потери точности; стабильные байты используются для hash. */
function serialized(value: unknown): string {
  return `${JSON.stringify(value, (_key, field: unknown) => (typeof field === 'bigint' ? field.toString() : field), 2)}\n`;
}

/** Проверяет закреплённые файлы до любого DB-read/write; старые планы остаются неизменными. */
async function frozenPlan(): Promise<HeldCommentCandidate[]> {
  const metadataBytes = await readFile(join(DIRECTORY, 'manifest-metadata.json'));
  if (sha256Hex(metadataBytes) !== METADATA_SHA256) throw new Error('Held metadata drift');
  const metadata = JSON.parse(metadataBytes.toString()) as Metadata;
  const bytes = await readFile(join(DIRECTORY, 'candidates.jsonl'), 'utf8');
  if (sha256Hex(bytes) !== HELD_MANIFEST_SHA256 || metadata.manifestSha256 !== HELD_MANIFEST_SHA256)
    throw new Error('Held manifest drift');
  const files = [
    ...metadata.codeHashes,
    ...metadata.analysisCodeHashes,
    ...metadata.sourceVerification.flatMap((s) => s.files),
    ...Object.entries(metadata.artifactHashes).map(([path, sha256]) => ({
      path: join(DIRECTORY, path),
      sha256,
    })),
    ...Object.entries(metadata.preservation.preExistingRecordsSortHashes).map(([path, sha256]) => ({
      path: join(API_ROOT, '../..', path),
      sha256,
    })),
  ];
  for (const file of files)
    if (sha256Hex(await readFile(file.path)) !== file.sha256)
      throw new Error(`Frozen input drift: ${file.path}`);
  const plan = bytes
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as HeldCommentCandidate);
  if (
    metadata.population !== 1375 ||
    metadata.safe !== 1375 ||
    metadata.hold !== 0 ||
    plan.length !== 1375 ||
    new Set(plan.map((i) => i.id)).size !== 1375 ||
    new Set(plan.map((i) => i.importKey)).size !== 1375 ||
    plan.some((item, index) => index > 0 && plan[index - 1].id.localeCompare(item.id) >= 0)
  )
    throw new Error('Frozen held population drift');
  return plan;
}

/** Runtime writer, schema и lockfile закрепляются первым check и сверяются при resume. */
async function runtimeHashes(): Promise<FileHash[]> {
  const paths = [
    'src/forum-import/apply-held-comments.ts',
    'src/forum-import/held-comment-recovery.ts',
    'src/forum-import/comment-recovery-writer.ts',
    'src/forum-import/cache.ts',
    'src/prisma/prisma-adapter.ts',
    'prisma/schema.prisma',
    '../../pnpm-lock.yaml',
  ];
  return Promise.all(
    paths.map(async (path) => ({
      path,
      sha256: sha256Hex(await readFile(join(API_ROOT, path))),
    })),
  );
}

/** Проверяет ровно source ranges и identities manifest; Fish/вес/наживка заново не разрешаются. */
async function verifySources(
  plan: readonly HeldCommentCandidate[],
  rows: readonly HeldCommentRow[],
): Promise<void> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const identities = new Map<string, CandidateIdentityManifest>();
  for (const forum of ['forum69', 'forum83']) {
    const path =
      forum === 'forum69'
        ? join(FORUM_ROOT, 'outputs/all-parent-69/technical/candidate-identities.json')
        : join(
            FORUM_ROOT,
            'forum83/outputs/forum83-all-forum-83/technical/candidate-identities.json',
          );
    const file = JSON.parse(await readFile(path, 'utf8')) as
      CandidateIdentityManifest | { candidateIdentities: CandidateIdentityManifest };
    identities.set(forum, 'candidateIdentities' in file ? file.candidateIdentities : file);
  }
  for (const item of plan) {
    const source = item.source;
    const identity = identities.get(source.forum)?.posts.find((p) => p.postId === source.postId);
    const boundary = identity?.candidates.find((b) => b.importKey === item.importKey);
    const post = JSON.parse(
      await readFile(
        join(
          FORUM_ROOT,
          source.forum === 'forum83' ? 'forum83' : '',
          'entities/posts',
          `${source.postId}.json`,
        ),
        'utf8',
      ),
    ) as { postId: string; topicId: string; memberId: string; bodyText: string };
    const key =
      source.forum === 'forum69'
        ? deriveExternalImportKey(post.postId, source.candidateOrdinal)
        : deriveForum83ImportKey(post.postId, source.candidateOrdinal);
    if (
      !identity ||
      !boundary ||
      key !== item.importKey ||
      post.postId !== source.postId ||
      post.topicId !== source.topicId ||
      byId.get(item.id)?.contributorKey !== deriveExternalContributorKey(post.memberId) ||
      sha256Hex(post.bodyText) !== source.bodySha256 ||
      identity.bodySha256 !== source.bodySha256 ||
      boundary.candidateOrdinal !== source.candidateOrdinal ||
      boundary.startOffset !== source.startOffset ||
      boundary.endOffset !== source.endOffset ||
      boundary.sourceTextSha256 !== source.sourceTextSha256 ||
      sha256Hex(post.bodyText.slice(source.startOffset, source.endOffset)) !==
        source.sourceTextSha256
    )
      throw new Error(`Held source identity/hash drift: ${item.id}`);
    const line = recoverySourceLine(
      post.bodyText,
      boundary,
      identity.candidates,
      source.forum === 'forum83',
    );
    if (
      line.source === null ||
      sha256Hex(line.source) !== source.sourceLineSha256 ||
      !Number.isSafeInteger(source.baitStart) ||
      !Number.isSafeInteger(source.baitEnd) ||
      source.baitStart < 0 ||
      source.baitEnd <= source.baitStart ||
      source.commentStart <= source.baitEnd ||
      source.commentEnd > line.source.length ||
      line.source.slice(source.commentStart, source.commentEnd) !== item.userNoteRaw ||
      line.source.slice(source.commentStart).trim() !== item.userNoteRaw ||
      !/^\s*\.\s*$/u.test(line.source.slice(source.baitEnd, source.commentStart))
    )
      throw new Error(`Held source boundary drift: ${item.id}`);
  }
}

/** Полный read-only снимок защищает также завершённые 6191/792 восстановления и чужие строки. */
async function snapshot(
  prisma: PrismaClient,
  plan: readonly HeldCommentCandidate[],
): Promise<Snapshot> {
  const protectedIds = (
    JSON.parse(
      await readFile(
        join(API_ROOT, '.local/raw-source-comment-recovery/frozen/manifest.json'),
        'utf8',
      ),
    ) as { candidates: Array<{ id: string }> }
  ).candidates.map((item) => item.id);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const rows = await readHeldCommentRows(
        tx,
        plan.map((item) => item.id),
      );
      // Все форумные строки и отдельные 792 защищаются полным hash. Миллионы unrelated
      // generated catches не загружаются: DML ограничен точными ids и проверяет RETURNING.
      const guards = await tx.$queryRaw<Guard[]>(Prisma.sql`
        SELECT report."id", encode(sha256(convert_to((to_jsonb(report) - 'userNoteRaw')::text, 'UTF8')), 'hex')
          AS "nonCommentSha256", report."userNoteRaw"
        FROM "CatchReport" AS report
        WHERE ${Prisma.join(
          COMMENT_RECOVERY_PREFIXES.map(
            (prefix) => Prisma.sql`report."importKey" LIKE ${`${prefix}%`}`,
          ),
          ' OR ',
        )}
          OR report."id" IN (${Prisma.join(protectedIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY report."id"
      `);
      const fish = await tx.fish.findMany({ orderBy: { id: 'asc' } });
      const activity = await tx.activityEvent.aggregate({ _count: true, _max: { id: true } });
      return {
        rows,
        guards,
        protected: {
          fishSha256: sha256Hex(serialized(fish)),
          activityCount: activity._count,
          activityMaxId: activity._max.id?.toString() ?? null,
          catchReportCount: await tx.catchReport.count(),
        },
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 120_000 },
  );
}

/** Старые завершённые планы должны иметь прежние hashes, комментарии и непересекающиеся ids. */
async function verifyCompleted(rows: readonly Guard[], plan: readonly HeldCommentCandidate[]) {
  const bytes6191 = await readFile(
    join(FORUM_ROOT, 'comment-recovery/dry-run/candidates.jsonl'),
    'utf8',
  );
  const bytes792 = await readFile(
    join(API_ROOT, '.local/raw-source-comment-recovery/frozen/manifest.json'),
    'utf8',
  );
  if (
    sha256Hex(bytes6191) !== 'dec6addb917a9d7e4aca4cb2bfc276d3e37e0df63f9ad18cf2aa4798edcf14b8' ||
    sha256Hex(bytes792) !== '9cdb1c457157487a95660f290488fd99db7a93ddaaa38f4597c946b8f6457e9f'
  )
    throw new Error('Completed recovery manifest drift');
  const completed6191 = bytes6191
    .trimEnd()
    .split('\n')
    .map((s) => JSON.parse(s) as { id: string; userNoteRaw: string });
  const completed792 = (
    JSON.parse(bytes792) as { candidates: Array<{ id: string; userNoteRaw: string }> }
  ).candidates;
  if (completed6191.length !== 6191 || completed792.length !== 792)
    throw new Error('Completed population drift');
  const held = new Set(plan.map((i) => i.id));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const item of [...completed6191, ...completed792])
    if (held.has(item.id) || byId.get(item.id)?.userNoteRaw !== item.userNoteRaw)
      throw new Error(`Completed recovery drift: ${item.id}`);
}

/** Проверяет все колонки исторического форума и 792 строк; вне plan комментарии неизменны. */
function integrity(
  current: Snapshot,
  baseline: Baseline,
  plan: readonly HeldCommentCandidate[],
  complete: boolean,
) {
  const planById = new Map(plan.map((i) => [i.id, i]));
  const before = new Map(baseline.guards.map((g) => [g.id, g]));
  if (
    current.guards.length !== before.size ||
    serialized(current.protected) !== serialized(baseline.protected)
  )
    throw new Error('CatchReport population/Fish/activity drift');
  let applied = 0;
  for (const row of current.guards) {
    const guard = before.get(row.id);
    if (!guard || guard.nonCommentSha256 !== row.nonCommentSha256)
      throw new Error(`Non-comment drift: ${row.id}`);
    const item = planById.get(row.id);
    if (item) {
      if (guard.userNoteRaw !== null) throw new Error('Non-null held baseline forbidden');
      if (row.userNoteRaw !== null && row.userNoteRaw !== item.userNoteRaw)
        throw new Error(`Held comment drift: ${row.id}`);
      if (row.userNoteRaw !== null) applied++;
    } else if (guard.userNoteRaw !== row.userNoteRaw)
      throw new Error(`Out-of-plan comment drift: ${row.id}`);
  }
  const byId = new Map(current.rows.map((row) => [row.id, row]));
  for (const item of plan)
    verifyHeldRow(byId.get(item.id), {
      ...item,
      nonCommentSha256: before.get(item.id)?.nonCommentSha256 ?? '',
    });
  if (complete && applied !== plan.length) throw new Error('Incomplete held recovery');
  return {
    applied,
    remaining: plan.length - applied,
    nonUserNoteRawChanges: 0,
    outOfPlanChanges: 0,
    completed6191Changed: 0,
    completed792Changed: 0,
  };
}

/** Checkpoint не может пропустить NULL или разрешить изменения более одного неотмеченного batch. */
function verifyCheckpoint(
  cp: HeldCheckpoint,
  baselineHash: string,
  plan: HeldWriteCandidate[],
  rows: HeldCommentRow[],
) {
  if (
    cp.manifestSha256 !== HELD_MANIFEST_SHA256 ||
    cp.baselineSha256 !== baselineHash ||
    ![cp.nextIndex, cp.updated, cp.replayed, cp.committedBatches].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    cp.nextIndex > plan.length ||
    (cp.nextIndex !== plan.length && cp.nextIndex % HELD_BATCH_SIZE !== 0) ||
    cp.updated + cp.replayed !== cp.nextIndex ||
    cp.committedBatches !== Math.ceil(cp.nextIndex / HELD_BATCH_SIZE)
  )
    throw new Error('Held checkpoint drift');
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [index, item] of plan.entries()) {
    const status = verifyHeldRow(byId.get(item.id), item);
    if (
      (index < cp.nextIndex && status !== 'REPLAY') ||
      (index >= cp.nextIndex + HELD_BATCH_SIZE && status !== 'UPDATE')
    )
      throw new Error('Held checkpoint row drift');
  }
}

/** Check не имеет DML; apply использует только уже сохранённый и hash-закреплённый baseline. */
async function execute(mode: string) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const plan = await frozenPlan();
    const current = await snapshot(prisma, plan);
    await verifySources(plan, current.rows);
    await verifyCompleted(current.guards, plan);
    let baseline = await readJsonFile<Baseline>(BASELINE_PATH);
    let cp = await readJsonFile<HeldCheckpoint>(CHECKPOINT_PATH);
    if (baseline === null) {
      if (mode !== 'check' || cp !== null)
        throw new Error('Run check before apply; baseline missing');
      const original = JSON.parse(await readFile(join(DIRECTORY, 'db-snapshot.json'), 'utf8')) as {
        rows: HeldCommentRow[];
      };
      const forumRows = await readRecoveryRows(prisma);
      if (current.guards.length !== 69_403 + 792)
        throw new Error('Historical/protected recovery population drift');
      if (serialized(forumRows) !== serialized(original.rows))
        throw new Error('Original forum snapshot drift');
      baseline = {
        manifestSha256: HELD_MANIFEST_SHA256,
        runtime: await runtimeHashes(),
        guards: current.guards,
        protected: current.protected,
      };
      const hash = sha256Hex(serialized(baseline));
      const byId = new Map(current.rows.map((r) => [r.id, r]));
      for (const item of plan) {
        const row = byId.get(item.id);
        if (
          !row ||
          verifyHeldRow(row, { ...item, nonCommentSha256: row.nonCommentSha256 }) !== 'UPDATE'
        )
          throw new Error('Initial held comment is non-null or changed');
      }
      await writeFileAtomic(BASELINE_PATH, serialized(baseline));
      cp = {
        manifestSha256: HELD_MANIFEST_SHA256,
        baselineSha256: hash,
        nextIndex: 0,
        updated: 0,
        replayed: 0,
        committedBatches: 0,
      };
      await writeJsonAtomic(CHECKPOINT_PATH, cp);
    }
    // Сбой между сохранением baseline и начального checkpoint допускает только NULL-состояние.
    if (cp === null && mode === 'check') {
      const state = integrity(current, baseline, plan, false);
      if (state.applied !== 0) throw new Error('Missing checkpoint after DML');
      cp = {
        manifestSha256: HELD_MANIFEST_SHA256,
        baselineSha256: sha256Hex(serialized(baseline)),
        nextIndex: 0,
        updated: 0,
        replayed: 0,
        committedBatches: 0,
      };
      await writeJsonAtomic(CHECKPOINT_PATH, cp);
    }
    if (
      cp === null ||
      cp.baselineSha256 !== sha256Hex(serialized(baseline)) ||
      baseline.manifestSha256 !== HELD_MANIFEST_SHA256 ||
      serialized(await runtimeHashes()) !== serialized(baseline.runtime)
    )
      throw new Error('Held baseline/runtime/checkpoint drift');
    const byId = new Map(baseline.guards.map((g) => [g.id, g]));
    const writePlan = plan.map((i): HeldWriteCandidate => ({
      ...i,
      nonCommentSha256: byId.get(i.id)?.nonCommentSha256 ?? '',
    }));
    for (let index = 0; index < writePlan.length; index += HELD_BATCH_SIZE)
      validateHeldBatch(writePlan.slice(index, index + HELD_BATCH_SIZE));
    const before = integrity(current, baseline, plan, false);
    verifyCheckpoint(cp, sha256Hex(serialized(baseline)), writePlan, current.rows);
    let updated = 0;
    while (mode === 'apply' && cp.nextIndex < plan.length && !stopRequested) {
      await frozenPlan();
      if (
        sha256Hex(await readFile(BASELINE_PATH)) !== cp.baselineSha256 ||
        serialized(await readJsonFile(CHECKPOINT_PATH)) !== serialized(cp) ||
        serialized(await runtimeHashes()) !== serialized(baseline.runtime)
      )
        throw new Error('Held inputs drift between batches');
      const live = await snapshot(prisma, plan);
      integrity(live, baseline, plan, false);
      verifyCheckpoint(cp, cp.baselineSha256, writePlan, live.rows);
      const batch = writePlan.slice(cp.nextIndex, cp.nextIndex + HELD_BATCH_SIZE);
      await verifySources(batch, live.rows);
      const result = await commitHeldBatchAndCheckpoint(prisma, batch, cp, (next) =>
        writeJsonAtomic(CHECKPOINT_PATH, next),
      );
      cp = result.checkpoint;
      updated += result.updated;
      console.info(`Committed ${cp.nextIndex}/${plan.length}`);
    }
    const complete = cp.nextIndex === plan.length;
    const afterSnapshot = await snapshot(prisma, plan);
    const after = integrity(afterSnapshot, baseline, plan, mode === 'apply' && complete);
    await verifyCompleted(afterSnapshot.guards, plan);
    await frozenPlan();
    await verifySources(plan, afterSnapshot.rows);
    const result = {
      mode,
      planned: plan.length,
      updated,
      skipped: mode === 'apply' ? after.applied - updated : before.applied,
      manifestSha256: HELD_MANIFEST_SHA256,
      integrity: after,
      checkpoint: cp,
      ready: mode === 'check' || complete,
    };
    await writeJsonAtomic(join(WRITE_DIRECTORY, 'runs', `${randomUUID()}.json`), result);
    await writeJsonAtomic(join(WRITE_DIRECTORY, 'last-run.json'), result);
    console.info(JSON.stringify(result));
    if (mode === 'apply' && !complete) process.exitCode = 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await prisma.$disconnect();
  }
}

/** Kernel flock запрещает одновременные writers и снимается автоматически при crash. */
async function locked(mode: string) {
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
      '--locked',
      mode,
      HELD_MANIFEST_SHA256,
    ],
    { stdio: 'inherit', env: { ...process.env, HELD_COMMENT_LOCK_PARENT: String(process.pid) } },
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
  const [mode, hash] = worker ? args.slice(1) : args;
  if (
    !['check', 'apply'].includes(mode) ||
    hash !== HELD_MANIFEST_SHA256 ||
    args.length !== (worker ? 3 : 2) ||
    (worker && !process.env.HELD_COMMENT_LOCK_PARENT)
  ) {
    console.error(
      'Usage: apply-held-comments.ts check|apply 08a88182c106ca7f237aa077c9e609922d739a59069af2c26961b494cf2c423a',
    );
    process.exitCode = 1;
  } else {
    void (worker ? execute(mode) : locked(mode)).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Held-comment recovery failed');
      process.exitCode = 1;
    });
  }
}
