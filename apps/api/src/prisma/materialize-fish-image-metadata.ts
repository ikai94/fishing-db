import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { ForumFishIdentity } from './fish-catalog-audit.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import {
  buildFishImageMaterializationPlan,
  fingerprintProtectedRows,
  type FishImageMaterializationPlan,
  type FishImageReconciliationManifest,
  type LiveFishImageMetadataRow,
} from './fish-image-metadata-materialization.js';
import {
  validateFishImageMetadataManifest,
  type FishImageMetadataManifest,
} from './fish-image-metadata.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const CATALOG_LOCK =
  'LOCK TABLE "Fish", "FishingBaseFish", "CatchReport" IN SHARE ROW EXCLUSIVE MODE';
const MANIFEST_PATHS = {
  images: 'apps/api/prisma/catalog-data/fish-image-metadata.json',
  reconciliation: 'apps/api/prisma/catalog-data/fish-reconciliation.json',
  forum: 'apps/api/prisma/catalog-data/forum69-fish.json',
} as const;

interface ForumManifest {
  fish: ForumFishIdentity[];
}

interface TrackedFile<T> {
  parsed: T;
  content: string;
  hash: string;
}

interface FishImageSchemaInspection {
  ready: boolean;
  issues: string[];
}

interface LiveMaterializationState {
  schema: FishImageSchemaInspection;
  fish: LiveFishImageMetadataRow[];
  protectedState: {
    fishFingerprint: string;
    fishingBaseFishFingerprint: string;
    catchReportsFingerprint: string;
    fishingBaseFishCount: number;
    catchReportsCount: number;
  };
}

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

async function readTrackedJson<T>(
  repositoryPath: string,
  fileName: string,
): Promise<TrackedFile<T>> {
  execFileSync('git', ['ls-files', '--error-unmatch', '--', repositoryPath], {
    cwd: REPOSITORY_ROOT,
    stdio: 'pipe',
  });
  const content = await readFile(new URL(fileName, CATALOG_DATA), 'utf8');
  const indexed = execFileSync('git', ['show', `:${repositoryPath}`], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (indexed !== content)
    throw new Error(`materialization input differs from Git index: ${repositoryPath}`);
  return { parsed: JSON.parse(content) as T, content, hash: sha256(content) };
}

function decodeForumManifest(value: unknown): ForumManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('fish' in value) ||
    !Array.isArray(value.fish)
  ) {
    throw new Error('forum69-fish.json is not a valid forum Fish manifest');
  }
  return value as ForumManifest;
}

function decodeReconciliationManifest(value: unknown): FishImageReconciliationManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    typeof value.schemaVersion !== 'number' ||
    !('mode' in value) ||
    typeof value.mode !== 'string' ||
    !('entries' in value) ||
    !Array.isArray(value.entries)
  ) {
    throw new Error('fish-reconciliation.json is not a valid Fish reconciliation manifest');
  }
  return value as FishImageReconciliationManifest;
}

