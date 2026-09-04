import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { config as loadEnvironmentFile } from 'dotenv';
import { normalizeCatalogName } from '../src/catalog/catalog-normalization.js';
import {
  ForumCompleteImportError,
  importCompleteForumCandidates,
} from '../src/forum-import/complete-importer.js';
import { loadCatalogSnapshot } from '../src/forum-import/catalog-source.js';
import { buildCandidateIdentityManifest } from '../src/forum-import/candidate-identity-manifest.js';
import type {
  ParsedForumCandidate,
  TechnicalForumPost,
} from '../src/forum-import/candidate-types.js';
import {
  recoverForumFishCatalogCandidates,
  type FishReconciliationManifest,
} from '../src/forum-import/fish-catalog-recovery.js';
import {
  deriveExternalContributorKey,
  deriveExternalImportKey,
} from '../src/forum-import/identity.js';
import { buildStagingArtifacts, type StagingCandidate } from '../src/forum-import/staging.js';
import type { VerifiedForumStagingBundle } from '../src/forum-import/staging-reader.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAdapter } from '../src/prisma/prisma-adapter.js';
import {
  clearTestData,
  getTestDatabaseConfiguration,
  type TestDatabaseConfiguration,
} from './database.js';

const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const ADMIN_EMAIL = 'forum-import-admin@example.ru';

loadEnvironmentFile({ path: `${API_DIRECTORY}/.env`, quiet: true });
loadEnvironmentFile({ path: `${API_DIRECTORY}/test/.env`, quiet: true });

let prisma: PrismaClient;
let databaseConfiguration: TestDatabaseConfiguration;
let clearDatabase: (() => Promise<void>) | undefined;

interface Graph {
  adminId: string;
  baseId: string;
  locationId: string;
  fishId: string;
  baitId: string;
  fingerprint: string;
}

async function createGraph(): Promise<Graph> {
  const admin = await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      nickname: 'Forum Import Admin',
      nicknameNormalized: 'forum import admin',
      passwordHash: 'not-a-real-password-hash',
      role: 'ADMIN',
    },
  });
  const base = await prisma.fishingBase.create({ data: normalizeCatalogName('Импорт-база') });
  const location = await prisma.location.create({
    data: {
      fishingBaseId: base.id,
      number: 1,
      ...normalizeCatalogName('Импорт-локация'),
    },
  });
  const fish = await prisma.fish.create({ data: normalizeCatalogName('Импорт-рыба') });
  const bait = await prisma.bait.create({
    data: { ...normalizeCatalogName('Импорт-наживка'), type: 'BAIT' },
  });
  await prisma.fishingBaseFish.create({
    data: { fishingBaseId: base.id, fishId: fish.id },
  });
  const snapshot = await loadCatalogSnapshot(prisma);
  return {
    adminId: admin.id,
    baseId: base.id,
    locationId: location.id,
    fishId: fish.id,
    baitId: bait.id,
    fingerprint: snapshot.fingerprint,
  };
}

function completeCandidate(
  graph: Graph,
  ordinal: number,
  overrides: Partial<StagingCandidate> = {},
): StagingCandidate {
  return {
    contributorKey: deriveExternalContributorKey(String(100 + ordinal)),
    importKey: deriveExternalImportKey('9001', ordinal),
    fishNameRaw: 'Импорт-рыба',
    weightGrams: 750 + ordinal,
    fishingBaseRaw: 'Импорт-база',
    locationRaw: 'Импорт-локация',
    baitRaw: 'Импорт-наживка',
    fishingMethod: 'BAIT_FISHING',
    holeDepthCm: 1_200 + ordinal,
    spotPositionRaw: 'лев. край снастей',
    fishingNote: 'FROM_BOTTOM',
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: `заметка ${String(ordinal)}`,
    resolution: {
      fish: { status: 'RESOLVED', reason: null, id: graph.fishId, name: 'Импорт-рыба' },
      fishingBase: {
        status: 'RESOLVED',
        reason: null,
        id: graph.baseId,
        name: 'Импорт-база',
      },
      location: {
        status: 'RESOLVED',
        reason: null,
        id: graph.locationId,
        name: 'Импорт-локация',
        number: 1,
      },
      bait: {
        status: 'RESOLVED',
        reason: null,
        id: graph.baitId,
        name: 'Импорт-наживка',
        type: 'BAIT',
      },
      fishingBaseFish: { status: 'RESOLVED' },
    },
    status: 'USABLE_COMPLETE',
    issues: [],
    ...overrides,
  };
}

