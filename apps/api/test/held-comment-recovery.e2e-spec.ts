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
import { recoveryRowHash } from '../src/forum-import/comment-recovery-writer.js';
import {
  HELD_MANIFEST_SHA256,
  commitHeldBatchAndCheckpoint,
  readHeldCommentRows,
  writeHeldCommentBatch,
  type HeldCheckpoint,
  type HeldWriteCandidate,
} from '../src/forum-import/held-comment-recovery.js';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
config({ path: `${apiDirectory}/.env`, quiet: true });
config({ path: `${apiDirectory}/test/.env`, quiet: true });
let prisma: PrismaClient;
let graph: { userId: string; baseId: string; locationId: string; fishId: string; baitId: string };

/** Читает только fixtures текущего теста; полный SQL-hash проверяется на настоящем PostgreSQL. */
async function fixtureRows() {
  const ids = await prisma.catchReport.findMany({
    where: { userId: graph.userId },
    select: { id: true },
  });
  return prisma.$transaction((tx) =>
    readHeldCommentRows(
      tx,
      ids.map((r) => r.id),
    ),
  );
}

/** Разные import identities и timestamps позволяют проверить точность comment-only UPDATE. */
async function fixturePlan(count: number): Promise<HeldWriteCandidate[]> {
  const postId = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 14)}`).toString();
  await prisma.catchReport.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: graph.userId,
      fishId: graph.fishId,
      locationId: graph.locationId,
      baitId: graph.baitId,
      importKey: deriveExternalImportKey(postId, index + 1),
      contributorKey: deriveExternalContributorKey('777'),
      weightGrams: 2194 + index,
      fishingMethod: 'SPINNING' as const,
      holeDepthCm: 763,
      spotPositionRaw: 'левее ёлки',
      spinningSize: 'SMALL' as const,
      spinningSpeed: 'SLOW' as const,
      rawSourceText: null,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-02T00:00:00Z'),
    })),
  });
  return (await fixtureRows()).map((row) => ({
    id: row.id,
    importKey: row.importKey!,
    baselineSha256: recoveryRowHash(row),
    nonCommentSha256: row.nonCommentSha256,
    userNoteRaw: `Комментарий ё '${row.weightGrams}' ; "точно"`,
    source: {
      forum: 'forum69',
      topicId: '1',
      postId,
      candidateOrdinal: 1,
      bodySha256: 'a'.repeat(64),
      sourceTextSha256: 'a'.repeat(64),
      sourceLineSha256: 'a'.repeat(64),
      startOffset: 0,
      endOffset: 100,
      baitStart: 30,
      baitEnd: 40,
      commentStart: 42,
      commentEnd: 100,
    },
  }));
}

void describe('held-comment recovery PostgreSQL safety', () => {
  void before(() => {
    const database = getTestDatabaseConfiguration(process.env);
    prisma = new PrismaClient({ adapter: createPrismaAdapter(database.testDatabaseUrl) });
  });
  void beforeEach(async () => {
    const name = randomUUID().replaceAll('-', '');
    graph = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `held-recovery-${name}@example.ru`,
          nickname: name,
          nicknameNormalized: name,
          passwordHash: 'fixture-only',
          role: 'ADMIN',
        },
      });
      const base = await tx.fishingBase.create({ data: normalizeCatalogName(name) });
      const location = await tx.location.create({
        data: { fishingBaseId: base.id, number: 1, ...normalizeCatalogName(name) },
      });
      const fish = await tx.fish.create({ data: normalizeCatalogName(name) });
      const bait = await tx.bait.create({ data: { ...normalizeCatalogName(name), type: 'LURE' } });
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
    if (!graph) return;
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

  void it('updates 100 comments, preserves every other column/counter/activity and performs zero-DML replay', async () => {
    const plan = await fixturePlan(100);
    const beforeRows = await fixtureRows();
    const fishBefore = await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } });
    const activityBefore = await prisma.activityEvent.count();
    assert.deepEqual(await writeHeldCommentBatch(prisma, plan), { updated: 100, skipped: 0 });
    const afterRows = await fixtureRows();
    assert.deepEqual(
      afterRows.map((r) => ({ ...r, userNoteRaw: null })),
      beforeRows,
    );
    assert.deepEqual(
      await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } }),
      fishBefore,
    );
    assert.equal(await prisma.activityEvent.count(), activityBefore);
    assert.deepEqual(await writeHeldCommentBatch(prisma, plan), { updated: 0, skipped: 100 });
    assert.deepEqual(await fixtureRows(), afterRows);
  });

  void it('preserves non-null comments and aborts the entire batch on identity/domain/timestamp/raw/hash drift', async () => {
    const plan = await fixturePlan(2);
    const original = await prisma.catchReport.findUniqueOrThrow({ where: { id: plan[1].id } });
    for (const patch of [
      { userNoteRaw: 'preserve this' },
      { userNoteRaw: '' },
      { weightGrams: 9000 },
      { updatedAt: new Date('2020-01-03T00:00:00Z') },
      { rawSourceText: 'changed source' },
    ]) {
      await prisma.catchReport.update({
        where: { id: original.id },
        data: { updatedAt: original.updatedAt, ...patch },
      });
      const beforeRows = await fixtureRows();
      await assert.rejects(writeHeldCommentBatch(prisma, plan), /precondition drift/);
      assert.deepEqual(await fixtureRows(), beforeRows);
      await prisma.catchReport.update({
        where: { id: original.id },
        data: {
          userNoteRaw: null,
          weightGrams: original.weightGrams,
          updatedAt: original.updatedAt,
          rawSourceText: null,
          contributorKey: original.contributorKey,
          importKey: original.importKey,
        },
      });
    }
    await assert.rejects(
      writeHeldCommentBatch(prisma, [plan[0], { ...plan[1], nonCommentSha256: 'f'.repeat(64) }]),
      /precondition drift/,
    );
    // Immutable keys защищены DB-триггером; проверяем подмену identity в плане, не обходя триггер.
    await assert.rejects(
      writeHeldCommentBatch(prisma, [
        plan[0],
        { ...plan[1], importKey: deriveExternalImportKey('999', 1) },
      ]),
      /precondition drift/,
    );
    await assert.rejects(
      writeHeldCommentBatch(prisma, [plan[0], { ...plan[1], baselineSha256: 'f'.repeat(64) }]),
      /precondition drift/,
    );
    assert((await fixtureRows()).every((r) => r.userNoteRaw === null));
    await assert.rejects(
      writeHeldCommentBatch(prisma, [plan[0], plan[0]]),
      /Invalid held-comment batch/,
    );
  });

  void it('advances checkpoint after COMMIT only and resumes after checkpoint persistence fails', async () => {
    const plan = await fixturePlan(2);
    const cp: HeldCheckpoint = {
      manifestSha256: HELD_MANIFEST_SHA256,
      baselineSha256: 'a'.repeat(64),
      nextIndex: 0,
      updated: 0,
      replayed: 0,
      committedBatches: 0,
    };
    await assert.rejects(
      commitHeldBatchAndCheckpoint(prisma, plan, cp, async () => {
        const rows = await fixtureRows();
        assert(rows.every((r) => r.userNoteRaw !== null));
        throw new Error('checkpoint disk failure');
      }),
      /checkpoint disk failure/,
    );
    assert.equal(cp.nextIndex, 0);
    let saved: HeldCheckpoint | undefined;
    const result = await commitHeldBatchAndCheckpoint(prisma, plan, cp, (next) => {
      saved = next;
      return Promise.resolve();
    });
    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 2);
    assert.equal(saved?.nextIndex, 2);
    assert.equal(saved?.replayed, 2);
  });
});