async function inspectFishImageSchema(
  transaction: Prisma.TransactionClient,
): Promise<FishImageSchemaInspection> {
  const columns = await transaction.$queryRaw<
    Array<{
      columnName: string;
      dataType: string;
      characterMaximumLength: number | null;
      isNullable: 'NO' | 'YES';
    }>
  >`
    SELECT
      column_name AS "columnName",
      data_type AS "dataType",
      character_maximum_length AS "characterMaximumLength",
      is_nullable AS "isNullable"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Fish'
      AND column_name IN ('forumTopicId', 'officialFishImageKey')
    ORDER BY column_name
  `;
  const indexes = await transaction.$queryRaw<
    Array<{ indexName: string; isUnique: boolean; isValid: boolean }>
  >`
    SELECT
      index_class.relname AS "indexName",
      index_row.indisunique AS "isUnique",
      index_row.indisvalid AS "isValid"
    FROM pg_index AS index_row
    JOIN pg_class AS table_class ON table_class.oid = index_row.indrelid
    JOIN pg_namespace AS namespace ON namespace.oid = table_class.relnamespace
    JOIN pg_class AS index_class ON index_class.oid = index_row.indexrelid
    WHERE namespace.nspname = current_schema()
      AND table_class.relname = 'Fish'
      AND index_class.relname IN ('Fish_forumTopicId_key', 'Fish_officialFishImageKey_key')
    ORDER BY index_class.relname
  `;
  const constraints = await transaction.$queryRaw<
    Array<{ constraintName: string; isValidated: boolean }>
  >`
    SELECT
      constraint_name AS "constraintName",
      convalidated AS "isValidated"
    FROM pg_constraint
    JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    JOIN information_schema.table_constraints
      ON table_constraints.constraint_schema = pg_namespace.nspname
      AND table_constraints.table_name = pg_class.relname
      AND table_constraints.constraint_name = pg_constraint.conname
    WHERE pg_namespace.nspname = current_schema()
      AND pg_class.relname = 'Fish'
      AND constraint_name = 'Fish_officialFishImageKey_positive_check'
  `;

  const expectedColumns = [
    {
      columnName: 'forumTopicId',
      dataType: 'character varying',
      characterMaximumLength: 32,
      isNullable: 'YES' as const,
    },
    {
      columnName: 'officialFishImageKey',
      dataType: 'integer',
      characterMaximumLength: null,
      isNullable: 'YES' as const,
    },
  ];
  const expectedIndexNames = ['Fish_forumTopicId_key', 'Fish_officialFishImageKey_key'];
  const issues = [
    ...(stableJson(columns) === stableJson(expectedColumns)
      ? []
      : ['Fish image metadata columns do not match the migration']),
    ...(indexes.length === 2 &&
    indexes.every(
      (index, position) =>
        index.indexName === expectedIndexNames[position] && index.isUnique && index.isValid,
    )
      ? []
      : ['Fish image metadata unique indexes do not match the migration']),
    ...(constraints.length === 1 && constraints[0]?.isValidated
      ? []
      : ['Fish official image key positive constraint is absent or unvalidated']),
  ];
  return { ready: issues.length === 0, issues };
}

