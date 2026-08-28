import 'dotenv/config';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { loadCatalogSnapshot } from '../forum-import/catalog-source.js';
import {
  normalizeAuditName,
  stableJson,
  type FishReconciliationEntry,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';
import {
  buildFishCatalogApplyDryRun,
  type FishCatalogDryRunInput,
} from './dry-run-fish-catalog-reconciliation.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const APPROVED_PLAN_FINGERPRINT =
  '033818c93315d4146ec61044808ab291e844e9ed08e5912fc62b8e5dd52addb2';
const APPROVED_POSTSTATE_FINGERPRINT =
  'be773c5b7651bb0f2031d173cb5333cb799a8cd122a40efdf25cc6d40dd59a65';
const APPROVED_DB_FINGERPRINT = 'ae3ba16deaa3a9ff6e0161b56848fa9981ff4a79285cf0ec555a7f562728d782';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const MANIFEST_PATHS = {
  fish: 'apps/api/prisma/catalog-data/fish-reconciliation.json',
  workbook: 'apps/api/prisma/catalog-data/fishing-base-fish-reconciliation.json',
  forum: 'apps/api/prisma/catalog-data/forum69-fish.json',
  listFish: 'apps/api/prisma/catalog-data/list-fish-metadata.json',
} as const;
const CATALOG_LOCK = `LOCK TABLE
  "FishingBase", "Location", "Fish", "Bait", "FishingBaseFish", "CatchReport"
  IN SHARE ROW EXCLUSIVE MODE`;

interface FishManifest {
  schemaVersion: number;
  mode: string;
  sourceCatalogFingerprint: string;
  entries: FishReconciliationEntry[];
}

interface WorkbookManifest {
  schemaVersion: number;
  mode: string;
  projectedMemberships: number;
  rows: WorkbookFishResolution[];
}

interface ForumManifest {
  fish: ForumFishIdentity[];
}

interface TrackedFile<T> {
  parsed: T;
  content: string;
  hash: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readTrackedJson<T>(
  repositoryPath: string,
  fileName: string,
): Promise<TrackedFile<T>> {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', repositoryPath], {
    cwd: REPOSITORY_ROOT,
    stdio: 'pipe',
  });
  try {
    execFileSync('git', ['check-ignore', '-q', '--', repositoryPath], {
      cwd: REPOSITORY_ROOT,
      stdio: 'pipe',
    });
    throw new Error(`apply input is ignored: ${repositoryPath}`);
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    if (status !== 1) throw error;
  }
  const content = await readFile(new URL(fileName, CATALOG_DATA), 'utf8');
  const indexed = execFileSync('git', ['show', `:${repositoryPath}`], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (indexed !== content) throw new Error(`apply input differs from Git index: ${repositoryPath}`);
  return { parsed: JSON.parse(content) as T, content, hash: sha256(content) };
}

function reportReferenceFingerprint(
  rows: readonly {
    id: string;
    userId: string;
    contributorKey: string;
    importKey: string | null;
    locationId: string;
    fishId: string;
    baitId: string;
  }[],
): string {
  return sha256(stableJson(rows));
}

async function run(): Promise<void> {
  const expectedArgument = `--expected-plan-fingerprint=${APPROVED_PLAN_FINGERPRINT}`;
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== expectedArgument) {
    throw new Error(`usage: ${expectedArgument}`);
  }
  const [fishFile, workbookFile, forumFile, listFishFile] = await Promise.all([
    readTrackedJson<FishManifest>(MANIFEST_PATHS.fish, 'fish-reconciliation.json'),
    readTrackedJson<WorkbookManifest>(
      MANIFEST_PATHS.workbook,
      'fishing-base-fish-reconciliation.json',
    ),
    readTrackedJson<ForumManifest>(MANIFEST_PATHS.forum, 'forum69-fish.json'),
    readTrackedJson<Record<string, unknown>>(MANIFEST_PATHS.listFish, 'list-fish-metadata.json'),
  ]);
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(CATALOG_LOCK);
        const beforeSnapshot = await loadCatalogSnapshot(transaction);
        const beforeReports = await transaction.catchReport.findMany({
          select: {
            id: true,
            userId: true,
            contributorKey: true,
            importKey: true,
            locationId: true,
            fishId: true,
            baitId: true,
          },
          orderBy: { id: 'asc' },
        });
        const dryRunInput: FishCatalogDryRunInput = {
          liveFingerprint: beforeSnapshot.fingerprint,
          fishManifestHash: fishFile.hash,
          workbookManifestHash: workbookFile.hash,
          forumManifestHash: forumFile.hash,
          listFishManifestHash: listFishFile.hash,
          fishManifest: fishFile.parsed,
          workbookManifest: workbookFile.parsed,
          forumFish: forumFile.parsed.fish,
          liveFish: beforeSnapshot.fish,
          liveBases: beforeSnapshot.fishingBases,
          liveMemberships: beforeSnapshot.memberships,
          liveReports: beforeReports.map(({ id, fishId }) => ({ id, fishId })),
        };
        const approvedPlan = buildFishCatalogApplyDryRun(dryRunInput);
        const preflightIssues = [
          ...approvedPlan.guards.blockers,
          ...(beforeSnapshot.fingerprint === APPROVED_DB_FINGERPRINT
            ? []
            : [`DB fingerprint is ${beforeSnapshot.fingerprint}`]),
          ...(approvedPlan.guards.planFingerprint === APPROVED_PLAN_FINGERPRINT
            ? []
            : [`plan fingerprint is ${approvedPlan.guards.planFingerprint}`]),
          ...(approvedPlan.guards.poststateFingerprint === APPROVED_POSTSTATE_FINGERPRINT
            ? []
            : [`projected poststate fingerprint is ${approvedPlan.guards.poststateFingerprint}`]),
        ];
        if (preflightIssues.length > 0) {
          throw new Error(`transactional preflight refused:\n- ${preflightIssues.join('\n- ')}`);
        }
        if (
          approvedPlan.fish.before !== 1_257 ||
          approvedPlan.fish.renames !== 92 ||
          approvedPlan.fish.creates !== 229 ||
          approvedPlan.fish.deactivations !== 3 ||
          approvedPlan.fish.repoints !== 2 ||
          approvedPlan.baseFish.before !== 3_230 ||
          approvedPlan.baseFish.add !== 366 ||
          approvedPlan.baseFish.remove !== 0 ||
          approvedPlan.catchReports.before !== 31_337
        ) {
          throw new Error('transactional plan counts differ from the approved plan');
        }

        const renameEntries = fishFile.parsed.entries.filter(
          (entry) => entry.decision === 'RENAME' && entry.currentFishId !== null,
        );
        for (const entry of renameEntries) {
          const temporaryName = `__fish_reconciliation__${entry.currentFishId as string}`;
          await transaction.fish.update({
            where: { id: entry.currentFishId as string },
            data: { name: temporaryName, nameNormalized: temporaryName },
          });
        }
        for (const entry of renameEntries) {
          await transaction.fish.update({
            where: { id: entry.currentFishId as string },
            data: {
              name: entry.canonicalName as string,
              nameNormalized: normalizeAuditName(entry.canonicalName as string),
            },
          });
        }

        const fishIdByTopic = new Map<string, string>();
        for (const entry of fishFile.parsed.entries) {
          if (
            entry.topicId !== null &&
            entry.category !== 'REPOINT_DEACTIVATE' &&
            entry.currentFishId !== null
          ) {
            fishIdByTopic.set(entry.topicId, entry.currentFishId);
          }
        }
        const createEntries = fishFile.parsed.entries.filter(
          (entry) => entry.decision === 'CREATE',
        );
        for (const entry of createEntries) {
          const created = await transaction.fish.create({
            data: {
              name: entry.canonicalName as string,
              nameNormalized: normalizeAuditName(entry.canonicalName as string),
              isActive: true,
            },
            select: { id: true },
          });
          fishIdByTopic.set(entry.topicId as string, created.id);
        }

        const repointEntries = fishFile.parsed.entries.filter(
          (entry) => entry.decision === 'REPOINT+DEACTIVATE',
        );
        for (const entry of repointEntries) {
          const sourceFishId = entry.currentFishId as string;
          const [reports, memberships] = await Promise.all([
            transaction.catchReport.count({ where: { fishId: sourceFishId } }),
            transaction.fishingBaseFish.count({ where: { fishId: sourceFishId } }),
          ]);
          if (reports !== 0 || memberships !== 0) {
            throw new Error(`approved zero-reference repoint gained references: ${sourceFishId}`);
          }
        }
        const deactivateEntries = fishFile.parsed.entries.filter(
          (entry) =>
            entry.currentFishId !== null && entry.targetIsActive === false && entry.currentIsActive,
        );
        for (const entry of deactivateEntries) {
          await transaction.fish.update({
            where: { id: entry.currentFishId as string },
            data: { isActive: false },
          });
        }

        const baseIdByName = new Map(
          beforeSnapshot.fishingBases.map((base) => [base.name, base.id] as const),
        );
        const targetMembershipByKey = new Map<string, { fishingBaseId: string; fishId: string }>();
        for (const row of workbookFile.parsed.rows) {
          if (row.topicId === null) continue;
          const fishingBaseId = baseIdByName.get(row.baseName);
          const fishId = fishIdByTopic.get(row.topicId);
          if (fishingBaseId === undefined || fishId === undefined) {
            throw new Error(`cannot resolve target membership: ${row.baseName}/${row.topicId}`);
          }
          targetMembershipByKey.set(`${fishingBaseId}\0${fishId}`, { fishingBaseId, fishId });
        }
        const currentMembershipKeys = new Set(
          beforeSnapshot.memberships.map((row) => `${row.fishingBaseId}\0${row.fishId}`),
        );
        const additions = [...targetMembershipByKey]
          .filter(([key]) => !currentMembershipKeys.has(key))
          .map(([, row]) => row);
        const removals = beforeSnapshot.memberships.filter(
          (row) => !targetMembershipByKey.has(`${row.fishingBaseId}\0${row.fishId}`),
        );
        if (additions.length !== 366 || removals.length !== 0) {
          throw new Error(
            `BaseFish mutation counts changed: add=${additions.length}, remove=${removals.length}`,
          );
        }
        await transaction.fishingBaseFish.createMany({ data: additions });

        const afterSnapshot = await loadCatalogSnapshot(transaction);
        const afterReports = await transaction.catchReport.findMany({
          select: {
            id: true,
            userId: true,
            contributorKey: true,
            importKey: true,
            locationId: true,
            fishId: true,
            baitId: true,
          },
          orderBy: { id: 'asc' },
        });
        const postDryRun = buildFishCatalogApplyDryRun({
          ...dryRunInput,
          liveFingerprint: afterSnapshot.fingerprint,
          liveFish: afterSnapshot.fish,
          liveBases: afterSnapshot.fishingBases,
          liveMemberships: afterSnapshot.memberships,
          liveReports: afterReports.map(({ id, fishId }) => ({ id, fishId })),
        });
        const activeNames = new Set(
          afterSnapshot.fish.filter((fish) => fish.isActive).map((fish) => fish.name),
        );
        const workbookAliasesInPublicCatalog = new Set(
          workbookFile.parsed.rows
            .filter(
              (row) =>
                row.topicId !== null &&
                row.canonicalName !== null &&
                row.rawName !== row.canonicalName &&
                activeNames.has(row.rawName),
            )
            .map((row) => row.rawName),
        );
        const postIssues = [
          ...postDryRun.guards.blockers,
          ...(postDryRun.guards.idempotencySecondPassWrites === 0
            ? []
            : ['poststate is not idempotent']),
          ...(postDryRun.guards.poststateFingerprint === APPROVED_POSTSTATE_FINGERPRINT
            ? []
            : [`poststate fingerprint is ${postDryRun.guards.poststateFingerprint}`]),
          ...(afterSnapshot.fish.length === 1_486
            ? []
            : [`Fish count is ${afterSnapshot.fish.length}`]),
          ...(afterSnapshot.memberships.length === 3_596
            ? []
            : [`BaseFish count is ${afterSnapshot.memberships.length}`]),
          ...(afterReports.length === 31_337
            ? []
            : [`CatchReport count is ${afterReports.length}`]),
          ...(reportReferenceFingerprint(beforeReports) === reportReferenceFingerprint(afterReports)
            ? []
            : ['CatchReport identities/FKs changed']),
          ...(workbookAliasesInPublicCatalog.size === 0
            ? []
            : [
                `workbook aliases remain public Fish names: ${[
                  ...workbookAliasesInPublicCatalog,
                ].join(', ')}`,
              ]),
        ];
        if (postIssues.length > 0) {
          throw new Error(`transactional poststate refused:\n- ${postIssues.join('\n- ')}`);
        }

        return {
          mode: 'APPLY',
          writesPerformed: true,
          planFingerprint: approvedPlan.guards.planFingerprint,
          poststateFingerprint: postDryRun.guards.poststateFingerprint,
          fish: {
            before: beforeSnapshot.fish.length,
            after: afterSnapshot.fish.length,
            renames: renameEntries.length,
            creates: createEntries.length,
            deactivations: deactivateEntries.length,
            repoints: repointEntries.length,
            deletes: 0,
          },
          baseFish: {
            before: beforeSnapshot.memberships.length,
            after: afterSnapshot.memberships.length,
            add: additions.length,
            remove: 0,
          },
          catchReports: {
            before: beforeReports.length,
            after: afterReports.length,
            repointed: 0,
            deleted: 0,
            referenceFingerprintUnchanged: true,
          },
          guards: {
            manual: 0,
            collisions: 0,
            fuzzyMappings: 0,
            publicWorkbookAliases: 0,
            poststateWrites: postDryRun.guards.idempotencySecondPassWrites,
          },
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    process.stdout.write(stableJson(result));
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish catalog apply failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
