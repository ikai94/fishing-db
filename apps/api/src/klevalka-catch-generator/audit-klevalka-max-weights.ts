import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCatalogLookupIndex, resolveCatalogLookup } from '../catalog/catalog-lookup.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { parseKlevalkaHtml } from './klevalka-catch-generator.js';
import {
  inferKlevalkaOrdinaryMax,
  klevalkaMaxWeightAuditTsv,
  type KlevalkaMaxWeightAuditRow,
} from './klevalka-max-weight-audit.js';
import {
  validateAcceptedFailures,
  validateKlevalkaReviewManifest,
  validateKlevalkaSnapshotManifest,
} from './review-klevalka-snapshots.js';

interface Command {
  snapshotsPath: string;
  reviewManifestPath: string;
  outputPath: string;
}

interface CatalogPair {
  fishingBaseId: string;
  fishingBaseName: string;
  fishId: string;
  fishName: string;
  databaseMaxWeightGrams: number | null;
}

interface CatalogNamedItem {
  id: string;
  name: string;
}

interface EvidenceAccumulator {
  weightsGrams: number[];
  locationNames: Set<string>;
  baitNames: Set<string>;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaMaxWeightAuditCommand(args: readonly string[]): Command {
  let snapshotsPath: string | undefined;
  let reviewManifestPath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--snapshots') snapshotsPath = requiredValue(args, index++, option);
    else if (option === '--review-manifest') {
      reviewManifestPath = requiredValue(args, index++, option);
    } else if (option === '--output') outputPath = requiredValue(args, index++, option);
    else throw new Error(`Unknown argument: ${option ?? ''}`);
  }
  if (snapshotsPath === undefined || reviewManifestPath === undefined || outputPath === undefined) {
    throw new Error(
      'usage: audit-klevalka-max-weights --snapshots <absolute frozen release> --review-manifest <absolute JSON> --output <absolute external TSV>',
    );
  }
  for (const [option, value] of [
    ['--snapshots', snapshotsPath],
    ['--review-manifest', reviewManifestPath],
    ['--output', outputPath],
  ] as const) {
    if (!isAbsolute(value)) throw new Error(`${option} must be an absolute path`);
  }
  return { snapshotsPath, reviewManifestPath, outputPath };
}

function isInside(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (!fromParent.startsWith(`..${sep}`) && fromParent !== '..');
}

