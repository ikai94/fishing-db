import 'dotenv/config';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import {
  buildForumImportAudit,
  buildForumReviewBundle,
  type ForumCrawlCounters,
  type ForumImportAudit,
  type ForumReviewBundle,
} from './audit.js';
import {
  assertCandidateIdentityStable,
  buildPreImportCandidateIdentityRebase,
  buildCandidateIdentityManifest,
  CandidateIdentityDriftError,
  type CandidateIdentityRebase,
  type CandidateIdentityManifest,
} from './candidate-identity-manifest.js';
import { ForumLocalStore, readJsonFile, writeFileAtomic, writeJsonAtomic } from './cache.js';
import { parseForumCliOptions, type ForumCliOptions } from './cli-options.js';
import { resolveForumCandidates, type ResolvedForumCandidate } from './catalog-resolver.js';
import { loadCatalogSnapshot } from './catalog-source.js';
import { parseForumPost } from './forum-post-parser.js';
import { ForumHttpClient } from './http-client.js';
import { EXTERNAL_IMPORT_KEY_PREFIX } from './identity.js';
import { ForumCompleteImportError, importCompleteForumCandidates } from './complete-importer.js';
import { getForumIdFromUrl, getTopicIdFromUrl } from './invision-html.js';
import { readTechnicalPosts, scanForum, topicUrl, type TechnicalScanManifest } from './scanner.js';
import { getScopeKey, PARENT_FORUM_ID, SOURCE_ORIGIN } from './scope.js';
import {
  buildStagingArtifacts,
  compareResolvedCandidates,
  serializeDeterministicJson,
  toStagingCandidate,
  writeStagingFiles,
} from './staging.js';
import { readVerifiedForumStagingBundle } from './staging-reader.js';

const USER_AGENT = 'fishing-db-forum-scanner/1 (public read-only research)';

export class ForumPipelineError extends Error {
  constructor(
    readonly code: 'ARTIFACT_INVALID' | 'CATALOG_DATABASE_REQUIRED' | 'IDENTITY_DRIFT',
    message: string,
  ) {
    super(message);
    this.name = 'ForumPipelineError';
  }
}

export interface ForumStageSummary {
  scopeKey: string;
  postsScanned: number;
  candidatesExtracted: number;
  candidateStatusCounts: ForumImportAudit['candidateStatusCounts'];
  catalogSnapshotFingerprint: string;
  outputDirectory: string;
  identityRebased: boolean;
  identityChangedPostIds: string[];
  identityAppendedCandidates: number;
  identityAppendedPostIds: string[];
}

export async function runForumCli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  storeOverride?: ForumLocalStore,
): Promise<unknown> {
  const options = parseForumCliOptions(arguments_);
  const store = storeOverride ?? new ForumLocalStore();

  if (options.command === 'scan') {
    const http = new ForumHttpClient(store, {
      sourceOrigin: SOURCE_ORIGIN,
      userAgent: USER_AGENT,
      delayMs: options.delayMs,
    });
    return scanForum(options.scope, http, store);
  }
  if (options.command === 'stage') {
    return stageScope(options, store, environment);
  }
  if (options.command === 'import-complete') {
    return importCompleteScope(options, store, environment);
  }
  if (options.command === 'audit') {
    return readRequiredJson<ForumImportAudit>(artifactPath(store, options, 'audit/audit.json'));
  }

  const bundle = await readRequiredJson<ForumReviewBundle>(
    artifactPath(store, options, 'review/review.json'),
  );
  return {
    ...bundle,
    technicalPostsFile: artifactPath(store, options, 'review/posts.jsonl'),
  };
}

