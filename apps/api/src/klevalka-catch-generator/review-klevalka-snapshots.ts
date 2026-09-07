import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { loadCurrentKlevalkaCatalog } from './generate-klevalka-catches.js';
import { parseKlevalkaHtml, type KlevalkaCatalogSnapshot } from './klevalka-catch-generator.js';
import type {
  KlevalkaSnapshotManifest,
  KlevalkaSnapshotManifestFailure,
} from './klevalka-fish-snapshot-crawler.js';
import {
  KlevalkaProjectionReviewer,
  type KlevalkaGroupedDecision,
  type KlevalkaReviewManifest,
  type ProjectionIssueSummary,
} from './klevalka-snapshot-review.js';

interface Command {
  snapshotsPath: string;
  datasetId: string;
  reviewManifestPath?: string;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaSnapshotReviewCommand(args: readonly string[]): Command {
  let snapshotsPath: string | undefined;
  let datasetId = 'klevalka-html-v1';
  let reviewManifestPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--snapshots') snapshotsPath = requiredValue(args, index++, option);
    else if (option === '--dataset-id') datasetId = requiredValue(args, index++, option);
    else if (option === '--review-manifest') {
      reviewManifestPath = requiredValue(args, index++, option);
    } else throw new Error(`Unknown argument: ${option ?? ''}`);
  }
  if (snapshotsPath === undefined) {
    throw new Error(
      'usage: review-klevalka-snapshots --snapshots <absolute snapshot release> [--review-manifest <absolute path>] [--dataset-id <id>]',
    );
  }
  if (!isAbsolute(snapshotsPath)) throw new Error('--snapshots must be an absolute path');
  if (reviewManifestPath !== undefined && !isAbsolute(reviewManifestPath)) {
    throw new Error('--review-manifest must be an absolute path');
  }
  if (datasetId.trim().length === 0) throw new Error('--dataset-id must not be empty');
  return {
    snapshotsPath,
    datasetId,
    ...(reviewManifestPath === undefined ? {} : { reviewManifestPath }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid review manifest ${field}`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid review manifest ${field}`);
  return value as number;
}

function validateDecision(value: unknown, index: number): KlevalkaGroupedDecision {
  if (!isRecord(value)) throw new Error(`Invalid review manifest decisions[${index}]`);
  const action = requireString(value.action, `decisions[${index}].action`);
  const common = {
    groupId: requireString(value.groupId, `decisions[${index}].groupId`),
    expectedRows: requireInteger(value.expectedRows, `decisions[${index}].expectedRows`),
    reason: requireString(value.reason, `decisions[${index}].reason`),
    evidence: Array.isArray(value.evidence)
      ? value.evidence.map((item, evidenceIndex) =>
          requireString(item, `decisions[${index}].evidence[${evidenceIndex}]`),
        )
      : (() => {
          throw new Error(`Invalid review manifest decisions[${index}].evidence`);
        })(),
    ...(value.affectedRowsSha256 === undefined
      ? {}
      : {
          affectedRowsSha256: requireString(
            value.affectedRowsSha256,
            `decisions[${index}].affectedRowsSha256`,
          ),
        }),
  };
  if (action === 'MAP_FISH') {
    return {
      ...common,
      action,
      sourceFile: requireString(value.sourceFile, `decisions[${index}].sourceFile`),
      sourceFishName: requireString(value.sourceFishName, `decisions[${index}].sourceFishName`),
      targetFishId: requireString(value.targetFishId, `decisions[${index}].targetFishId`),
      targetFishName: requireString(value.targetFishName, `decisions[${index}].targetFishName`),
    };
  }
  if (action === 'EXCLUDE_BAIT') {
    return {
      ...common,
      action,
      sourceBaitName: requireString(value.sourceBaitName, `decisions[${index}].sourceBaitName`),
    };
  }
  if (
    action !== 'EXCLUDE_MEMBERSHIP' &&
    action !== 'OVERRIDE_WEIGHT_BOUNDS' &&
    action !== 'EXCLUDE_WEIGHT_BOUNDS'
  ) {
    throw new Error(`Invalid review manifest decisions[${index}].action`);
  }
  const baseFish = {
    fishingBaseId: requireString(value.fishingBaseId, `decisions[${index}].fishingBaseId`),
    fishingBaseName: requireString(value.fishingBaseName, `decisions[${index}].fishingBaseName`),
    fishId: requireString(value.fishId, `decisions[${index}].fishId`),
    fishName: requireString(value.fishName, `decisions[${index}].fishName`),
  };
  if (action === 'OVERRIDE_WEIGHT_BOUNDS') {
    return {
      ...common,
      ...baseFish,
      action,
      minWeightGrams: requireInteger(value.minWeightGrams, `decisions[${index}].minWeightGrams`),
      maxWeightGrams: requireInteger(value.maxWeightGrams, `decisions[${index}].maxWeightGrams`),
    };
  }
  return { ...common, ...baseFish, action };
}

export function validateKlevalkaReviewManifest(value: unknown): KlevalkaReviewManifest {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Array.isArray(value.decisions)) {
    throw new Error('Review manifest is incomplete or incompatible');
  }
  if (!Array.isArray(value.acceptedSourceFailures)) {
    throw new Error('Invalid review manifest acceptedSourceFailures');
  }
  return {
    schemaVersion: 2,
    snapshotManifestSha256: requireString(value.snapshotManifestSha256, 'snapshotManifestSha256'),
    catalogSha256: requireString(value.catalogSha256, 'catalogSha256'),
    datasetId: requireString(value.datasetId, 'datasetId'),
    decisions: value.decisions.map(validateDecision),
    acceptedSourceFailures: value.acceptedSourceFailures.map((failure, index) => {
      if (!isRecord(failure)) {
        throw new Error(`Invalid review manifest acceptedSourceFailures[${index}]`);
      }
      return {
        sourceId: requireInteger(failure.sourceId, `acceptedSourceFailures[${index}].sourceId`),
        code: requireString(failure.code, `acceptedSourceFailures[${index}].code`),
        reason: requireString(failure.reason, `acceptedSourceFailures[${index}].reason`),
      };
    }),
  };
}