async function externalOutputPath(path: string): Promise<string> {
  const repositoryRoot = await realpath(resolve(import.meta.dirname, '../../../..'));
  const outputPath = resolve(path);
  if (isInside(repositoryRoot, outputPath)) {
    throw new Error(`--output must resolve outside the repository: ${repositoryRoot}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  return outputPath;
}

function pairKey(fishingBaseId: string, fishId: string): string {
  return `${fishingBaseId}\0${fishId}`;
}

async function loadCatalog(prisma: PrismaClient): Promise<{
  fishingBases: CatalogNamedItem[];
  fish: CatalogNamedItem[];
  pairs: CatalogPair[];
}> {
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [fishingBases, fish, memberships] = await Promise.all([
        transaction.fishingBase.findMany({ select: { id: true, name: true } }),
        transaction.fish.findMany({ select: { id: true, name: true } }),
        transaction.fishingBaseFish.findMany({
          select: {
            fishingBaseId: true,
            fishId: true,
            maxWeightGrams: true,
            fishingBase: { select: { name: true } },
            fish: { select: { name: true } },
          },
        }),
      ]);
      const pairs = memberships
        .map((membership) => ({
          fishingBaseId: membership.fishingBaseId,
          fishingBaseName: membership.fishingBase.name,
          fishId: membership.fishId,
          fishName: membership.fish.name,
          databaseMaxWeightGrams: membership.maxWeightGrams,
        }))
        .sort(
          (left, right) =>
            left.fishingBaseName.localeCompare(right.fishingBaseName, 'ru') ||
            left.fishName.localeCompare(right.fishName, 'ru') ||
            left.fishingBaseId.localeCompare(right.fishingBaseId) ||
            left.fishId.localeCompare(right.fishId),
        );
      return { fishingBases, fish, pairs };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}

function buildAuditRows(
  pairs: readonly CatalogPair[],
  evidenceByPair: ReadonlyMap<string, EvidenceAccumulator>,
): KlevalkaMaxWeightAuditRow[] {
  return pairs.map((pair) => {
    const evidence = evidenceByPair.get(pairKey(pair.fishingBaseId, pair.fishId));
    const inference = inferKlevalkaOrdinaryMax({
      weightsGrams: evidence?.weightsGrams ?? [],
      locationNames: [...(evidence?.locationNames ?? [])],
      baitNames: [...(evidence?.baitNames ?? [])],
    });
    const inferred = inference.inferredMaxWeightGrams;
    const database = pair.databaseMaxWeightGrams;
    return {
      ...pair,
      ...inference,
      deltaGrams: inferred === null || database === null ? null : inferred - database,
      ratio: inferred === null || database === null ? null : inferred / database,
    };
  });
}

function mismatchDiscrepancy(row: KlevalkaMaxWeightAuditRow): number {
  if (row.databaseMaxWeightGrams === null || row.deltaGrams === null) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs(row.deltaGrams);
}

function compactSummary(rows: readonly KlevalkaMaxWeightAuditRow[], outputPath: string): string {
  const maximumDisplayedMismatches = 25;
  const mismatches = rows
    .filter(
      (row) =>
        row.confidence === 'HIGH' &&
        row.inferredMaxWeightGrams !== null &&
        row.inferredMaxWeightGrams !== row.databaseMaxWeightGrams,
    )
    .sort(
      (left, right) =>
        mismatchDiscrepancy(right) - mismatchDiscrepancy(left) ||
        left.fishingBaseName.localeCompare(right.fishingBaseName, 'ru') ||
        left.fishName.localeCompare(right.fishName, 'ru'),
    );
  const lines = [`HIGH-confidence mismatches (${mismatches.length}; absolute delta descending)`];
  if (mismatches.length === 0) lines.push('none');
  else {
    lines.push('Base\tFish\tDB max\tinferred max\tdelta\tratio');
    for (const row of mismatches.slice(0, maximumDisplayedMismatches)) {
      lines.push(
        [
          row.fishingBaseName,
          row.fishName,
          row.databaseMaxWeightGrams ?? '',
          row.inferredMaxWeightGrams ?? '',
          row.deltaGrams ?? '',
          row.ratio?.toFixed(6) ?? '',
        ].join('\t'),
      );
    }
    if (mismatches.length > maximumDisplayedMismatches) {
      lines.push(`... ${mismatches.length - maximumDisplayedMismatches} more in TSV`);
    }
  }
  const confidenceCounts = new Map<string, number>();
  for (const row of rows) {
    confidenceCounts.set(row.confidence, (confidenceCounts.get(row.confidence) ?? 0) + 1);
  }
  lines.push(
    '',
    `TSV: ${outputPath}`,
    `BaseFish rows: ${rows.length}`,
    `Confidence: HIGH=${confidenceCounts.get('HIGH') ?? 0}, MEDIUM=${confidenceCounts.get('MEDIUM') ?? 0}, LOW=${confidenceCounts.get('LOW') ?? 0}, NO_SOURCE=${confidenceCounts.get('NO_SOURCE') ?? 0}`,
  );
  return `${lines.join('\n')}\n`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function runKlevalkaMaxWeightAudit(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseKlevalkaMaxWeightAuditCommand(args);
  const outputPath = await externalOutputPath(command.outputPath);
  const snapshotsRoot = await realpath(command.snapshotsPath);
  if (!(await stat(snapshotsRoot)).isDirectory())
    throw new Error('--snapshots must be a directory');

  const [manifestText, reviewManifestText] = await Promise.all([
    readFile(join(snapshotsRoot, 'manifest.json'), 'utf8'),
    readFile(command.reviewManifestPath, 'utf8'),
  ]);
  const manifest = validateKlevalkaSnapshotManifest(JSON.parse(manifestText) as unknown);
  const reviewManifest = validateKlevalkaReviewManifest(JSON.parse(reviewManifestText) as unknown);
  const snapshotManifestSha256 = sha256(manifestText);
  if (reviewManifest.snapshotManifestSha256 !== snapshotManifestSha256) {
    throw new Error('Review manifest checksum does not match the frozen snapshot release');
  }
  validateAcceptedFailures(manifest.failures, reviewManifest.acceptedSourceFailures);

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required to read the current catalog');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const { fishingBases, fish, pairs } = await loadCatalog(prisma);
    const fishById = new Map(fish.map((item) => [item.id, item]));
    const baseIndex = buildCatalogLookupIndex(fishingBases);
    const fishIndex = buildCatalogLookupIndex(fish);
    const membershipKeys = new Set(pairs.map((pair) => pairKey(pair.fishingBaseId, pair.fishId)));
    const mappedFish = new Map<string, { id: string; name: string }>();
    for (const decision of reviewManifest.decisions) {
      if (decision.action !== 'MAP_FISH') continue;
      const target = fishById.get(decision.targetFishId);
      if (target?.name !== decision.targetFishName) {
        throw new Error(`Reviewed Fish mapping target changed: ${decision.groupId}`);
      }
      mappedFish.set(`${decision.sourceFile}\0${decision.sourceFishName}`, target);
    }

    const evidenceByPair = new Map<string, EvidenceAccumulator>();
    for (const entry of manifest.pages) {
      const content = await readFile(join(snapshotsRoot, entry.path), 'utf8');
      if (sha256(content) !== entry.sha256) {
        throw new Error(`Snapshot checksum mismatch: ${entry.path}`);
      }
      const page = parseKlevalkaHtml(content, entry.path);
      if (page.sourceMode !== 'ALL') throw new Error(`Snapshot is not ALL mode: ${entry.path}`);
      if (entry.status === 'EMPTY_CONFIRMED') {
        if (page.rows.length !== 0)
          throw new Error(`Confirmed empty snapshot has rows: ${entry.path}`);
        continue;
      }
      if (page.issues.length > 0 || page.rows.length !== entry.rowCount) {
        throw new Error(`Frozen snapshot changed adapter result: ${entry.path}`);
      }

      for (const row of page.rows) {
        if (row.sourceWeightGrams === null) continue;
        const baseResolution = resolveCatalogLookup(baseIndex, row.fishingBaseNameRaw);
        const mapped = mappedFish.get(`${row.sourceFile}\0${row.fishNameRaw}`);
        const fishResolution =
          mapped === undefined ? resolveCatalogLookup(fishIndex, row.fishNameRaw) : null;
        const base = baseResolution.status === 'UNIQUE' ? baseResolution.item : null;
        const fish = mapped ?? (fishResolution?.status === 'UNIQUE' ? fishResolution.item : null);
        if (base === null || fish === null) continue;
        const key = pairKey(base.id, fish.id);
        if (!membershipKeys.has(key)) continue;
        const evidence = evidenceByPair.get(key) ?? {
          weightsGrams: [],
          locationNames: new Set<string>(),
          baitNames: new Set<string>(),
        };
        evidence.weightsGrams.push(row.sourceWeightGrams);
        evidence.locationNames.add(row.locationNameRaw);
        evidence.baitNames.add(row.baitNameRaw);
        evidenceByPair.set(key, evidence);
      }
    }

    const rows = buildAuditRows(pairs, evidenceByPair);
    await atomicWrite(outputPath, klevalkaMaxWeightAuditTsv(rows));
    process.stdout.write(compactSummary(rows, outputPath));
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runKlevalkaMaxWeightAudit().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Klevalka max-weight audit failed: ${message}\n`);
    process.exitCode = 1;
  });
}
