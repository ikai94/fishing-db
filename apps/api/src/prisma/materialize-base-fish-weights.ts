import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { BaseFishWeightApplyReadyManifest } from './base-fish-weight-apply-ready.js';
import {
  buildBaseFishWeightMaterializationPlan,
  type BaseFishWeightMaterializationPlan,
  type BaseFishWeightProtectedState,
  type LiveBaseFishWeightMembership,
} from './base-fish-weight-materialization.js';
import { sha256, stableJson } from './fish-catalog-audit.js';
import { createPrismaAdapter } from './prisma-adapter.js';

export const ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256 =
  'c36b13cb186632a5017f9d63e7f3a1b082539d7323c4b423f267f42598ad161a';

const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const MANIFEST = new URL('fishing-base-fish-weights.json', CATALOG_DATA);
const MATERIALIZATION_LOCK =
  'LOCK TABLE "FishingBase", "Fish", "FishingBaseFish" IN SHARE ROW EXCLUSIVE MODE';
const EXPECTED_TARGET_COUNT = 3_596;

export type BaseFishWeightMaterializationCommand =
  { mode: 'DRY_RUN' } | { mode: 'APPLY'; expectedPlanFingerprint: string };

interface BaseFishWeightSchemaInspection {
  ready: boolean;
  issues: string[];
}

interface LiveBaseFishWeightState {
  schema: BaseFishWeightSchemaInspection;
  memberships: LiveBaseFishWeightMembership[];
  protectedState: BaseFishWeightProtectedState;
}

export function parseBaseFishWeightMaterializationCommand(
  arguments_: readonly string[],
): BaseFishWeightMaterializationCommand {
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

function decodeManifest(value: unknown): BaseFishWeightApplyReadyManifest {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    value.schemaVersion !== 1 ||
    !('mode' in value) ||
    value.mode !== 'APPLY_READY' ||
    !('entries' in value) ||
    !Array.isArray(value.entries) ||
    !('counts' in value) ||
    typeof value.counts !== 'object' ||
    value.counts === null ||
    !('unresolvedBlockers' in value) ||
    !Array.isArray(value.unresolvedBlockers)
  ) {
    throw new Error('fishing-base-fish-weights.json is not a valid APPLY_READY manifest');
  }
  return value as BaseFishWeightApplyReadyManifest;
}

async function readAcceptedManifest(): Promise<{
  manifest: BaseFishWeightApplyReadyManifest;
  hash: string;
}> {
  const content = await readFile(MANIFEST, 'utf8');
  const hash = sha256(content);
  if (hash !== ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256) {
    throw new Error(
      `BaseFish weight manifest SHA-256 is ${hash}; expected ${ACCEPTED_BASE_FISH_WEIGHT_MANIFEST_SHA256}`,
    );
  }
  const manifest = decodeManifest(JSON.parse(content) as unknown);
  if (content !== stableJson(manifest)) {
    throw new Error('BaseFish weight manifest formatting is not deterministic');
  }
  return { manifest, hash };
}

async function inspectSchema(
  transaction: Prisma.TransactionClient,
): Promise<BaseFishWeightSchemaInspection> {
  const columns = await transaction.$queryRaw<
    Array<{ columnName: string; dataType: string; isNullable: 'NO' | 'YES' }>
  >`
    SELECT
      column_name AS "columnName",
      data_type AS "dataType",
      is_nullable AS "isNullable"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'FishingBaseFish'
      AND column_name IN ('minWeightGrams', 'maxWeightGrams')
    ORDER BY column_name
  `;
  const constraints = await transaction.$queryRaw<
    Array<{ constraintName: string; isValidated: boolean }>
  >`
    SELECT conname AS "constraintName", convalidated AS "isValidated"
    FROM pg_constraint
    JOIN pg_class ON pg_class.oid = pg_constraint.conrelid
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = current_schema()
      AND pg_class.relname = 'FishingBaseFish'
      AND conname IN (
        'FishingBaseFish_minWeightGrams_positive_check',
        'FishingBaseFish_maxWeightGrams_positive_check',
        'FishingBaseFish_weight_bounds_order_check'
      )
    ORDER BY conname
  `;
  const expectedColumns = [
    { columnName: 'maxWeightGrams', dataType: 'integer', isNullable: 'YES' },
    { columnName: 'minWeightGrams', dataType: 'integer', isNullable: 'YES' },
  ];
  const expectedConstraints = [
    'FishingBaseFish_maxWeightGrams_positive_check',
    'FishingBaseFish_minWeightGrams_positive_check',
    'FishingBaseFish_weight_bounds_order_check',
  ];
  const issues = [
    ...(stableJson(columns) === stableJson(expectedColumns)
      ? []
      : ['FishingBaseFish weight columns do not match the migration']),
    ...(constraints.length === expectedConstraints.length &&
    constraints.every(
      (constraint, index) =>
        constraint.constraintName === expectedConstraints[index] && constraint.isValidated,
    )
      ? []
      : ['FishingBaseFish weight constraints are absent or unvalidated']),
  ];
  return { ready: issues.length === 0, issues };
}

function fingerprint(rows: readonly unknown[]): string {
  return sha256(stableJson(rows));
}

