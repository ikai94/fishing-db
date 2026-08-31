import 'dotenv/config';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { createPrismaAdapter } from '../../prisma/prisma-adapter.js';
import {
  FORUM83_REVIEWED_DECISIONS_SHA256,
  loadForum83ReviewedDecisions,
  type Forum83ReviewedPair,
} from './reviewed-decisions.js';

const RECONCILIATION_LOCK = `LOCK TABLE
  "FishingBase", "Fish", "FishingBaseFish"
  IN SHARE ROW EXCLUSIVE MODE`;

interface IdentityRow {
  id: string;
  name: string;
  isActive: boolean;
}

interface MembershipRow {
  fishingBaseId: string;
  fishId: string;
}

type ReconciliationDatabase = Pick<
  Prisma.TransactionClient,
  'fishingBase' | 'fish' | 'fishingBaseFish'
>;

interface ResolvedPair extends MembershipRow {
  baseName: string;
  fishName: string;
}

interface ReconciliationPlan {
  state: 'PRE_APPLY' | 'POST_APPLY';
  fingerprint: string;
  currentMemberships: number;
  additions: ResolvedPair[];
  existing: ResolvedPair[];
}

export interface Forum83BaseFishReconciliationSummary {
  mode: 'dry-run' | 'apply';
  state: ReconciliationPlan['state'];
  reviewedDecisionsSha256: string;
  preStateFingerprint: string;
  memberships: {
    current: number;
    add: number;
    alreadyPresent: number;
    expectedFinal: number;
  };
  writesPerformed: boolean;
}

