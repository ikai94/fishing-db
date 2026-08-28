import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildFishCatalogApplyDryRun,
  type FishCatalogDryRunInput,
} from '../prisma/dry-run-fish-catalog-reconciliation.js';
import type { ForumFishIdentity, WorkbookFishResolution } from '../prisma/fish-catalog-audit.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import {
  buildCandidateIdentityManifest,
  type CandidateIdentityManifest,
} from './candidate-identity-manifest.js';
import { ForumLocalStore, readJsonFile, writeJsonAtomic } from './cache.js';
import { loadCatalogSnapshot, type CatalogSnapshot } from './catalog-source.js';
import type { ForumCliOptions } from './cli-options.js';
import {
  recoverForumFishCatalogCandidates,
  type FishReconciliationManifest,
  type ForumFishCatalogRecoverySummary,
} from './fish-catalog-recovery.js';
import { parseForumPost } from './forum-post-parser.js';
import { readTechnicalPosts, type TechnicalScanManifest } from './scanner.js';
import { getScopeKey, PARENT_FORUM_ID } from './scope.js';
import { buildStagingArtifacts, sha256Text, writeStagingFiles } from './staging.js';
import { readVerifiedForumStagingBundle } from './staging-reader.js';

const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
export const FISH_CATALOG_RECOVERY_DIRECTORY = 'recovery/fish-catalog';

const EXPECTED_RECOVERY = {
  candidates: 39_578,
  complete: 35_529,
  partial: 781,
  unresolved: 3_268,
  newlyComplete: 4_195,
  candidatesCsvSha256: '05b3c73cfc2121ed519c7e621dba4be0563dbadabea1b5e9f4b91bbe4950389f',
  candidatesJsonlSha256: '6397cc92813e4aa4e0f5f5919dc8d94cddc3f4d89ef42a3900c158367ef39f20',
} as const;

interface WorkbookManifest {
  schemaVersion: number;
  mode: string;
  projectedMemberships: number;
  rows: WorkbookFishResolution[];
}

interface ForumManifest {
  fish: ForumFishIdentity[];
}

interface TrackedJson<Value> {
  parsed: Value;
  hash: string;
}

export interface ForumFishCatalogRecoveryCliSummary extends ForumFishCatalogRecoverySummary {
  mode: 'FORUM69_FISH_CATALOG_RECOVERY';
  dryRun: boolean;
  writesPerformed: boolean;
  blockers: [];
  catalog: {
    sourceFingerprint: string;
    recoveredFingerprint: string;
    recognizedReconciliationPoststate: true;
    reconciliationBlockers: 0;
    baseFishAdds: 0;
    baseFishRemoves: 0;
  };
  inputs: {
    fishReconciliationSha256: string;
    fishingBaseFishReconciliationSha256: string;
    forumFishSha256: string;
    listFishMetadataSha256: string;
  };
  outputDirectory: string;
  files: Array<{ path: string; sha256: string }>;
  expectedCountsMatch: true;
  expectedHashesMatch: true;
}

export class ForumFishCatalogRecoveryRunnerError extends Error {
  readonly code = 'FORUM_FISH_CATALOG_RECOVERY_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'ForumFishCatalogRecoveryRunnerError';
  }
}

