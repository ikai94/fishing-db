import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  AUTHORITATIVE_CATALOG_COUNTS,
  AUTHORITATIVE_FISHING_BASE_FISH_TARGET_SHA256,
  AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256,
  FISHING_BASE_FISH_MANIFEST,
} from './catalog-seed-data.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const RECONCILIATION_LOCK = `LOCK TABLE
  "FishingBase", "Fish", "Location", "Bait", "User", "FishingBaseFish", "CatchReport"
  IN SHARE ROW EXCLUSIVE MODE`;
const DELETE_CHUNK_SIZE = 500;

export const APPROVED_RECONCILIATION_PRE_STATE = {
  currentMemberships: 5_369,
  keep: 3_203,
  add: 27,
  remove: 2_166,
  currentCatchReports: 3_355,
  validCatchReports: 3_194,
  invalidImportedCatchReports: 161,
  invalidNativeCatchReports: 0,
  finalCatchReports: 3_194,
} as const;

interface CatalogIdentityRow {
  id: string;
  name: string;
}

interface MembershipRow {
  fishingBaseId: string;
  fishId: string;
}

type ReconciliationDatabase = Pick<
  Prisma.TransactionClient,
  'fishingBase' | 'fish' | 'fishingBaseFish' | 'catchReport'
>;

interface ReconciliationPlan {
  preStateFingerprint: string;
  currentMemberships: number;
  keepPairs: MembershipRow[];
  addPairs: MembershipRow[];
  removePairs: MembershipRow[];
  currentCatchReports: number;
  validCatchReports: number;
  invalidImportedIds: string[];
  invalidNativeIds: string[];
}

export interface FishingBaseFishReconciliationSummary {
  mode: 'dry-run' | 'apply';
  manifest: {
    sourceWorkbook: string;
    workbookSha256: string;
    targetSha256: string;
    targetMemberships: number;
  };
  preStateFingerprint: string;
  memberships: {
    current: number;
    keep: number;
    add: number;
    remove: number;
    expectedFinal: number;
  };
  catchReports: {
    current: number;
    valid: number;
    invalidImported: number;
    invalidNative: number;
    expectedFinal: number;
  };
  writesPerformed: boolean;
}

export class FishingBaseFishReconciliationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`FishingBaseFish reconciliation refused:\n- ${issues.join('\n- ')}`);
    this.name = 'FishingBaseFishReconciliationError';
  }
}

function pairKey(pair: MembershipRow): string {
  return `${pair.fishingBaseId}:${pair.fishId}`;
}

function sortPairs(pairs: MembershipRow[]): MembershipRow[] {
  return pairs.sort((left, right) => pairKey(left).localeCompare(pairKey(right)));
}

function indexExactNames(rows: CatalogIdentityRow[], kind: 'FishingBase' | 'Fish') {
  const byName = new Map<string, CatalogIdentityRow>();
  const duplicateNames: string[] = [];

  for (const row of rows) {
    if (byName.has(row.name)) duplicateNames.push(row.name);
    else byName.set(row.name, row);
  }

  if (duplicateNames.length > 0) {
    throw new FishingBaseFishReconciliationError([
      `${kind} has duplicate exact names: ${duplicateNames.sort().join(', ')}`,
    ]);
  }

  return byName;
}

async function verifyLocalWorkbook(): Promise<void> {
  const workbookUrl = new URL('../../.local/catalog/Klevalka-2026.xlsx', import.meta.url);
  let workbook: Buffer;

  try {
    workbook = await readFile(workbookUrl);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown read error';
    throw new FishingBaseFishReconciliationError([
      `cannot read approved local workbook ${workbookUrl.pathname}: ${detail}`,
    ]);
  }

  const observedHash = createHash('sha256').update(workbook).digest('hex');
  if (observedHash !== AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256) {
    throw new FishingBaseFishReconciliationError([
      `local workbook SHA-256 is ${observedHash}, expected ${AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256}`,
    ]);
  }
}

async function buildPlan(database: ReconciliationDatabase): Promise<ReconciliationPlan> {
  // Keep these sequential: an interactive Prisma transaction owns one pg client.
  const bases = await database.fishingBase.findMany({ select: { id: true, name: true } });
  const fish = await database.fish.findMany({ select: { id: true, name: true } });
  const currentMemberships = await database.fishingBaseFish.findMany({
    select: { fishingBaseId: true, fishId: true },
  });
  const catchReports = await database.catchReport.findMany({
    select: {
      id: true,
      fishId: true,
      importKey: true,
      location: { select: { fishingBaseId: true } },
    },
  });
  const baseByName = indexExactNames(bases, 'FishingBase');
  const fishByName = indexExactNames(fish, 'Fish');
  const identityIssues: string[] = [];
  const targetPairs: MembershipRow[] = [];

  for (const base of FISHING_BASE_FISH_MANIFEST.bases) {
    const liveBase = baseByName.get(base.name);
    if (liveBase === undefined) {
      identityIssues.push(`canonical FishingBase is absent from the live database: "${base.name}"`);
      continue;
    }

    for (const fishName of base.fish) {
      const liveFish = fishByName.get(fishName);
      if (liveFish === undefined) {
        identityIssues.push(`canonical Fish is absent from the live database: "${fishName}"`);
        continue;
      }
      targetPairs.push({ fishingBaseId: liveBase.id, fishId: liveFish.id });
    }
  }

  if (identityIssues.length > 0) {
    throw new FishingBaseFishReconciliationError(identityIssues);
  }

  const targetByKey = new Map(targetPairs.map((pair) => [pairKey(pair), pair] as const));
  const currentByKey = new Map(currentMemberships.map((pair) => [pairKey(pair), pair] as const));
  const keepPairs = sortPairs(targetPairs.filter((pair) => currentByKey.has(pairKey(pair))));
  const addPairs = sortPairs(targetPairs.filter((pair) => !currentByKey.has(pairKey(pair))));
  const removePairs = sortPairs(
    currentMemberships.filter((pair) => !targetByKey.has(pairKey(pair))),
  );
  const invalidImportedIds: string[] = [];
  const invalidNativeIds: string[] = [];

  for (const report of catchReports) {
    const key = pairKey({
      fishingBaseId: report.location.fishingBaseId,
      fishId: report.fishId,
    });
    if (!targetByKey.has(key)) {
      (report.importKey === null ? invalidNativeIds : invalidImportedIds).push(report.id);
    }
  }

  invalidImportedIds.sort();
  invalidNativeIds.sort();
  const fingerprintPayload = {
    targetSha256: AUTHORITATIVE_FISHING_BASE_FISH_TARGET_SHA256,
    bases: bases.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)),
    fish: fish.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)),
    memberships: sortPairs([...currentMemberships]),
    catchReports: catchReports
      .map((report) => ({
        id: report.id,
        fishingBaseId: report.location.fishingBaseId,
        fishId: report.fishId,
        imported: report.importKey !== null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  return {
    preStateFingerprint: createHash('sha256')
      .update(JSON.stringify(fingerprintPayload))
      .digest('hex'),
    currentMemberships: currentMemberships.length,
    keepPairs,
    addPairs,
    removePairs,
    currentCatchReports: catchReports.length,
    validCatchReports: catchReports.length - invalidImportedIds.length - invalidNativeIds.length,
    invalidImportedIds,
    invalidNativeIds,
  };
}

function assertApprovedPreState(plan: ReconciliationPlan): void {
  const expected = APPROVED_RECONCILIATION_PRE_STATE;
  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ['current FishingBaseFish', plan.currentMemberships, expected.currentMemberships],
    ['keep FishingBaseFish', plan.keepPairs.length, expected.keep],
    ['add FishingBaseFish', plan.addPairs.length, expected.add],
    ['remove FishingBaseFish', plan.removePairs.length, expected.remove],
    ['current CatchReport', plan.currentCatchReports, expected.currentCatchReports],
    ['valid CatchReport', plan.validCatchReports, expected.validCatchReports],
    [
      'invalid imported CatchReport',
      plan.invalidImportedIds.length,
      expected.invalidImportedCatchReports,
    ],
    [
      'invalid native CatchReport',
      plan.invalidNativeIds.length,
      expected.invalidNativeCatchReports,
    ],
  ];
  const issues = checks
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(([label, actual, wanted]) => `${label}: expected ${wanted}, received ${actual}`);

  if (issues.length > 0) throw new FishingBaseFishReconciliationError(issues);
}

function isApprovedPostState(plan: ReconciliationPlan): boolean {
  return (
    plan.currentMemberships === AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish &&
    plan.keepPairs.length === AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish &&
    plan.addPairs.length === 0 &&
    plan.removePairs.length === 0 &&
    plan.currentCatchReports === APPROVED_RECONCILIATION_PRE_STATE.finalCatchReports &&
    plan.validCatchReports === APPROVED_RECONCILIATION_PRE_STATE.finalCatchReports &&
    plan.invalidImportedIds.length === 0 &&
    plan.invalidNativeIds.length === 0
  );
}

function assertApprovedDryRunState(plan: ReconciliationPlan): void {
  if (isApprovedPostState(plan)) return;
  assertApprovedPreState(plan);
}

function toSummary(
  mode: 'dry-run' | 'apply',
  plan: ReconciliationPlan,
): FishingBaseFishReconciliationSummary {
  return {
    mode,
    manifest: {
      sourceWorkbook: FISHING_BASE_FISH_MANIFEST.sourceWorkbook.fileName,
      workbookSha256: AUTHORITATIVE_FISHING_BASE_FISH_WORKBOOK_SHA256,
      targetSha256: AUTHORITATIVE_FISHING_BASE_FISH_TARGET_SHA256,
      targetMemberships: AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish,
    },
    preStateFingerprint: plan.preStateFingerprint,
    memberships: {
      current: plan.currentMemberships,
      keep: plan.keepPairs.length,
      add: plan.addPairs.length,
      remove: plan.removePairs.length,
      expectedFinal: plan.currentMemberships + plan.addPairs.length - plan.removePairs.length,
    },
    catchReports: {
      current: plan.currentCatchReports,
      valid: plan.validCatchReports,
      invalidImported: plan.invalidImportedIds.length,
      invalidNative: plan.invalidNativeIds.length,
      expectedFinal:
        plan.currentCatchReports - plan.invalidImportedIds.length - plan.invalidNativeIds.length,
    },
    writesPerformed: mode === 'apply',
  };
}

export async function auditFishingBaseFishReconciliation(
  prisma: PrismaClient,
): Promise<FishingBaseFishReconciliationSummary> {
  await verifyLocalWorkbook();
  const plan = await buildPlan(prisma);
  assertApprovedDryRunState(plan);
  return toSummary('dry-run', plan);
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += DELETE_CHUNK_SIZE) {
    result.push(values.slice(index, index + DELETE_CHUNK_SIZE));
  }
  return result;
}

async function deleteCatchReports(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<number> {
  let deleted = 0;
  for (const idChunk of chunks(ids)) {
    const result = await tx.catchReport.deleteMany({ where: { id: { in: idChunk } } });
    deleted += result.count;
  }
  return deleted;
}

async function deleteMemberships(
  tx: Prisma.TransactionClient,
  pairs: readonly MembershipRow[],
): Promise<number> {
  let deleted = 0;
  for (const pairChunk of chunks(pairs)) {
    const result = await tx.fishingBaseFish.deleteMany({
      where: {
        OR: pairChunk.map(({ fishingBaseId, fishId }) => ({ fishingBaseId, fishId })),
      },
    });
    deleted += result.count;
  }
  return deleted;
}

export async function applyFishingBaseFishReconciliation(
  prisma: PrismaClient,
  expectedPreStateFingerprint: string,
): Promise<FishingBaseFishReconciliationSummary> {
  await verifyLocalWorkbook();
  if (!/^[a-f0-9]{64}$/u.test(expectedPreStateFingerprint)) {
    throw new FishingBaseFishReconciliationError([
      '--expected-fingerprint must be the 64-character SHA-256 printed by --dry-run',
    ]);
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(RECONCILIATION_LOCK);
      const plan = await buildPlan(tx);
      assertApprovedPreState(plan);
      if (plan.preStateFingerprint !== expectedPreStateFingerprint) {
        throw new FishingBaseFishReconciliationError([
          `live pre-state fingerprint is ${plan.preStateFingerprint}, but apply expected ${expectedPreStateFingerprint}`,
        ]);
      }

      const untouchedBefore = [
        await tx.fish.count(),
        await tx.fishingBase.count(),
        await tx.location.count(),
        await tx.bait.count(),
        await tx.user.count(),
      ];
      const added = await tx.fishingBaseFish.createMany({ data: plan.addPairs });
      const deletedImported = await deleteCatchReports(tx, plan.invalidImportedIds);
      const deletedNative = await deleteCatchReports(tx, plan.invalidNativeIds);
      const removed = await deleteMemberships(tx, plan.removePairs);

      const mutationIssues: string[] = [];
      if (added.count !== plan.addPairs.length) {
        mutationIssues.push(`added ${added.count} memberships, expected ${plan.addPairs.length}`);
      }
      if (deletedImported !== plan.invalidImportedIds.length) {
        mutationIssues.push(
          `deleted ${deletedImported} imported reports, expected ${plan.invalidImportedIds.length}`,
        );
      }
      if (deletedNative !== plan.invalidNativeIds.length) {
        mutationIssues.push(
          `deleted ${deletedNative} native reports, expected ${plan.invalidNativeIds.length}`,
        );
      }
      if (removed !== plan.removePairs.length) {
        mutationIssues.push(`removed ${removed} memberships, expected ${plan.removePairs.length}`);
      }
      if (mutationIssues.length > 0) {
        throw new FishingBaseFishReconciliationError(mutationIssues);
      }

      const postPlan = await buildPlan(tx);
      const untouchedAfter = [
        await tx.fish.count(),
        await tx.fishingBase.count(),
        await tx.location.count(),
        await tx.bait.count(),
        await tx.user.count(),
      ];
      const finalIssues: string[] = [];

      if (postPlan.currentMemberships !== AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish) {
        finalIssues.push(
          `final FishingBaseFish count is ${postPlan.currentMemberships}, expected ${AUTHORITATIVE_CATALOG_COUNTS.fishingBaseFish}`,
        );
      }
      if (postPlan.addPairs.length !== 0 || postPlan.removePairs.length !== 0) {
        finalIssues.push(
          `final membership delta is add=${postPlan.addPairs.length}, remove=${postPlan.removePairs.length}`,
        );
      }
      if (postPlan.invalidImportedIds.length !== 0 || postPlan.invalidNativeIds.length !== 0) {
        finalIssues.push(
          `final invalid CatchReport split is imported=${postPlan.invalidImportedIds.length}, native=${postPlan.invalidNativeIds.length}`,
        );
      }
      if (postPlan.currentCatchReports !== APPROVED_RECONCILIATION_PRE_STATE.finalCatchReports) {
        finalIssues.push(
          `final CatchReport count is ${postPlan.currentCatchReports}, expected ${APPROVED_RECONCILIATION_PRE_STATE.finalCatchReports}`,
        );
      }
      if (untouchedAfter.some((count, index) => count !== untouchedBefore[index])) {
        finalIssues.push('Fish/Base/Location/Bait/User counts changed during reconciliation');
      }
      if (finalIssues.length > 0) throw new FishingBaseFishReconciliationError(finalIssues);

      return toSummary('apply', plan);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
}

interface ReconciliationCliOptions {
  mode: 'dry-run' | 'apply';
  expectedFingerprint?: string;
}

export function parseReconciliationCliOptions(args: readonly string[]): ReconciliationCliOptions {
  if (args.length === 1 && args[0] === '--dry-run') return { mode: 'dry-run' };
  if (args[0] === '--apply' && args.length === 2) {
    const match = /^--expected-fingerprint=([a-f0-9]{64})$/u.exec(args[1] ?? '');
    if (match?.[1] !== undefined) {
      return { mode: 'apply', expectedFingerprint: match[1] };
    }
  }

  throw new FishingBaseFishReconciliationError([
    'usage: --dry-run OR --apply --expected-fingerprint=<SHA-256 from dry-run>',
  ]);
}

export async function runFishingBaseFishReconciliation(
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<FishingBaseFishReconciliationSummary> {
  const options = parseReconciliationCliOptions(args);
  const databaseUrl = environment.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const summary =
      options.mode === 'dry-run'
        ? await auditFishingBaseFishReconciliation(prisma)
        : await applyFishingBaseFishReconciliation(prisma, options.expectedFingerprint as string);
    console.info(JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runFishingBaseFishReconciliation().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
    console.error(message);
    process.exitCode = 1;
  });
}