async function importCompleteScope(
  options: ForumCliOptions,
  store: ForumLocalStore,
  environment: NodeJS.ProcessEnv,
): Promise<unknown> {
  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new ForumPipelineError('CATALOG_DATABASE_REQUIRED', 'DATABASE_URL is required');
  }
  const adminEmail = environment.ADMIN_EMAIL;
  if (adminEmail === undefined || adminEmail.trim() === '') {
    throw new ForumCompleteImportError(
      'ADMIN_ACCOUNT_INVALID',
      'ADMIN_EMAIL is required for COMPLETE candidate import',
    );
  }
  const stagingDirectory = artifactPath(store, options, 'staging');
  const bundle = await readVerifiedForumStagingBundle(stagingDirectory);
  const { PrismaClient } = await import('../generated/prisma/client.js');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    return await importCompleteForumCandidates(prisma, {
      adminEmail,
      dryRun: options.dryRun,
      bundle,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function stageScope(
  options: ForumCliOptions,
  store: ForumLocalStore,
  environment: NodeJS.ProcessEnv,
): Promise<ForumStageSummary> {
  const scopeKey = getScopeKey(options.scope);
  const outputDirectory = store.outputDirectory(scopeKey);
  const scanManifest = await readRequiredJson<TechnicalScanManifest>(
    join(outputDirectory, 'technical', 'scan.json'),
  );
  assertScanManifest(scanManifest, options);
  if (scanManifest.sourceChangedPostIds.length > 0) {
    throw new ForumPipelineError(
      'IDENTITY_DRIFT',
      `Pinned source changed for post(s): ${scanManifest.sourceChangedPostIds.join(', ')}`,
    );
  }

  const posts = await readTechnicalPosts(store, scanManifest.postIds);
  const parsedCandidates = posts.flatMap((post) => parseForumPost(post));
  const currentIdentities = buildCandidateIdentityManifest(scopeKey, posts, parsedCandidates);
  const identitiesPath = join(outputDirectory, 'technical', 'candidate-identities.json');
  const pinnedIdentities = await readJsonFile<CandidateIdentityManifest>(identitiesPath);
  let identityDrift: CandidateIdentityDriftError | null = null;
  let identityAppendedCandidates = 0;
  let identityAppendedPostIds: string[] = [];
  if (pinnedIdentities !== null) {
    try {
      const stability = assertCandidateIdentityStable(pinnedIdentities, currentIdentities);
      identityAppendedCandidates = stability.appendedCandidateCount;
      identityAppendedPostIds = stability.appendedPostIds;
    } catch (error: unknown) {
      if (!(error instanceof CandidateIdentityDriftError)) throw error;
      identityDrift = error;
      if (!options.rebaseIdentities) {
        await writeJsonAtomic(
          join(outputDirectory, 'technical', 'candidate-identities.drift.json'),
          currentIdentities,
        );
        throw error;
      }
    }
  }

  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new ForumPipelineError(
      'CATALOG_DATABASE_REQUIRED',
      'DATABASE_URL is required for read-only catalog resolution',
    );
  }

  const { PrismaClient } = await import('../generated/prisma/client.js');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    let identityRebase: CandidateIdentityRebase | null = null;
    if (identityDrift !== null && pinnedIdentities !== null) {
      const importKeyColumns = await prisma.$queryRaw<Array<{ present: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'CatchReport'
            AND column_name = 'importKey'
        ) AS present
      `;
      const hasImportKeyColumn = importKeyColumns[0]?.present === true;
      const importedCatchReports = hasImportKeyColumn
        ? await prisma.catchReport.count({
            where: { importKey: { startsWith: EXTERNAL_IMPORT_KEY_PREFIX } },
          })
        : 0;
      identityRebase = buildPreImportCandidateIdentityRebase(
        pinnedIdentities,
        currentIdentities,
        importedCatchReports,
        hasImportKeyColumn ? 'IMPORT_KEY_PREFIX_COUNT' : 'IMPORT_KEY_COLUMN_ABSENT',
      );
    }

    const catalogSnapshot = await prisma.$transaction(
      (transaction) => loadCatalogSnapshot(transaction),
      { isolationLevel: 'RepeatableRead' },
    );
    const resolvedCandidates = resolveForumCandidates(parsedCandidates, catalogSnapshot);
    const staging = buildStagingArtifacts(resolvedCandidates, catalogSnapshot.fingerprint);
    const stagingFiles = {
      'candidates.csv': staging.candidatesCsv,
      'candidates.jsonl': staging.candidatesJsonl,
      'manifest.json': staging.manifestJson,
    };
    const audit = buildForumImportAudit({
      scope: {
        mode: options.scope.mode,
        parentForumId: PARENT_FORUM_ID,
        requestedTopicId: options.scope.mode === 'TOPIC' ? options.scope.topicId : null,
        requestedSubforumId: options.scope.mode === 'SUBFORUM' ? options.scope.subforumId : null,
        eligibleSubforumIds: scanManifest.eligibleSubforumIds,
        scannedSubforumIds: scanManifest.scannedSubforumIds,
        limitPosts: options.scope.limitPosts,
        truncated: scanManifest.truncated,
      },
      counters: crawlCounters(scanManifest),
      posts,
      candidates: resolvedCandidates,
      catalogSnapshotFingerprint: catalogSnapshot.fingerprint,
      files: stagingFiles,
    });
    const review = buildForumReviewBundle(posts, resolvedCandidates);
    const reviewPosts = serializeReviewPosts(posts, resolvedCandidates, review);

    await writeJsonAtomic(
      join(outputDirectory, 'technical', 'catalog-snapshot.json'),
      catalogSnapshot,
    );
    await writeStagingFiles(join(outputDirectory, 'staging'), stagingFiles);
    await writeJsonAtomic(join(outputDirectory, 'audit', 'audit.json'), audit);
    await writeJsonAtomic(join(outputDirectory, 'review', 'review.json'), review);
    await writeFileAtomic(join(outputDirectory, 'review', 'posts.jsonl'), reviewPosts);
    if (identityRebase !== null) {
      await writeJsonAtomic(
        join(outputDirectory, 'technical', 'candidate-identities.rebase.json'),
        identityRebase,
      );
    }
    await writeJsonAtomic(identitiesPath, currentIdentities);

    return {
      scopeKey,
      postsScanned: posts.length,
      candidatesExtracted: resolvedCandidates.length,
      candidateStatusCounts: audit.candidateStatusCounts,
      catalogSnapshotFingerprint: catalogSnapshot.fingerprint,
      outputDirectory,
      identityRebased: identityRebase !== null,
      identityChangedPostIds: identityRebase?.changedPosts.map((post) => post.postId) ?? [],
      identityAppendedCandidates,
      identityAppendedPostIds,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function assertScanManifest(manifest: TechnicalScanManifest, options: ForumCliOptions): void {
  if (
    manifest.version !== 1 ||
    manifest.parentForumId !== PARENT_FORUM_ID ||
    manifest.scopeKey !== getScopeKey(options.scope) ||
    JSON.stringify(manifest.scope) !== JSON.stringify(options.scope) ||
    !manifest.complete ||
    !Array.isArray(manifest.postIds) ||
    !Array.isArray(manifest.sourceChangedPostIds)
  ) {
    throw new ForumPipelineError(
      'ARTIFACT_INVALID',
      'The scan artifact is missing, incomplete, or belongs to another scope',
    );
  }
}

function crawlCounters(manifest: TechnicalScanManifest): ForumCrawlCounters {
  const discovered = [...new Set(manifest.discoveredPageUrls)];
  const completed = [...new Set(manifest.completedPageUrls)];
  const forumPagesDiscovered = discovered.filter((url) => getForumIdFromUrl(url) !== null).length;
  const forumPagesScanned = completed.filter((url) => getForumIdFromUrl(url) !== null).length;
  const topicPagesDiscovered = discovered.filter((url) => getTopicIdFromUrl(url) !== null).length;
  const topicPagesScanned = completed.filter((url) => getTopicIdFromUrl(url) !== null).length;
  const scannedTopics = new Set(
    completed.flatMap((url) => {
      const topicId = getTopicIdFromUrl(url);
      return topicId === null ? [] : [topicId];
    }),
  );

  return {
    forumPagesDiscovered,
    forumPagesScanned,
    topicPagesDiscovered,
    topicPagesScanned,
    topicsDiscovered: manifest.topicIds.length,
    topicsScanned: scannedTopics.size,
    identityDrift: manifest.sourceChangedPostIds.length,
    scopeDriftDetected: 0,
    outOfScopeLinksRejected: 0,
    httpRetries: manifest.http.retries,
    http429Responses: manifest.http.rateLimits,
    httpChallenges: manifest.http.challenges,
    httpCacheHits: manifest.http.cacheHits,
    httpCacheMisses: manifest.http.cacheMisses,
  };
}

function serializeReviewPosts(
  posts: readonly import('./candidate-types.js').TechnicalForumPost[],
  candidatesInput: readonly ResolvedForumCandidate[],
  review: ForumReviewBundle,
): string {
  const selectedPostIds = new Set([
    ...review.unresolved.map((candidate) => candidate.postId),
    ...review.multiCandidatePosts.map((post) => post.postId),
    ...review.usableSample.map((candidate) => candidate.postId),
    ...review.noCatchDataSample.map((post) => post.postId),
  ]);
  const candidates = [...candidatesInput].sort(compareResolvedCandidates);
  const rows = posts
    .filter((post) => selectedPostIds.has(post.postId))
    .map((post) => ({
      subforumId: post.subforumId,
      topicId: post.topicId,
      postId: post.postId,
      topicUrl: topicUrl(post.topicId),
      topicTitle: post.topicTitle,
      bodyText: post.bodyText,
      candidates: candidates
        .filter((candidate) => candidate.technical.postId === post.postId)
        .map((candidate) => ({
          candidateOrdinal: candidate.candidateOrdinal,
          sourceRange: candidate.technical.sourceRange,
          sourceText: candidate.technical.sourceText,
          staging: toStagingCandidate(candidate),
        })),
    }));
  return rows.length === 0 ? '' : `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function artifactPath(
  store: ForumLocalStore,
  options: ForumCliOptions,
  relativePath: string,
): string {
  return join(store.outputDirectory(getScopeKey(options.scope)), relativePath);
}

async function readRequiredJson<T>(path: string): Promise<T> {
  const value = await readJsonFile<T>(path);
  if (value === null) {
    throw new ForumPipelineError('ARTIFACT_INVALID', `Required local artifact is missing: ${path}`);
  }
  return value;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runForumCli(process.argv.slice(2))
    .then((result) => {
      console.info(serializeDeterministicJson(result).trimEnd());
    })
    .catch((error: unknown) => {
      if (error instanceof ForumCompleteImportError && error.summary !== undefined) {
        console.error(serializeDeterministicJson(error.summary).trimEnd());
      }
      if (error instanceof ForumCompleteImportError && error.details.length > 0) {
        console.error(serializeDeterministicJson({ details: error.details }).trimEnd());
      }
      const code = error instanceof Error && 'code' in error ? ` (${String(error.code)})` : '';
      const message = error instanceof Error ? error.message : 'Unknown forum pipeline error';
      console.error(`Forum pipeline failed${code}: ${message}`);
      process.exitCode = 1;
    });
}