async function readLiveState(
  transaction: Prisma.TransactionClient,
): Promise<LiveBaseFishWeightState> {
  const schema = await inspectSchema(transaction);
  if (!schema.ready) {
    return {
      schema,
      memberships: [],
      protectedState: {
        basesCount: 0,
        fishCount: 0,
        membershipsCount: 0,
        basesFingerprint: fingerprint([]),
        fishFingerprint: fingerprint([]),
        membershipIdentitiesFingerprint: fingerprint([]),
      },
    };
  }

  const [bases, fish, membershipRows] = await Promise.all([
    transaction.fishingBase.findMany({
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    transaction.fish.findMany({
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        forumTopicId: true,
        officialFishImageKey: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    transaction.fishingBaseFish.findMany({
      select: {
        fishingBaseId: true,
        fishId: true,
        minWeightGrams: true,
        maxWeightGrams: true,
        createdAt: true,
        fishingBase: { select: { name: true } },
        fish: { select: { name: true, forumTopicId: true } },
      },
      orderBy: [{ fishingBaseId: 'asc' }, { fishId: 'asc' }],
    }),
  ]);
  const membershipIdentities = membershipRows.map((membership) => ({
    fishingBaseId: membership.fishingBaseId,
    fishId: membership.fishId,
    createdAt: membership.createdAt,
  }));
  const memberships = membershipRows.map((membership) => ({
    fishingBaseId: membership.fishingBaseId,
    baseName: membership.fishingBase.name,
    fishId: membership.fishId,
    fishName: membership.fish.name,
    forumTopicId: membership.fish.forumTopicId,
    minWeightGrams: membership.minWeightGrams,
    maxWeightGrams: membership.maxWeightGrams,
  }));
  return {
    schema,
    memberships,
    protectedState: {
      basesCount: bases.length,
      fishCount: fish.length,
      membershipsCount: membershipRows.length,
      basesFingerprint: fingerprint(bases),
      fishFingerprint: fingerprint(fish),
      membershipIdentitiesFingerprint: fingerprint(membershipIdentities),
    },
  };
}

function buildPlan(
  state: LiveBaseFishWeightState,
  manifest: BaseFishWeightApplyReadyManifest,
  manifestSha256: string,
): BaseFishWeightMaterializationPlan {
  return buildBaseFishWeightMaterializationPlan({
    manifest,
    manifestSha256,
    liveMemberships: state.memberships,
    protectedState: state.protectedState,
    expectedTargetCount: EXPECTED_TARGET_COUNT,
  });
}

function outputSummary(
  command: BaseFishWeightMaterializationCommand,
  plan: BaseFishWeightMaterializationPlan,
  schema: BaseFishWeightSchemaInspection,
  writesPerformed: boolean,
): string {
  return stableJson({
    mode: command.mode,
    writesPerformed,
    manifestSha256: plan.manifestSha256,
    counts: plan.counts,
    planFingerprint: plan.planFingerprint,
    migration: schema,
    preservation: plan.preservation,
    blockers: [...plan.blockers, ...schema.issues],
  });
}

async function run(): Promise<void> {
  const command = parseBaseFishWeightMaterializationCommand(process.argv.slice(2));
  const accepted = await readAcceptedManifest();
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    if (command.mode === 'DRY_RUN') {
      const { state, plan } = await prisma.$transaction(
        async (transaction) => {
          const state = await readLiveState(transaction);
          return { state, plan: buildPlan(state, accepted.manifest, accepted.hash) };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          maxWait: 5_000,
          timeout: 120_000,
        },
      );
      process.stdout.write(outputSummary(command, plan, state.schema, false));
      return;
    }

    const result = await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRawUnsafe(MATERIALIZATION_LOCK);
        const before = await readLiveState(transaction);
        const plan = buildPlan(before, accepted.manifest, accepted.hash);
        const applyBlockers = [
          ...before.schema.issues,
          ...plan.blockers,
          ...(plan.planFingerprint === command.expectedPlanFingerprint
            ? []
            : [
                `plan fingerprint is ${plan.planFingerprint}; expected ${command.expectedPlanFingerprint}`,
              ]),
        ];
        if (applyBlockers.length > 0) {
          throw new Error(`BaseFish weight apply refused:\n- ${applyBlockers.join('\n- ')}`);
        }

        for (const change of plan.changes) {
          await transaction.fishingBaseFish.update({
            where: {
              fishingBaseId_fishId: {
                fishingBaseId: change.fishingBaseId,
                fishId: change.fishId,
              },
            },
            data: {
              minWeightGrams: change.after.minWeightGrams,
              maxWeightGrams: change.after.maxWeightGrams,
            },
          });
        }

        const after = await readLiveState(transaction);
        const postPlan = buildPlan(after, accepted.manifest, accepted.hash);
        const preservationIssues = [
          ...(after.protectedState.basesFingerprint === before.protectedState.basesFingerprint
            ? []
            : ['FishingBase fingerprint changed']),
          ...(after.protectedState.fishFingerprint === before.protectedState.fishFingerprint
            ? []
            : ['Fish fingerprint changed']),
          ...(after.protectedState.membershipIdentitiesFingerprint ===
          before.protectedState.membershipIdentitiesFingerprint
            ? []
            : ['FishingBaseFish identity fingerprint changed']),
          ...(after.protectedState.membershipsCount === before.protectedState.membershipsCount
            ? []
            : ['FishingBaseFish count changed']),
          ...postPlan.blockers,
          ...(postPlan.counts.plannedFieldChanges === 0
            ? []
            : ['materialized poststate is not idempotent']),
        ];
        if (preservationIssues.length > 0) {
          throw new Error(
            `BaseFish weight poststate refused:\n- ${preservationIssues.join('\n- ')}`,
          );
        }
        return { before, plan };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 120_000,
      },
    );
    process.stdout.write(
      outputSummary(command, result.plan, result.before.schema, result.plan.changes.length > 0),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `BaseFish weight materialization failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