async function readLiveState(
  transaction: Prisma.TransactionClient,
): Promise<LiveMaterializationState> {
  const schema = await inspectFishImageSchema(transaction);
  let fish: LiveFishImageMetadataRow[];
  if (schema.ready) {
    fish = await transaction.fish.findMany({
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        isActive: true,
        forumTopicId: true,
        officialFishImageKey: true,
      },
      orderBy: { id: 'asc' },
    });
  } else {
    const legacyFish = await transaction.fish.findMany({
      select: { id: true, name: true, nameNormalized: true, isActive: true },
      orderBy: { id: 'asc' },
    });
    fish = legacyFish.map((row) => ({
      ...row,
      forumTopicId: null,
      officialFishImageKey: null,
    }));
  }

  const [protectedFish, fishingBaseFish, catchReports] = await Promise.all([
    transaction.fish.findMany({
      select: { id: true, name: true, nameNormalized: true, isActive: true },
      orderBy: { id: 'asc' },
    }),
    transaction.fishingBaseFish.findMany({
      select: { fishingBaseId: true, fishId: true, createdAt: true },
      orderBy: [{ fishingBaseId: 'asc' }, { fishId: 'asc' }],
    }),
    transaction.catchReport.findMany({
      select: {
        id: true,
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
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);

  return {
    schema,
    fish,
    protectedState: {
      fishFingerprint: fingerprintProtectedRows(protectedFish),
      fishingBaseFishFingerprint: fingerprintProtectedRows(fishingBaseFish),
      catchReportsFingerprint: fingerprintProtectedRows(catchReports),
      fishingBaseFishCount: fishingBaseFish.length,
      catchReportsCount: catchReports.length,
    },
  };
}

function buildPlan(
  state: LiveMaterializationState,
  manifests: {
    imageManifest: FishImageMetadataManifest;
    reconciliationManifest: FishImageReconciliationManifest;
    forumManifest: ForumManifest;
    hashes: {
      fishImageManifestSha256: string;
      fishReconciliationManifestSha256: string;
      forumManifestSha256: string;
    };
  },
): FishImageMaterializationPlan {
  return buildFishImageMaterializationPlan({
    sources: manifests.hashes,
    imageManifest: manifests.imageManifest,
    reconciliationManifest: manifests.reconciliationManifest,
    forumFish: manifests.forumManifest.fish,
    liveFish: state.fish,
    protectedState: state.protectedState,
  });
}

function outputSummary(
  mode: Command['mode'],
  plan: FishImageMaterializationPlan,
  schema: FishImageSchemaInspection,
  writesPerformed: boolean,
): string {
  const blockers = [
    ...plan.blockers,
    ...(schema.ready ? [] : ['Fish image metadata migration is not applied exactly']),
  ];
  return stableJson({
    mode,
    writesPerformed,
    counts: plan.counts,
    planFingerprint: plan.planFingerprint,
    preservation: plan.preservation,
    migration: schema,
    blockers,
    networkUsed: false,
    imageBinariesDownloaded: false,
    imageHotlinkingEnabled: false,
  });
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const [imageFile, reconciliationFile, forumFile] = await Promise.all([
    readTrackedJson<unknown>(MANIFEST_PATHS.images, 'fish-image-metadata.json'),
    readTrackedJson<unknown>(MANIFEST_PATHS.reconciliation, 'fish-reconciliation.json'),
    readTrackedJson<unknown>(MANIFEST_PATHS.forum, 'forum69-fish.json'),
  ]);
  const forumManifest = decodeForumManifest(forumFile.parsed);
  const reconciliationManifest = decodeReconciliationManifest(reconciliationFile.parsed);
  const imageManifest = validateFishImageMetadataManifest(imageFile.parsed, forumManifest.fish);
  const manifests = {
    imageManifest,
    reconciliationManifest,
    forumManifest,
    hashes: {
      fishImageManifestSha256: imageFile.hash,
      fishReconciliationManifestSha256: reconciliationFile.hash,
      forumManifestSha256: forumFile.hash,
    },
  };
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    if (command.mode === 'DRY_RUN') {
      const { state, plan } = await prisma.$transaction(
        async (transaction) => {
          const state = await readLiveState(transaction);
          return { state, plan: buildPlan(state, manifests) };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 5_000,
          timeout: 120_000,
        },
      );
      process.stdout.write(outputSummary(command.mode, plan, state.schema, false));
      return;
    }

    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(CATALOG_LOCK);
        const before = await readLiveState(transaction);
        const plan = buildPlan(before, manifests);
        const applyBlockers = [
          ...plan.blockers,
          ...before.schema.issues,
          ...(plan.planFingerprint === command.expectedPlanFingerprint
            ? []
            : [
                `plan fingerprint is ${plan.planFingerprint}; expected ${command.expectedPlanFingerprint}`,
              ]),
        ];
        if (applyBlockers.length > 0) {
          throw new Error(`Fish image metadata apply refused:\n- ${applyBlockers.join('\n- ')}`);
        }

        for (const change of plan.changes) {
          await transaction.fish.update({
            where: { id: change.fishId },
            data: {
              forumTopicId: change.after.forumTopicId,
              officialFishImageKey: change.after.officialFishImageKey,
            },
          });
        }

        const after = await readLiveState(transaction);
        const postPlan = buildPlan(after, manifests);
        const preservationIssues = [
          ...(after.protectedState.fishFingerprint === before.protectedState.fishFingerprint
            ? []
            : ['Fish IDs/names/isActive fingerprint changed']),
          ...(after.protectedState.fishingBaseFishFingerprint ===
          before.protectedState.fishingBaseFishFingerprint
            ? []
            : ['FishingBaseFish fingerprint changed']),
          ...(after.protectedState.catchReportsFingerprint ===
          before.protectedState.catchReportsFingerprint
            ? []
            : ['CatchReport fingerprint changed']),
          ...(postPlan.blockers.length === 0 ? [] : postPlan.blockers),
          ...(postPlan.counts.writes === 0 ? [] : ['poststate is not idempotent']),
        ];
        if (preservationIssues.length > 0) {
          throw new Error(
            `Fish image metadata poststate refused:\n- ${preservationIssues.join('\n- ')}`,
          );
        }
        return { before, plan, postPlan };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    process.stdout.write(
      outputSummary(
        command.mode,
        result.plan,
        result.before.schema,
        result.plan.changes.length > 0,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish image metadata materialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