function blocked(message: string): never {
  throw new ForumFishCatalogRecoveryRunnerError(message);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readTrackedJson<Value>(name: string): Promise<TrackedJson<Value>> {
  const content = await readFile(new URL(name, CATALOG_DATA), 'utf8');
  return { parsed: JSON.parse(content) as Value, hash: sha256(content) };
}

async function readRequiredJson<Value>(path: string): Promise<Value> {
  const value = await readJsonFile<Value>(path);
  if (value === null) blocked(`Required cached recovery input is missing: ${path}`);
  return value;
}

function assertRecoveryScope(options: ForumCliOptions): void {
  if (
    options.scope.mode !== 'ALL' ||
    options.scope.parentForumId !== PARENT_FORUM_ID ||
    options.scope.limitPosts !== null
  ) {
    blocked('Fish-catalog recovery requires the complete cached --all forum69 scope');
  }
}

function assertScanManifest(manifest: TechnicalScanManifest, options: ForumCliOptions): void {
  if (
    manifest.version !== 1 ||
    manifest.parentForumId !== PARENT_FORUM_ID ||
    manifest.scopeKey !== getScopeKey(options.scope) ||
    JSON.stringify(manifest.scope) !== JSON.stringify(options.scope) ||
    !manifest.complete ||
    manifest.truncated ||
    !Array.isArray(manifest.postIds) ||
    !Array.isArray(manifest.sourceChangedPostIds) ||
    manifest.sourceChangedPostIds.length > 0
  ) {
    blocked('Frozen forum69 scan is incomplete, changed, truncated, or belongs to another scope');
  }
}

function assertAcceptedPoststate(result: ReturnType<typeof buildFishCatalogApplyDryRun>): void {
  if (
    result.guards.blockers.length !== 0 ||
    !result.guards.recognizedPoststate ||
    result.guards.fuzzyMatchingUsed ||
    result.guards.idempotencySecondPassWrites !== 0 ||
    result.fish.renames !== 0 ||
    result.fish.creates !== 0 ||
    result.fish.deactivations !== 0 ||
    result.fish.repoints !== 0 ||
    result.baseFish.add !== 0 ||
    result.baseFish.remove !== 0 ||
    result.catchReports.repointed !== 0
  ) {
    blocked('Live catalog is not the accepted idempotent Fish/BaseFish reconciliation poststate');
  }
}

function assertExpectedRecovery(
  summary: ForumFishCatalogRecoverySummary,
  files: ReadonlyMap<string, string>,
): void {
  const counts = summary.candidates.recovered;
  if (
    summary.candidates.total !== EXPECTED_RECOVERY.candidates ||
    counts.USABLE_COMPLETE !== EXPECTED_RECOVERY.complete ||
    counts.USABLE_PARTIAL !== EXPECTED_RECOVERY.partial ||
    counts.UNRESOLVED !== EXPECTED_RECOVERY.unresolved ||
    summary.candidates.newlyComplete !== EXPECTED_RECOVERY.newlyComplete ||
    summary.identity.identityDrift !== 0
  ) {
    blocked('Recovered candidate counts differ from the approved forum69 recovery');
  }
  if (
    files.get('candidates.csv') !== EXPECTED_RECOVERY.candidatesCsvSha256 ||
    files.get('candidates.jsonl') !== EXPECTED_RECOVERY.candidatesJsonlSha256
  ) {
    blocked('Recovered staging hashes differ from the approved forum69 recovery');
  }
}

export async function runForumFishCatalogRecovery(
  options: ForumCliOptions,
  store: ForumLocalStore,
  environment: NodeJS.ProcessEnv,
): Promise<ForumFishCatalogRecoveryCliSummary> {
  assertRecoveryScope(options);
  const scopeKey = getScopeKey(options.scope);
  const outputDirectory = store.outputDirectory(scopeKey);
  const scanManifest = await readRequiredJson<TechnicalScanManifest>(
    join(outputDirectory, 'technical', 'scan.json'),
  );
  assertScanManifest(scanManifest, options);

  const [
    posts,
    pinnedIdentities,
    previousStaging,
    previousCatalogSnapshot,
    fishFile,
    workbookFile,
    forumFile,
    listFishFile,
  ] = await Promise.all([
    readTechnicalPosts(store, scanManifest.postIds),
    readRequiredJson<CandidateIdentityManifest>(
      join(outputDirectory, 'technical', 'candidate-identities.json'),
    ),
    readVerifiedForumStagingBundle(join(outputDirectory, 'staging')),
    readRequiredJson<CatalogSnapshot>(join(outputDirectory, 'technical', 'catalog-snapshot.json')),
    readTrackedJson<FishReconciliationManifest>('fish-reconciliation.json'),
    readTrackedJson<WorkbookManifest>('fishing-base-fish-reconciliation.json'),
    readTrackedJson<ForumManifest>('forum69-fish.json'),
    readTrackedJson<Record<string, unknown>>('list-fish-metadata.json'),
  ]);
  const parsedCandidates = posts.flatMap((post) => parseForumPost(post));
  const currentIdentities = buildCandidateIdentityManifest(scopeKey, posts, parsedCandidates);

  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    blocked('DATABASE_URL is required for read-only recovery catalog resolution');
  }
  const { PrismaClient } = await import('../generated/prisma/client.js');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const live = await prisma.$transaction(
      async (transaction) => ({
        snapshot: await loadCatalogSnapshot(transaction),
        reports: await transaction.catchReport.findMany({
          select: { id: true, fishId: true },
          orderBy: { id: 'asc' },
        }),
      }),
      { isolationLevel: 'RepeatableRead' },
    );
    const dryRunInput: FishCatalogDryRunInput = {
      liveFingerprint: live.snapshot.fingerprint,
      fishManifestHash: fishFile.hash,
      workbookManifestHash: workbookFile.hash,
      forumManifestHash: forumFile.hash,
      listFishManifestHash: listFishFile.hash,
      fishManifest: fishFile.parsed,
      workbookManifest: workbookFile.parsed,
      forumFish: forumFile.parsed.fish,
      liveFish: live.snapshot.fish,
      liveBases: live.snapshot.fishingBases,
      liveMemberships: live.snapshot.memberships,
      liveReports: live.reports,
    };
    const reconciliationPoststate = buildFishCatalogApplyDryRun(dryRunInput);
    assertAcceptedPoststate(reconciliationPoststate);

    const recovery = recoverForumFishCatalogCandidates({
      scopeKey,
      pinnedIdentities,
      currentIdentities,
      parsedCandidates,
      previousStaging,
      previousCatalogSnapshot,
      currentCatalogSnapshot: live.snapshot,
      fishReconciliation: fishFile.parsed,
    });
    const staging = buildStagingArtifacts(recovery.candidates, live.snapshot.fingerprint);
    const stagingFiles = {
      'candidates.csv': staging.candidatesCsv,
      'candidates.jsonl': staging.candidatesJsonl,
      'manifest.json': staging.manifestJson,
    };
    const fileHashes = new Map(
      Object.entries(stagingFiles).map(([path, content]) => [path, sha256Text(content)] as const),
    );
    assertExpectedRecovery(recovery.summary, fileHashes);

    const recoveryRoot = join(outputDirectory, FISH_CATALOG_RECOVERY_DIRECTORY);
    const summary: ForumFishCatalogRecoveryCliSummary = {
      mode: 'FORUM69_FISH_CATALOG_RECOVERY',
      dryRun: options.dryRun,
      writesPerformed: !options.dryRun,
      blockers: [],
      ...recovery.summary,
      catalog: {
        sourceFingerprint: fishFile.parsed.sourceCatalogFingerprint,
        recoveredFingerprint: live.snapshot.fingerprint,
        recognizedReconciliationPoststate: true,
        reconciliationBlockers: 0,
        baseFishAdds: 0,
        baseFishRemoves: 0,
      },
      inputs: {
        fishReconciliationSha256: fishFile.hash,
        fishingBaseFishReconciliationSha256: workbookFile.hash,
        forumFishSha256: forumFile.hash,
        listFishMetadataSha256: listFishFile.hash,
      },
      outputDirectory: join(recoveryRoot, 'staging'),
      files: [...fileHashes]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, fileSha256]) => ({ path, sha256: fileSha256 })),
      expectedCountsMatch: true,
      expectedHashesMatch: true,
    };

    if (!options.dryRun) {
      await writeStagingFiles(join(recoveryRoot, 'staging'), stagingFiles);
      await writeJsonAtomic(join(recoveryRoot, 'audit', 'recovery.json'), summary);
      await writeJsonAtomic(
        join(recoveryRoot, 'technical', 'catalog-snapshot.json'),
        live.snapshot,
      );
    }
    return summary;
  } finally {
    await prisma.$disconnect();
  }
}