export function catalogSha256(catalog: KlevalkaCatalogSnapshot): string {
  return sha256(`${JSON.stringify(catalog, null, 2)}\n`);
}

export function validateAcceptedFailures(
  failures: readonly KlevalkaSnapshotManifestFailure[],
  accepted: KlevalkaReviewManifest['acceptedSourceFailures'],
): void {
  const actual = new Map(
    failures.map((failure) => [`${failure.sourceId}\0${failure.code}`, failure]),
  );
  const seen = new Set<string>();
  for (const acceptance of accepted) {
    const key = `${acceptance.sourceId}\0${acceptance.code}`;
    if (seen.has(key)) throw new Error(`Duplicate accepted source failure: ${key}`);
    seen.add(key);
    if (!actual.has(key)) throw new Error(`Accepted source failure is not present: ${key}`);
  }
  const unaccepted = [...actual.keys()].filter((key) => !seen.has(key));
  if (unaccepted.length > 0) {
    throw new Error(`Unaccepted source failures: ${unaccepted.join(', ')}`);
  }
}

export function validateKlevalkaSnapshotManifest(value: unknown): KlevalkaSnapshotManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid snapshot manifest');
  const manifest = value as Partial<KlevalkaSnapshotManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.sourceMode !== 'ALL' ||
    manifest.complete !== true ||
    !Array.isArray(manifest.pages) ||
    !Array.isArray(manifest.failures) ||
    manifest.attemptedFishCount !== manifest.discovery?.fishCount ||
    manifest.savedFishCount !== manifest.pages.length ||
    manifest.failedFishCount !== manifest.failures.length
  ) {
    throw new Error('Snapshot manifest is incomplete or incompatible');
  }
  return manifest as KlevalkaSnapshotManifest;
}

function failureIssues(
  failures: readonly KlevalkaSnapshotManifestFailure[],
): ProjectionIssueSummary[] {
  const grouped = new Map<string, ProjectionIssueSummary>();
  for (const failure of failures) {
    const key = `SOURCE_SNAPSHOT_${failure.code}`;
    const issue = grouped.get(key) ?? {
      code: key,
      field: 'snapshot',
      count: 0,
      examples: [],
    };
    issue.count += 1;
    if (issue.examples.length < 5) {
      issue.examples.push({
        sourceFile: failure.path,
        sourceRow: 0,
        fish: failure.discoveredNames.join(' / '),
        fishingBase: '',
        location: '',
        bait: '',
        int: failure.message,
      });
    }
    grouped.set(key, issue);
  }
  return [...grouped.values()];
}

