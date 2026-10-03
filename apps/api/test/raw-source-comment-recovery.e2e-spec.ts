import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { config } from 'dotenv';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import { normalizeCatalogName } from '../src/catalog/catalog-normalization.js';
import { getTestDatabaseConfiguration } from './database.js';
import { sha256Hex } from '../src/forum-import/cache.js';
import { deriveExternalImportKey } from '../src/forum-import/identity.js';
import {
  readRawCommentRows,
  writeRawCommentBatch,
  type RawCommentCandidate,
} from '../src/forum-import/raw-source-comment-recovery.js';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
config({ path: `${apiDirectory}/.env`, quiet: true });
config({ path: `${apiDirectory}/test/.env`, quiet: true });
let prisma: PrismaClient;
let graph: { userId: string; baseId: string; locationId: string; fishId: string; baitId: string };

/** Читает лишь fixtures текущего теста, сохраняя остальные данные test DB. */
async function fixtureRows() {
  const ids = await prisma.catchReport.findMany({
    where: { userId: graph.userId },
    select: { id: true },
  });
  return prisma.$transaction((tx) =>
    readRawCommentRows(
      tx,
      ids.map((row) => row.id),
    ),
  );
}

/** Исторические timestamps и Unicode позволяют проверить точность SQL-hash и raw UPDATE. */
async function fixturePlan(
  count: number,
  importKey: string | null = null,
): Promise<RawCommentCandidate[]> {
  await prisma.catchReport.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: graph.userId,
      locationId: graph.locationId,
      fishId: graph.fishId,
      baitId: graph.baitId,
      contributorKey: `local-user:${graph.userId}`,
      importKey,
      weightGrams: 1000 + index,
      fishingMethod: 'BAIT_FISHING' as const,
      holeDepthCm: 600,
      spotPositionRaw: 'левее ёлки',
      rawSourceText: `Нетронутый исходник ё '${index}'.\nточная строка`,
      createdAt: new Date('2020-01-01T00:00:00Z'),
      updatedAt: new Date('2020-01-02T00:00:00Z'),
    })),
  });
  return (await fixtureRows()).map((row) => {
    assert.equal(row.rawSourceTextSha256, sha256Hex(row.rawSourceText!));
    return {
      id: row.id,
      rawSourceTextSha256: row.rawSourceTextSha256,
      nonCommentSha256: row.nonCommentSha256,
      userNoteRaw: `Комментарий ё '${row.weightGrams}' ; "точно"`,
    };
  });
}

void describe('raw-source comment recovery PostgreSQL safety', () => {
  void before(() => {
    const database = getTestDatabaseConfiguration(process.env);
    prisma = new PrismaClient({ adapter: createPrismaAdapter(database.testDatabaseUrl) });
  });
  void beforeEach(async () => {
    const name = randomUUID().replaceAll('-', '');
    graph = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `raw-recovery-${name}@example.ru`,
          nickname: name,
          nicknameNormalized: name,
          passwordHash: 'fixture-only',
          role: 'ADMIN',
        },
      });
      const base = await tx.fishingBase.create({
        data: normalizeCatalogName(`raw-recovery-base-${name}`),
      });
      const location = await tx.location.create({
        data: { fishingBaseId: base.id, number: 1, ...normalizeCatalogName(name) },
      });
      const fish = await tx.fish.create({ data: normalizeCatalogName(name) });
      const bait = await tx.bait.create({ data: { ...normalizeCatalogName(name), type: 'BAIT' } });
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

  void it('updates 100 comments only and replays a committed batch without checkpoint advancement', async () => {
    const plan = await fixturePlan(100);
    const before = await fixtureRows();
    const fishBefore = await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } });
    const activityBefore = await prisma.activityEvent.count();
    assert.deepEqual(await writeRawCommentBatch(prisma, plan), { updated: 100, skipped: 0 });
    const afterRows = await fixtureRows();
    assert.deepEqual(
      afterRows.map((row) => ({ ...row, userNoteRaw: null })),
      before,
    );
    assert.deepEqual(
      await prisma.fish.findUniqueOrThrow({ where: { id: graph.fishId } }),
      fishBefore,
    );
    assert.equal(await prisma.activityEvent.count(), activityBefore);
    assert.deepEqual(await writeRawCommentBatch(prisma, plan), { updated: 0, skipped: 100 });
    assert.deepEqual(await fixtureRows(), afterRows);
  });

  void it('aborts the whole batch on raw-source, domain, timestamp and non-null comment drift', async () => {
    const plan = await fixturePlan(2);
    const item = plan[1];
    const original = await prisma.catchReport.findUniqueOrThrow({ where: { id: item.id } });
    for (const patch of [
      { rawSourceText: 'changed source' },
      { weightGrams: 9000 },
      { updatedAt: new Date('2020-01-03T00:00:00Z') },
      { userNoteRaw: 'preserve this' },
    ]) {
      await prisma.catchReport.update({
        where: { id: item.id },
        data: {
          ...patch,
          updatedAt: original.updatedAt,
          ...(patch.updatedAt ? { updatedAt: patch.updatedAt } : {}),
        },
      });
      const before = await fixtureRows();
      await assert.rejects(writeRawCommentBatch(prisma, plan), /precondition drift/);
      assert.deepEqual(await fixtureRows(), before);
      await prisma.catchReport.update({
        where: { id: item.id },
        data: {
          rawSourceText: original.rawSourceText,
          weightGrams: original.weightGrams,
          userNoteRaw: null,
          updatedAt: original.updatedAt,
        },
      });
    }
  });

  void it('forbids historical forum rows even with a matching source and full row hash', async () => {
    const initial = await fixturePlan(
      1,
      deriveExternalImportKey(
        BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 14)}`).toString(),
        1,
      ),
    );
    const row = (await fixtureRows())[0];
    const plan = [{ ...initial[0], nonCommentSha256: row.nonCommentSha256 }];
    await assert.rejects(writeRawCommentBatch(prisma, plan), /precondition drift/);
    assert.deepEqual(await fixtureRows(), [row]);
  });
});