function stagingBundle(
  fingerprint: string,
  candidates: StagingCandidate[],
): VerifiedForumStagingBundle {
  return {
    manifest: {
      version: 1,
      catalogSnapshotFingerprint: fingerprint,
      candidatesCount: candidates.length,
      files: [],
    },
    candidates,
  };
}

void describe(
  'rus-fishsoft COMPLETE candidate import (PostgreSQL e2e)',
  { concurrency: false },
  () => {
    void before(async () => {
      databaseConfiguration = getTestDatabaseConfiguration(process.env);
      prisma = new PrismaClient({
        adapter: createPrismaAdapter(databaseConfiguration.testDatabaseUrl),
      });
      clearDatabase = async () => {
        await clearTestData(databaseConfiguration, {
          truncateActivityEvents: () =>
            prisma.$executeRawUnsafe('TRUNCATE TABLE "ActivityEvent" RESTART IDENTITY'),
          deleteCatchReports: async () => prisma.catchReport.deleteMany(),
          deleteFishingBaseFish: async () => prisma.fishingBaseFish.deleteMany(),
          deleteLocations: async () => prisma.location.deleteMany(),
          deleteFishingBases: async () => prisma.fishingBase.deleteMany(),
          deleteFish: async () => prisma.fish.deleteMany(),
          deleteBaits: async () => prisma.bait.deleteMany(),
          deleteScreenAnchors: async () => prisma.screenAnchor.deleteMany(),
          deleteSessions: async () => prisma.session.deleteMany(),
          deleteUsers: async () => prisma.user.deleteMany(),
        });
      };
      await clearDatabase();
    });

    void beforeEach(async () => {
      assert.ok(clearDatabase);
      await clearDatabase();
    });

    void after(async () => {
      try {
        await clearDatabase?.();
      } finally {
        await prisma.$disconnect();
      }
    });

    void test('dry-runs, imports only COMPLETE, preserves external identities, and reruns with zero inserts', async () => {
      const graph = await createGraph();
      const complete = completeCandidate(graph, 1);
      const partial = completeCandidate(graph, 2, {
        weightGrams: null,
        status: 'USABLE_PARTIAL',
        issues: [{ code: 'MISSING_WEIGHT_GRAMS', field: 'weightGrams' }],
      });
      const unresolved = completeCandidate(graph, 3, {
        contributorKey: null,
        status: 'UNRESOLVED',
        issues: [{ code: 'MISSING_EXTERNAL_MEMBER_ID', field: 'contributorKey' }],
      });
      const bundle = stagingBundle(graph.fingerprint, [complete, partial, unresolved]);

      const dryRun = await importCompleteForumCandidates(prisma, {
        adminEmail: ` ${ADMIN_EMAIL.toUpperCase()} `,
        dryRun: true,
        bundle,
      });
      assert.deepEqual(dryRun, {
        dryRun: true,
        totalCandidates: 3,
        completeCandidates: 1,
        partialPreserved: 1,
        unresolvedPreserved: 1,
        validationFailed: 0,
        conflicts: 0,
        alreadyPresent: 0,
        wouldInsert: 1,
        inserted: 0,
      });
      assert.equal(await prisma.catchReport.count(), 0);

      const imported = await importCompleteForumCandidates(prisma, {
        adminEmail: ADMIN_EMAIL,
        dryRun: false,
        bundle,
      });
      assert.equal(imported.wouldInsert, 1);
      assert.equal(imported.inserted, 1);
      assert.equal(imported.partialPreserved, 1);
      assert.equal(imported.unresolvedPreserved, 1);

      const stored = await prisma.catchReport.findUniqueOrThrow({
        where: { importKey: complete.importKey },
        select: {
          userId: true,
          contributorKey: true,
          importKey: true,
          locationId: true,
          fishId: true,
          baitId: true,
          weightGrams: true,
          fishingMethod: true,
          holeDepthCm: true,
          spotPositionRaw: true,
          fishingNote: true,
          spinningSize: true,
          spinningSpeed: true,
          userNoteRaw: true,
          rawSourceText: true,
        },
      });
      assert.deepEqual(stored, {
        userId: graph.adminId,
        contributorKey: complete.contributorKey,
        importKey: complete.importKey,
        locationId: graph.locationId,
        fishId: graph.fishId,
        baitId: graph.baitId,
        weightGrams: complete.weightGrams,
        fishingMethod: complete.fishingMethod,
        holeDepthCm: complete.holeDepthCm,
        spotPositionRaw: complete.spotPositionRaw,
        fishingNote: complete.fishingNote,
        spinningSize: null,
        spinningSpeed: null,
        userNoteRaw: complete.userNoteRaw,
        rawSourceText: null,
      });
      assert.equal(await prisma.user.count(), 1);

      const repeated = await importCompleteForumCandidates(prisma, {
        adminEmail: ADMIN_EMAIL,
        dryRun: false,
        bundle,
      });
      assert.equal(repeated.alreadyPresent, 1);
      assert.equal(repeated.wouldInsert, 0);
      assert.equal(repeated.inserted, 0);
      assert.equal(await prisma.catchReport.count(), 1);
    });

    void test('keeps a previously imported COMPLETE candidate alreadyPresent after accepted Fish UUID lineage recovery', async () => {
      const graph = await createGraph();
      const previousSnapshot = await loadCatalogSnapshot(prisma);
      const previousCandidate = completeCandidate(graph, 1);
      await importCompleteForumCandidates(prisma, {
        adminEmail: ADMIN_EMAIL,
        dryRun: false,
        bundle: stagingBundle(previousSnapshot.fingerprint, [previousCandidate]),
      });

      const post: TechnicalForumPost = {
        subforumId: '70',
        topicId: '700',
        postId: '9001',
        memberId: '101',
        topicTitle: 'Импорт-рыба',
        bodyText: 'Импорт-рыба 751 г. Поймана на Импорт-база: Импорт-локация, Импорт-наживка.',
      };
      const parsed: ParsedForumCandidate = {
        contributorKey: previousCandidate.contributorKey,
        importKey: previousCandidate.importKey,
        candidateOrdinal: 1,
        fishNameRaw: previousCandidate.fishNameRaw,
        weightGrams: previousCandidate.weightGrams,
        fishingBaseRaw: previousCandidate.fishingBaseRaw,
        locationRaw: previousCandidate.locationRaw,
        baitRaw: previousCandidate.baitRaw,
        fishingMethod: null,
        holeDepthCm: previousCandidate.holeDepthCm,
        spotPositionRaw: previousCandidate.spotPositionRaw,
        fishingNote: previousCandidate.fishingNote,
        spinningSize: previousCandidate.spinningSize,
        spinningSpeed: previousCandidate.spinningSpeed,
        userNoteRaw: previousCandidate.userNoteRaw,
        issues: [],
        technical: {
          subforumId: post.subforumId,
          topicId: post.topicId,
          postId: post.postId,
          sourceRange: {
            startOffset: 0,
            endOffset: post.bodyText.length,
            startLine: 1,
            endLine: 1,
          },
          sourceText: post.bodyText,
          supplementarySourceRanges: [],
        },
      };
      const identities = buildCandidateIdentityManifest('all-parent-69', [post], [parsed]);
      const canonicalName = 'Импорт-рыба каноническая';
      const fishReconciliation: FishReconciliationManifest = {
        schemaVersion: 2,
        mode: 'APPLY_READY',
        sourceCatalogFingerprint: previousSnapshot.fingerprint,
        entries: [
          {
            category: 'EXPLICIT_RENAME',
            currentFishId: graph.fishId,
            currentName: 'Импорт-рыба',
            currentIsActive: true,
            topicId: post.topicId,
            canonicalName,
            preservesFishId: true,
            decision: 'RENAME',
            reason: 'test accepted UUID lineage',
          },
        ],
      };
      await prisma.fish.update({
        where: { id: graph.fishId },
        data: normalizeCatalogName(canonicalName),
      });
      const currentSnapshot = await loadCatalogSnapshot(prisma);
      const recovered = recoverForumFishCatalogCandidates({
        scopeKey: 'all-parent-69',
        pinnedIdentities: identities,
        currentIdentities: structuredClone(identities),
        parsedCandidates: [parsed],
        previousStaging: stagingBundle(previousSnapshot.fingerprint, [previousCandidate]),
        previousCatalogSnapshot: previousSnapshot,
        currentCatalogSnapshot: currentSnapshot,
        fishReconciliation,
      });
      const artifacts = buildStagingArtifacts(recovered.candidates, currentSnapshot.fingerprint);

      const dryRun = await importCompleteForumCandidates(prisma, {
        adminEmail: ADMIN_EMAIL,
        dryRun: true,
        bundle: { manifest: artifacts.manifest, candidates: artifacts.candidates },
      });

      assert.equal(recovered.summary.candidates.previousCompleteRegressions, 0);
      assert.equal(recovered.summary.lineage.fallbackCandidates, 1);
      assert.equal(dryRun.alreadyPresent, 1);
      assert.equal(dryRun.wouldInsert, 0);
      assert.equal(dryRun.conflicts, 0);
      assert.equal(await prisma.catchReport.count(), 1);
    });

    void test('counts only COMPLETE domain failures as validationFailed and writes nothing', async () => {
      const graph = await createGraph();
      const invalidComplete = completeCandidate(graph, 1, { holeDepthCm: 0 });
      const partial = completeCandidate(graph, 2, {
        weightGrams: null,
        status: 'USABLE_PARTIAL',
        issues: [{ code: 'MISSING_WEIGHT_GRAMS', field: 'weightGrams' }],
      });
      const bundle = stagingBundle(graph.fingerprint, [invalidComplete, partial]);

      await assert.rejects(
        importCompleteForumCandidates(prisma, {
          adminEmail: ADMIN_EMAIL,
          dryRun: false,
          bundle,
        }),
        (error: unknown) => {
          assert.ok(error instanceof ForumCompleteImportError);
          assert.equal(error.code, 'VALIDATION_FAILED');
          assert.equal(error.summary?.validationFailed, 1);
          assert.equal(error.summary?.partialPreserved, 1);
          assert.equal(error.summary?.unresolvedPreserved, 0);
          return true;
        },
      );
      assert.equal(await prisma.catchReport.count(), 0);
    });

    void test('fails on differing existing content and rolls back every missing candidate', async () => {
      const graph = await createGraph();
      const first = completeCandidate(graph, 1);
      const second = completeCandidate(graph, 2);
      await importCompleteForumCandidates(prisma, {
        adminEmail: ADMIN_EMAIL,
        dryRun: false,
        bundle: stagingBundle(graph.fingerprint, [first]),
      });
      await prisma.catchReport.update({
        where: { importKey: first.importKey },
        data: { weightGrams: 9_999 },
      });

      await assert.rejects(
        importCompleteForumCandidates(prisma, {
          adminEmail: ADMIN_EMAIL,
          dryRun: false,
          bundle: stagingBundle(graph.fingerprint, [first, second]),
        }),
        (error: unknown) => {
          assert.ok(error instanceof ForumCompleteImportError);
          assert.equal(error.code, 'IMPORT_CONFLICT');
          assert.equal(error.summary?.conflicts, 1);
          assert.equal(error.summary?.wouldInsert, 1);
          assert.ok(error.details[0]?.includes('weightGrams'));
          return true;
        },
      );
      assert.equal(await prisma.catchReport.count(), 1);
      assert.equal(
        (
          await prisma.catchReport.findUniqueOrThrow({
            where: { importKey: first.importKey },
            select: { weightGrams: true },
          })
        ).weightGrams,
        9_999,
      );
      assert.equal(await prisma.catchReport.count({ where: { importKey: second.importKey } }), 0);
    });

    void test('blocks an invalid admin and catalog drift before writing', async () => {
      const graph = await createGraph();
      const bundle = stagingBundle(graph.fingerprint, [completeCandidate(graph, 1)]);

      await assert.rejects(
        importCompleteForumCandidates(prisma, {
          adminEmail: 'missing-forum-admin@example.ru',
          dryRun: false,
          bundle,
        }),
        (error: unknown) =>
          error instanceof ForumCompleteImportError && error.code === 'ADMIN_ACCOUNT_INVALID',
      );

      await prisma.user.update({
        where: { id: graph.adminId },
        data: { isBanned: true },
      });
      await assert.rejects(
        importCompleteForumCandidates(prisma, {
          adminEmail: ADMIN_EMAIL,
          dryRun: false,
          bundle,
        }),
        (error: unknown) =>
          error instanceof ForumCompleteImportError && error.code === 'ADMIN_ACCOUNT_INVALID',
      );
      await prisma.user.update({
        where: { id: graph.adminId },
        data: { isBanned: false },
      });
      await prisma.fish.create({ data: normalizeCatalogName('Каталог изменён после staging') });
      await assert.rejects(
        importCompleteForumCandidates(prisma, {
          adminEmail: ADMIN_EMAIL,
          dryRun: false,
          bundle,
        }),
        (error: unknown) =>
          error instanceof ForumCompleteImportError &&
          error.code === 'CATALOG_FINGERPRINT_MISMATCH',
      );
      assert.equal(await prisma.catchReport.count(), 0);
    });
  },
);
