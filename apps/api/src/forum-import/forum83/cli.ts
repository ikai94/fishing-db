import 'dotenv/config';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPrismaAdapter } from '../../prisma/prisma-adapter.js';
import { readJsonFile } from '../cache.js';
import { ForumCompleteImportError, importCompleteForumCandidates } from '../complete-importer.js';
import { ForumHttpClient } from '../http-client.js';
import { serializeDeterministicJson } from '../staging.js';
import { parseForum83CliOptions } from './cli-options.js';
import { FORUM83_SOURCE_ORIGIN } from './constants.js';
import { scanForum83 } from './scanner.js';
import {
  assertForum83ReviewedCatalogPostState,
  readVerifiedForum83ReviewedAuditBundle,
} from './reviewed-audit.js';
import { forum83ScopeKey } from './scope.js';
import { stageForum83, type Forum83Audit } from './stage.js';
import { createForum83Store } from './store.js';

const USER_AGENT = 'fishing-db-forum83-scanner/1 (public read-only research)';

export async function runForum83Cli(
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  storeOverride?: ReturnType<typeof createForum83Store>,
): Promise<unknown> {
  const options = parseForum83CliOptions(arguments_);
  const store = storeOverride ?? createForum83Store();
  if (options.command === 'scan') {
    const http = new ForumHttpClient(store, {
      sourceOrigin: FORUM83_SOURCE_ORIGIN,
      userAgent: USER_AGENT,
      delayMs: options.delayMs,
    });
    return scanForum83(options.scope, http, store);
  }
  if (options.command === 'stage') {
    return stageForum83(options.scope, store, environment);
  }
  const outputDirectory = store.outputDirectory(forum83ScopeKey(options.scope));
  if (options.command === 'import-complete') {
    const databaseUrl = environment.DATABASE_URL;
    if (databaseUrl === undefined || databaseUrl.trim() === '') {
      throw new Error('DATABASE_URL is required for forum83 import');
    }
    const adminEmail = environment.ADMIN_EMAIL;
    if (adminEmail === undefined || adminEmail.trim() === '') {
      throw new ForumCompleteImportError(
        'ADMIN_ACCOUNT_INVALID',
        'ADMIN_EMAIL is required for forum83 COMPLETE candidate import',
      );
    }
    const reviewed = await readVerifiedForum83ReviewedAuditBundle(outputDirectory);
    if (!options.dryRun && options.approvedAuditSha256 !== reviewed.frozenAuditSha256) {
      throw new Error(
        `Approved audit SHA-256 is ${String(options.approvedAuditSha256)}, expected ${reviewed.frozenAuditSha256}`,
      );
    }
    const { PrismaClient } = await import('../../generated/prisma/client.js');
    const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
    try {
      await assertForum83ReviewedCatalogPostState(prisma, reviewed.catalogPostState);
      const importSummary = await importCompleteForumCandidates(prisma, {
        adminEmail,
        dryRun: options.dryRun,
        bundle: reviewed.bundle,
      });
      return {
        reviewedExclusions: {
          count: reviewed.reviewedExcluded,
          status: 'APPROVED_EXCLUDED',
          categories: reviewed.exclusionCounts,
        },
        frozenAuditSha256: reviewed.frozenAuditSha256,
        import: importSummary,
        catalogFingerprint: {
          expected: reviewed.catalogPostState.catalogSnapshotFingerprint,
          matched: true,
        },
        uniqueness: {
          duplicateImportKeys: reviewed.duplicateImportKeys,
          contributors: reviewed.contributors,
        },
      };
    } finally {
      await prisma.$disconnect();
    }
  }
  if (options.command === 'audit') {
    return requiredJson<Forum83Audit>(join(outputDirectory, 'audit', 'audit.json'));
  }
  const reviewPath = join(outputDirectory, 'review', 'posts.jsonl');
  return { scopeKey: forum83ScopeKey(options.scope), reviewPostsFile: reviewPath };
}

async function requiredJson<Value>(path: string): Promise<Value> {
  const value = await readJsonFile<Value>(path);
  if (value === null) throw new Error(`Required forum83 artifact is missing: ${path}`);
  return value;
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runForum83Cli(process.argv.slice(2))
    .then((result) => console.info(serializeDeterministicJson(result).trimEnd()))
    .catch((error: unknown) => {
      const code = error instanceof Error && 'code' in error ? ` (${String(error.code)})` : '';
      const message = error instanceof Error ? error.message : 'Unknown forum83 pipeline error';
      console.error(`Forum83 pipeline failed${code}: ${message}`);
      process.exitCode = 1;
    });
}