export async function runKlevalkaSnapshotReview(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseKlevalkaSnapshotReviewCommand(args);
  const snapshotsRoot = await realpath(command.snapshotsPath);
  if (!(await stat(snapshotsRoot)).isDirectory()) {
    throw new Error('--snapshots must be a directory');
  }
  const manifestText = await readFile(join(snapshotsRoot, 'manifest.json'), 'utf8');
  const manifest = validateKlevalkaSnapshotManifest(JSON.parse(manifestText) as unknown);
  const snapshotManifestSha256 = sha256(manifestText);
  const reviewManifestText =
    command.reviewManifestPath === undefined
      ? undefined
      : await readFile(command.reviewManifestPath, 'utf8');
  const reviewManifest =
    reviewManifestText === undefined
      ? undefined
      : validateKlevalkaReviewManifest(JSON.parse(reviewManifestText) as unknown);
  if (
    reviewManifest !== undefined &&
    reviewManifest.snapshotManifestSha256 !== snapshotManifestSha256
  ) {
    throw new Error('Review manifest snapshot checksum does not match the frozen release');
  }
  if (reviewManifest !== undefined && reviewManifest.datasetId !== command.datasetId) {
    throw new Error('Review manifest datasetId does not match --dataset-id');
  }
  if (reviewManifest !== undefined) {
    validateAcceptedFailures(manifest.failures, reviewManifest.acceptedSourceFailures);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required to read the current catalog');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const catalog = await loadCurrentKlevalkaCatalog(prisma);
    const currentCatalogSha256 = catalogSha256(catalog);
    if (reviewManifest !== undefined && reviewManifest.catalogSha256 !== currentCatalogSha256) {
      throw new Error('Review manifest catalog checksum does not match the current catalog');
    }
    const reviewer = new KlevalkaProjectionReviewer(
      catalog,
      command.datasetId,
      reviewManifest?.decisions,
    );
    let emptySnapshots = 0;
    for (const [index, entry] of manifest.pages.entries()) {
      const content = await readFile(join(snapshotsRoot, entry.path), 'utf8');
      if (sha256(content) !== entry.sha256) {
        throw new Error(`Snapshot checksum mismatch: ${entry.path}`);
      }
      const page = parseKlevalkaHtml(content, entry.path);
      if (page.sourceMode !== 'ALL') throw new Error(`Snapshot is not ALL mode: ${entry.path}`);
      if (entry.status === 'EMPTY_CONFIRMED') {
        emptySnapshots += 1;
        const unexpected = page.issues.filter((issue) => issue.code !== 'SOURCE_TABLE_MISSING');
        if (page.rows.length !== 0 || unexpected.length > 0) {
          throw new Error(`Confirmed empty snapshot changed adapter result: ${entry.path}`);
        }
      } else {
        if (page.issues.length > 0) {
          throw new Error(
            `Valid snapshot has adapter issues: ${entry.path} (${page.issues.map((issue) => issue.code).join(', ')})`,
          );
        }
        if (page.rows.length !== entry.rowCount) {
          throw new Error(
            `Snapshot row count mismatch: ${entry.path} (${page.rows.length} != ${entry.rowCount})`,
          );
        }
        reviewer.addRows(page.rows);
      }
      if ((index + 1) % 100 === 0 || index + 1 === manifest.pages.length) {
        console.error(`reviewed snapshots: ${index + 1}/${manifest.pages.length}`);
      }
    }
    const projection = reviewer.finish();
    const report = {
      schemaVersion: 2,
      snapshotsRoot,
      snapshotManifestSha256,
      datasetId: command.datasetId,
      reviewManifest:
        command.reviewManifestPath === undefined || reviewManifestText === undefined
          ? null
          : {
              path: command.reviewManifestPath,
              sha256: sha256(reviewManifestText),
              decisions: reviewManifest?.decisions.length ?? 0,
              acceptedSourceFailures: reviewManifest?.acceptedSourceFailures.length ?? 0,
            },
      source: {
        discoveredSnapshots: manifest.discovery.fishCount,
        validSnapshots: manifest.pages.length,
        emptySnapshots,
        failedSnapshots: manifest.failures.length,
        failures: manifest.failures,
      },
      catalog: {
        sha256: currentCatalogSha256,
        fishingBases: catalog.fishingBases.length,
        locations: catalog.fishingBases.reduce((sum, base) => sum + base.locations.length, 0),
        fish: catalog.fish.length,
        baits: catalog.baits.length,
        memberships: catalog.memberships.length,
      },
      ...projection,
      issues: [
        ...(reviewManifest === undefined ? failureIssues(manifest.failures) : []),
        ...projection.issues,
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runKlevalkaSnapshotReview().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
