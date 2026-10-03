import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import { normalizeCatalogName } from '../src/catalog/catalog-normalization.js';
import { getTestDatabaseConfiguration } from './database.js';
import {
  deriveExternalContributorKey,
  deriveExternalImportKey,
} from '../src/forum-import/identity.js';
import {
  APPROVED_COMMENT_PLAN_SHA256,
  APPROVED_COMMENT_REPORT_SHA256,
  APPROVED_COMMENT_DATABASE_SHA256,
  readRecoveryRows,
  recoveryRowHash,
  writeRecoveryBatch,
  commitRecoveryBatchAndCheckpoint,
  verifyRecoveryIntegrity,
  type RecoveryWriteCandidate,
  type RecoveryWriteCheckpoint,
} from '../src/forum-import/comment-recovery-writer.js';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
config({ path: `${apiDirectory}/.env`, quiet: true });
config({ path: `${apiDirectory}/test/.env`, quiet: true });
let prisma: PrismaClient;
let graph: { userId: string; baseId: string; locationId: string; fishId: string; baitId: string };

/** Берёт только собственные fixtures, не очищая чужие строки даже в отдельной test DB. */
async function fixtureRows() {
  return (await readRecoveryRows(prisma)).filter((row) => row.userId === graph.userId);
}

/** Создаёт отдельные observations с историческими timestamps для проверки raw UPDATE. */
async function reports(count: number, existingComment: string | null = null) {
  const postId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 14)}`).toString();
  await prisma.catchReport.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: graph.userId,
      locationId: graph.locationId,
      fishId: graph.fishId,
      baitId: graph.baitId,
      contributorKey: deriveExternalContributorKey('777'),
      importKey: deriveExternalImportKey(postId, index + 1),
      weightGrams: 1000 + index,
      fishingMethod: 'BAIT_FISHING',
      holeDepthCm: 600,
      spotPositionRaw: 'левее',
      userNoteRaw: existingComment,
      rawSourceText: null,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-02T00:00:00Z'),
    })),
  });
  return fixtureRows();
}

/** План строится только для тестового ядра; production CLI всегда требует одобренный hash. */
function candidates(rows: Awaited<ReturnType<typeof fixtureRows>>): RecoveryWriteCandidate[] {
  return rows
    .filter((row) => row.userNoteRaw === null)
    .map((row) => ({
      id: row.id,
      importKey: row.importKey ?? '',
      userNoteRaw: `комментарий '${row.weightGrams}' ; "точно"`,
      baselineSha256: recoveryRowHash(row),
      parserDisagreements: [],
    }));
}

void describe('forum comment recovery PostgreSQL write safety', () => {
  void before(() => {
    const database = getTestDatabaseConfiguration(process.env);
    prisma = new PrismaClient({ adapter: createPrismaAdapter(database.testDatabaseUrl) });
  });
  void beforeEach(async () => {
    const name = randomUUID().replaceAll('-', '');
    graph = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: `recovery-${name}@example.ru`,
          nickname: name,
          nicknameNormalized: name,
          passwordHash: 'fixture-only',
          role: 'ADMIN',
        },
      });
      const base = await transaction.fishingBase.create({
        data: normalizeCatalogName(`recovery-base-${name}`),
      });
      const location = await transaction.location.create({
        data: {
          fishingBaseId: base.id,
          number: 1,
          ...normalizeCatalogName(`recovery-location-${name}`),
        },
      });
      const fish = await transaction.fish.create({
        data: normalizeCatalogName(`recovery-fish-${name}`),
      });
      const bait = await transaction.bait.create({
        data: { ...normalizeCatalogName(`recovery-bait-${name}`), type: 'BAIT' },
      });
      return {
        userId: user.id,
        baseId: base.id,
        locationId: location.id,
        fishId: fish.id,
        baitId: bait.id,
      };
    });
  });
  void afterEach(async () => {
    getTestDatabaseConfiguration(process.env);
    if (!graph || !(await prisma.user.findUnique({ where: { id: graph.userId } }))) return;
    await prisma.catchReport.deleteMany({ where: { userId: graph.userId } });
    await prisma.user.delete({ where: { id: graph.userId } });
    await prisma.location.delete({ where: { id: graph.locationId } });
    await prisma.fishingBase.delete({ where: { id: graph.baseId } });
    await prisma.fish.delete({ where: { id: graph.fishId } });
    await prisma.bait.delete({ where: { id: graph.baitId } });
  });
  void after(async () => {
    await prisma?.$disconnect();
  });

  void it('updates 100 comments only, preserves held/existing rows and timestamps, and replays zero writes', async () => {
    await reports(100);
    await reports(1, 'existing comment');
    const before = await reports(1);
    const all = candidates(before);
    const plan = all.slice(0, 100);
    const fishBefore = await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } });
    const activityBefore = await prisma.activityEvent.count();
    assert.deepEqual(await writeRecoveryBatch(prisma, plan), { updated: 100, skipped: 0 });
    const afterRows = await fixtureRows();
    assert.equal(
      verifyRecoveryIntegrity(before, afterRows, plan, true).existingCommentsPreserved,
      1,
    );
    assert.deepEqual(
      await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } }),
      fishBefore,
    );
    assert.equal(await prisma.activityEvent.count(), activityBefore);
    assert.deepEqual(await writeRecoveryBatch(prisma, plan), { updated: 0, skipped: 100 });
    assert.deepEqual(await fixtureRows(), afterRows);
  });

  void it('checks every locked precondition before any write and aborts the entire batch on drift', async () => {
    const rows = await reports(2);
    const plan = candidates(rows);
    const changed = plan[1];
    assert.ok(changed);
    await prisma.catchReport.update({ where: { id: changed.id }, data: { weightGrams: 9999 } });
    const beforeAttempt = await fixtureRows();
    await assert.rejects(writeRecoveryBatch(prisma, plan), /baseline drift/);
    assert.deepEqual(await fixtureRows(), beforeAttempt);
  });

  void it('never overwrites a concurrent non-null comment', async () => {
    const plan = candidates(await reports(1));
    const item = plan[0];
    assert.ok(item);
    await prisma.catchReport.update({
      where: { id: item.id },
      data: { userNoteRaw: 'preserve this' },
    });
    const beforeAttempt = await fixtureRows();
    await assert.rejects(writeRecoveryBatch(prisma, plan), /non-null comment preserved/);
    assert.deepEqual(await fixtureRows(), beforeAttempt);
  });

  void it('commits before checkpoint, then resumes a lost checkpoint without duplicate writes', async () => {
    const beforeRows = await reports(1);
    const plan = candidates(beforeRows);
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
    await assert.rejects(
      commitRecoveryBatchAndCheckpoint(prisma, plan, checkpoint, async () => {
        const afterCommit = await fixtureRows();
        assert.equal(afterCommit[0]?.userNoteRaw, plan[0]?.userNoteRaw);
        throw new Error('simulated checkpoint failure after commit');
      }),
      /checkpoint failure/,
    );
    assert.equal(checkpoint.nextIndex, 0);
    let saved: RecoveryWriteCheckpoint | undefined;
    const result = await commitRecoveryBatchAndCheckpoint(prisma, plan, checkpoint, (next) => {
      saved = next;
      return Promise.resolve();
    });
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(saved?.nextIndex, 1);
    assert.equal(
      verifyRecoveryIntegrity(beforeRows, await fixtureRows(), plan, true).commentsChanged,
      1,
    );
  });
});