export class Forum83BaseFishReconciliationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Forum83 BaseFish reconciliation refused:\n- ${issues.join('\n- ')}`);
    this.name = 'Forum83BaseFishReconciliationError';
  }
}

function pairKey(pair: MembershipRow): string {
  return `${pair.fishingBaseId}\0${pair.fishId}`;
}

function exactIndex(rows: readonly IdentityRow[], kind: string): Map<string, IdentityRow> {
  const result = new Map<string, IdentityRow>();
  const issues: string[] = [];
  for (const row of rows) {
    if (result.has(row.name)) issues.push(`${kind} exact name is duplicated: ${row.name}`);
    else result.set(row.name, row);
  }
  if (issues.length > 0) throw new Forum83BaseFishReconciliationError(issues);
  return result;
}

function resolvePair(
  pair: Forum83ReviewedPair,
  bases: Map<string, IdentityRow>,
  fish: Map<string, IdentityRow>,
  issues: string[],
): ResolvedPair | null {
  const base = bases.get(pair.baseName);
  const fishRow = fish.get(pair.fishName);
  if (base === undefined || !base.isActive) {
    issues.push(`exact active FishingBase is absent: ${pair.baseName}`);
  }
  if (fishRow === undefined || !fishRow.isActive) {
    issues.push(`exact active Fish is absent: ${pair.fishName}`);
  }
  if (base === undefined || !base.isActive || fishRow === undefined || !fishRow.isActive) {
    return null;
  }
  return {
    fishingBaseId: base.id,
    fishId: fishRow.id,
    baseName: base.name,
    fishName: fishRow.name,
  };
}

async function buildPlan(database: ReconciliationDatabase): Promise<ReconciliationPlan> {
  const decisions = loadForum83ReviewedDecisions();
  const baseRows = await database.fishingBase.findMany({
    select: { id: true, name: true, isActive: true },
  });
  const fishRows = await database.fish.findMany({
    select: { id: true, name: true, isActive: true },
  });
  const membershipRows = await database.fishingBaseFish.findMany({
    select: { fishingBaseId: true, fishId: true },
    orderBy: [{ fishingBaseId: 'asc' }, { fishId: 'asc' }],
  });
  const bases = exactIndex(baseRows, 'FishingBase');
  const fish = exactIndex(fishRows, 'Fish');
  const issues: string[] = [];
  const targetPairs = decisions.baseFishAdditions
    .map((pair) => resolvePair(pair, bases, fish, issues))
    .filter((pair): pair is ResolvedPair => pair !== null);
  const rejectedPairs = decisions.baseFishRejections
    .map((pair) => resolvePair(pair, bases, fish, issues))
    .filter((pair): pair is ResolvedPair => pair !== null);
  const fishMappingTargets = decisions.fishMappings
    .map(({ baseName, target }) => resolvePair({ baseName, fishName: target }, bases, fish, issues))
    .filter((pair): pair is ResolvedPair => pair !== null);
  if (issues.length > 0) throw new Forum83BaseFishReconciliationError(issues);

  const memberships = new Set(membershipRows.map(pairKey));
  for (const pair of rejectedPairs) {
    if (memberships.has(pairKey(pair))) {
      issues.push(`rejected BaseFish membership already exists: ${pair.baseName}/${pair.fishName}`);
    }
  }
  for (const pair of fishMappingTargets) {
    if (!memberships.has(pairKey(pair))) {
      issues.push(
        `reviewed Fish mapping target membership is absent: ${pair.baseName}/${pair.fishName}`,
      );
    }
  }
  const additions = targetPairs.filter((pair) => !memberships.has(pairKey(pair)));
  const existing = targetPairs.filter((pair) => memberships.has(pairKey(pair)));
  if (additions.length !== 7 && existing.length !== 7) {
    issues.push(
      `reviewed additions are in a mixed state: add=${String(additions.length)}, existing=${String(existing.length)}`,
    );
  }
  if (issues.length > 0) throw new Forum83BaseFishReconciliationError(issues);

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        reviewedDecisionsSha256: FORUM83_REVIEWED_DECISIONS_SHA256,
        bases: [...bases.values()].sort((left, right) => left.id.localeCompare(right.id)),
        fish: [...fish.values()].sort((left, right) => left.id.localeCompare(right.id)),
        memberships: membershipRows,
      }),
    )
    .digest('hex');
  return {
    state: additions.length === 7 ? 'PRE_APPLY' : 'POST_APPLY',
    fingerprint,
    currentMemberships: membershipRows.length,
    additions,
    existing,
  };
}

function summary(
  mode: 'dry-run' | 'apply',
  plan: ReconciliationPlan,
  writesPerformed: boolean,
): Forum83BaseFishReconciliationSummary {
  return {
    mode,
    state: plan.state,
    reviewedDecisionsSha256: FORUM83_REVIEWED_DECISIONS_SHA256,
    preStateFingerprint: plan.fingerprint,
    memberships: {
      current: plan.currentMemberships,
      add: plan.additions.length,
      alreadyPresent: plan.existing.length,
      expectedFinal: plan.currentMemberships + plan.additions.length,
    },
    writesPerformed,
  };
}

export async function auditForum83BaseFishReconciliation(
  prisma: PrismaClient,
): Promise<Forum83BaseFishReconciliationSummary> {
  const plan = await buildPlan(prisma);
  return summary('dry-run', plan, false);
}

export async function applyForum83BaseFishReconciliation(
  prisma: PrismaClient,
  expectedFingerprint: string,
): Promise<Forum83BaseFishReconciliationSummary> {
  if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
    throw new Forum83BaseFishReconciliationError([
      '--expected-fingerprint must be the SHA-256 printed by --dry-run',
    ]);
  }
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(RECONCILIATION_LOCK);
      const before = await buildPlan(transaction);
      if (before.state !== 'PRE_APPLY') {
        throw new Forum83BaseFishReconciliationError(['apply requires the exact PRE_APPLY state']);
      }
      if (before.fingerprint !== expectedFingerprint) {
        throw new Forum83BaseFishReconciliationError([
          `live fingerprint is ${before.fingerprint}, expected ${expectedFingerprint}`,
        ]);
      }
      const added = await transaction.fishingBaseFish.createMany({
        data: before.additions.map(({ fishingBaseId, fishId }) => ({ fishingBaseId, fishId })),
      });
      if (added.count !== 7) {
        throw new Forum83BaseFishReconciliationError([
          `created ${String(added.count)} memberships, expected 7`,
        ]);
      }
      const after = await buildPlan(transaction);
      if (
        after.state !== 'POST_APPLY' ||
        after.currentMemberships !== before.currentMemberships + 7
      ) {
        throw new Forum83BaseFishReconciliationError([
          `post-state is ${after.state} with ${String(after.currentMemberships)} memberships`,
        ]);
      }
      return summary('apply', before, true);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

interface CliOptions {
  mode: 'dry-run' | 'apply';
  expectedFingerprint?: string;
}

export function parseForum83BaseFishReconciliationOptions(args: readonly string[]): CliOptions {
  const values = args[0] === '--' ? args.slice(1) : args;
  if (values.length === 1 && values[0] === '--dry-run') return { mode: 'dry-run' };
  if (values.length === 2 && values[0] === '--apply') {
    const match = /^--expected-fingerprint=([a-f0-9]{64})$/u.exec(values[1] ?? '');
    if (match?.[1] !== undefined) {
      return { mode: 'apply', expectedFingerprint: match[1] };
    }
  }
  throw new Forum83BaseFishReconciliationError([
    'usage: --dry-run OR --apply --expected-fingerprint=<SHA-256 from dry-run>',
  ]);
}

export async function runForum83BaseFishReconciliation(
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Forum83BaseFishReconciliationSummary> {
  const options = parseForum83BaseFishReconciliationOptions(args);
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const result =
      options.mode === 'dry-run'
        ? await auditForum83BaseFishReconciliation(prisma)
        : await applyForum83BaseFishReconciliation(prisma, options.expectedFingerprint as string);
    console.info(JSON.stringify(result, null, 2));
    return result;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runForum83BaseFishReconciliation().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown forum83 reconciliation error';
    console.error(message);
    process.exitCode = 1;
  });
}
