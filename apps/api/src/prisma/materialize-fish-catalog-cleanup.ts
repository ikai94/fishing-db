import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import {
  buildFishCatalogCleanupPlan,
  validateFishCatalogCleanupManifest,
  type FishCatalogCleanupManifest,
} from './fish-catalog-cleanup.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MANIFEST_PATH = 'apps/api/prisma/catalog-data/fish-catalog-cleanup-20260909.json';
const MANIFEST_URL = new URL('../../prisma/catalog-data/fish-catalog-cleanup-20260909.json', import.meta.url);
const CATALOG_LOCK =
  'LOCK TABLE "Fish", "FishingBaseFish", "CatchReport", "ActivityEvent" IN SHARE ROW EXCLUSIVE MODE';

type Command = { mode: 'DRY_RUN' } | { mode: 'APPLY'; expectedPlanFingerprint: string };

function parseCommand(arguments_: readonly string[]): Command {
  if (arguments_.length === 1 && arguments_[0] === '--dry-run') return { mode: 'DRY_RUN' };
  const prefix = '--expected-plan-fingerprint=';
  if (arguments_.length === 2 && arguments_[0] === '--apply' && arguments_[1]?.startsWith(prefix)) {
    const expectedPlanFingerprint = arguments_[1].slice(prefix.length);
    if (/^[a-f0-9]{64}$/u.test(expectedPlanFingerprint)) {
      return { mode: 'APPLY', expectedPlanFingerprint };
    }
  }
  throw new Error(
    'usage: --dry-run OR --apply --expected-plan-fingerprint=<64-character lowercase SHA-256>',
  );
}

async function readTrackedManifest(): Promise<{ manifest: FishCatalogCleanupManifest; hash: string }> {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', MANIFEST_PATH], {
    cwd: REPOSITORY_ROOT,
    stdio: 'pipe',
  });
  const content = await readFile(MANIFEST_URL, 'utf8');
  const indexed = execFileSync('git', ['show', `:${MANIFEST_PATH}`], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (indexed !== content) throw new Error(`${MANIFEST_PATH} differs from the Git index`);
  return {
    manifest: validateFishCatalogCleanupManifest(JSON.parse(content) as unknown),
    hash: sha256(content),
  };
}

async function readPlan(
  transaction: Prisma.TransactionClient,
  manifest: FishCatalogCleanupManifest,
  manifestSha256: string,
) {
  const liveRows = await transaction.fish.findMany({
    where: { name: { in: manifest.fish } },
    select: {
      id: true,
      name: true,
      _count: { select: { catchReports: true, fishingBaseLinks: true } },
    },
    orderBy: { name: 'asc' },
  });
  return buildFishCatalogCleanupPlan({
    manifest,
    manifestSha256,
    liveRows: liveRows.map((row) => ({
      id: row.id,
      name: row.name,
      catchReports: row._count.catchReports,
      baseFishLinks: row._count.fishingBaseLinks,
    })),
  });
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const { manifest, hash } = await readTrackedManifest();
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(CATALOG_LOCK);
        const [plan, catchReportsBefore, activityEventsBefore] = await Promise.all([
          readPlan(transaction, manifest, hash),
          transaction.catchReport.count(),
          transaction.activityEvent.count(),
        ]);
        if (command.mode === 'DRY_RUN') {
          return { plan, catchReportsBefore, activityEventsBefore, applied: false };
        }
        const applyBlockers = [
          ...plan.blockers,
          ...(plan.planFingerprint === command.expectedPlanFingerprint
            ? []
            : [
                `plan fingerprint is ${plan.planFingerprint}; expected ${command.expectedPlanFingerprint}`,
              ]),
        ];
        if (applyBlockers.length > 0) {
          throw new Error(`Fish catalog cleanup apply refused:\n- ${applyBlockers.join('\n- ')}`);
        }

        const deleteEntries = plan.entries.filter((entry) => entry.outcome === 'DELETE');
        const deleteIds = deleteEntries.map((entry) => entry.id);
        const deletedLinks = await transaction.fishingBaseFish.deleteMany({
          where: { fishId: { in: deleteIds } },
        });
        const deletedFish = await transaction.fish.deleteMany({ where: { id: { in: deleteIds } } });
        if (
          deletedLinks.count !== plan.counts.deleteBaseFishLinks ||
          deletedFish.count !== plan.counts.deleteFish
        ) {
          throw new Error('Fish catalog cleanup write counts differ from the reviewed plan');
        }

        const [catchReportsAfter, activityEventsAfter, postPlan] = await Promise.all([
          transaction.catchReport.count(),
          transaction.activityEvent.count(),
          readPlan(transaction, manifest, hash),
        ]);
        if (
          catchReportsAfter !== catchReportsBefore ||
          activityEventsAfter !== activityEventsBefore ||
          postPlan.blockers.length > 0 ||
          postPlan.counts.deleteFish !== 0
        ) {
          throw new Error('Fish catalog cleanup poststate or protected history changed');
        }
        return { plan, catchReportsBefore, activityEventsBefore, applied: true };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 120_000,
      },
    );

    process.stdout.write(
      stableJson({
        mode: command.mode,
        writesPerformed: result.applied && result.plan.counts.deleteFish > 0,
        manifestSha256: hash,
        planFingerprint: result.plan.planFingerprint,
        counts: result.plan.counts,
        entries: result.plan.entries,
        alreadyAbsent: result.plan.alreadyAbsent,
        blockers: result.plan.blockers,
        preservation: {
          catchReports: result.catchReportsBefore,
          activityEvents: result.activityEventsBefore,
          unchanged: true,
        },
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish catalog cleanup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
