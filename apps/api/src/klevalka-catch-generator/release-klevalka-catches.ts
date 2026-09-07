import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCatalogLookupText } from '../catalog/catalog-lookup.js';
import { CatchReportParserService } from '../catch-reports/parser/catch-report-parser.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { loadCurrentKlevalkaCatalog } from './generate-klevalka-catches.js';
import {
  KLEVALKA_GENERATOR_VERSION,
  KLEVALKA_MAX_FILE_CODE_UNITS,
  KLEVALKA_MAX_LINES_PER_FILE,
  KLEVALKA_SOURCE_POLICY_VERSION,
  KLEVALKA_WEIGHT_DISTRIBUTION_VERSION,
  deterministicCatchCount,
  deterministicWeight,
  formatKlevalkaCatchLine,
  klevalkaBaseSlug,
  klevalkaWeightProfileForBase,
  parseKlevalkaHtml,
  type KlevalkaCatalogSnapshot,
  type ResolvedKlevalkaRow,
} from './klevalka-catch-generator.js';
import type { KlevalkaSnapshotManifest } from './klevalka-fish-snapshot-crawler.js';
import {
  KlevalkaProjectionReviewer,
  type KlevalkaReviewManifest,
} from './klevalka-snapshot-review.js';
import {
  catalogSha256,
  validateAcceptedFailures,
  validateKlevalkaReviewManifest,
  validateKlevalkaSnapshotManifest,
} from './review-klevalka-snapshots.js';

interface Command {
  snapshotsPath: string;
  outputPath: string;
  reviewManifestPath: string;
  datasetId: string;
  expectedLines: number;
  skipParserValidation: boolean;
}

interface ExpectedParserRow {
  line: string;
  fishId: string;
  fishingBaseId: string;
  locationId: string;
  baitId: string;
  weightGrams: number;
}

interface ReleaseFile {
  path: string;
  sha256: string;
  bytes: number;
  lines: number;
  fishingBaseId: string;
  fishingBaseName: string;
}

interface BaseTotal {
  id: string;
  name: string;
  lines: number;
  files: number;
  bytes: number;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaReleaseCommand(args: readonly string[]): Command {
  let snapshotsPath: string | undefined;
  let outputPath: string | undefined;
  let reviewManifestPath: string | undefined;
  let datasetId = 'klevalka-html-v1';
  let expectedLines: number | undefined;
  let skipParserValidation = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--snapshots') snapshotsPath = requiredValue(args, index++, option);
    else if (option === '--output') outputPath = requiredValue(args, index++, option);
    else if (option === '--review-manifest') {
      reviewManifestPath = requiredValue(args, index++, option);
    } else if (option === '--dataset-id') datasetId = requiredValue(args, index++, option);
    else if (option === '--expected-lines') {
      const raw = requiredValue(args, index++, option);
      if (!/^[1-9]\d*$/u.test(raw)) throw new Error('--expected-lines must be a positive integer');
      expectedLines = Number(raw);
      if (!Number.isSafeInteger(expectedLines)) throw new Error('--expected-lines is too large');
    } else if (option === '--skip-parser-validation') {
      skipParserValidation = true;
    } else throw new Error(`Unknown argument: ${option ?? ''}`);
  }
  if (snapshotsPath === undefined || outputPath === undefined || expectedLines === undefined) {
    throw new Error(
      'usage: release-klevalka-catches --snapshots <absolute release> --output <absolute external directory> [--review-manifest <absolute path>] [--dataset-id <id>] --expected-lines <count> [--skip-parser-validation]',
    );
  }
  reviewManifestPath ??= join(snapshotsPath, 'review-manifest.json');
  for (const [label, value] of [
    ['--snapshots', snapshotsPath],
    ['--output', outputPath],
    ['--review-manifest', reviewManifestPath],
  ] as const) {
    if (!isAbsolute(value)) throw new Error(`${label} must be an absolute path`);
  }
  if (datasetId.trim().length === 0) throw new Error('--dataset-id must not be empty');
  return {
    snapshotsPath,
    outputPath,
    reviewManifestPath,
    datasetId,
    expectedLines,
    skipParserValidation,
  };
}

async function assertExternalOutput(outputPath: string): Promise<string> {
  const repositoryRoot = await realpath(resolve(import.meta.dirname, '../../../..'));
  const requested = resolve(outputPath);
  const requestedFromRepository = relative(repositoryRoot, requested);
  if (
    requestedFromRepository === '' ||
    (!requestedFromRepository.startsWith(`..${sep}`) && requestedFromRepository !== '..')
  ) {
    throw new Error(`--output must resolve outside the repository: ${repositoryRoot}`);
  }
  await mkdir(requested, { recursive: true });
  const outputRoot = await realpath(requested);
  const fromRepository = relative(repositoryRoot, outputRoot);
  if (
    fromRepository === '' ||
    (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..')
  ) {
    throw new Error(`--output must resolve outside the repository: ${repositoryRoot}`);
  }
  return outputRoot;
}

async function writeIdempotent(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path, 'utf8');
    if (existing !== content) throw new Error(`Refusing to replace different artifact: ${path}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  }
}

async function isExistingIdentical(path: string, content: string): Promise<boolean> {
  try {
    const existing = await readFile(path, 'utf8');
    if (existing !== content) throw new Error(`Refusing to replace different artifact: ${path}`);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function tupleKey(row: ResolvedKlevalkaRow): string {
  return [row.fish.id, row.fishingBase.id, row.location.id, row.bait.id].join('\0');
}

async function validateGeneratedContent(
  parser: CatchReportParserService,
  content: string,
  expectedRows: readonly ExpectedParserRow[],
): Promise<void> {
  const parsed = await parser.parseBatch(content);
  if (parsed.rows.length !== expectedRows.length) {
    throw new Error(`Parser row count mismatch: ${parsed.rows.length} != ${expectedRows.length}`);
  }
  for (const [index, parsedRow] of parsed.rows.entries()) {
    const expected = expectedRows[index];
    if (expected === undefined) throw new Error(`Generated parser row ${index} is missing`);
    const draft = parsedRow.draft;
    const unexpectedIssues = draft.issues.filter((issue) => issue.code !== 'DUPLICATE_INPUT_ROW');
    if (
      !draft.canConfirm ||
      draft.fields.fish.value?.id !== expected.fishId ||
      draft.fields.fishingBase.value?.id !== expected.fishingBaseId ||
      draft.fields.location.value?.id !== expected.locationId ||
      draft.fields.bait.value?.id !== expected.baitId ||
      draft.fields.weightGrams.value !== expected.weightGrams ||
      draft.fields.holeDepthCm.value !== null ||
      draft.fields.spotPositionRaw.value !== null ||
      draft.fields.fishingNote.value !== null ||
      draft.fields.userNoteRaw.value !== null ||
      unexpectedIssues.length > 0
    ) {
      throw new Error(
        `Generated line failed parser round-trip: ${expected.line} (${unexpectedIssues.map((issue) => issue.code).join(', ')})`,
      );
    }
  }
}

async function createReleaseParser(
  prisma: PrismaClient,
  catalog: KlevalkaCatalogSnapshot,
  decisions: KlevalkaReviewManifest['decisions'],
): Promise<CatchReportParserService> {
  const anchors = await prisma.screenAnchor.findMany({
    where: { isActive: true },
    orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
    select: { name: true, nameNormalized: true },
  });
  const locations = catalog.fishingBases.flatMap((base) =>
    base.locations.map((location) => ({ ...location, fishingBaseId: base.id })),
  );
  const membershipKeys = new Map(
    catalog.memberships.map((membership) => [
      `${membership.fishingBaseId}\0${membership.fishId}`,
      { fishingBaseId: membership.fishingBaseId, fishId: membership.fishId },
    ]),
  );
  for (const decision of decisions) {
    if (decision.action !== 'OVERRIDE_WEIGHT_BOUNDS') continue;
    membershipKeys.set(`${decision.fishingBaseId}\0${decision.fishId}`, {
      fishingBaseId: decision.fishingBaseId,
      fishId: decision.fishId,
    });
  }
  const parserCatalog = {
    fishingBase: {
      findMany: () => Promise.resolve(catalog.fishingBases.map(({ id, name }) => ({ id, name }))),
    },
    fish: { findMany: () => Promise.resolve(catalog.fish) },
    bait: { findMany: () => Promise.resolve(catalog.baits) },
    screenAnchor: { findMany: () => Promise.resolve(anchors) },
    location: { findMany: () => Promise.resolve(locations) },
    fishingBaseFish: { findMany: () => Promise.resolve([...membershipKeys.values()]) },
  };
  return new CatchReportParserService(parserCatalog as never);
}

async function readReviewedDataset(input: {
  snapshotsRoot: string;
  snapshotManifest: KlevalkaSnapshotManifest;
  catalog: KlevalkaCatalogSnapshot;
  reviewManifest: KlevalkaReviewManifest;
  datasetId: string;
}): Promise<ReturnType<KlevalkaProjectionReviewer['finishForGeneration']>> {
  const reviewer = new KlevalkaProjectionReviewer(
    input.catalog,
    input.datasetId,
    input.reviewManifest.decisions,
  );
  let emptySnapshots = 0;
  for (const [index, entry] of input.snapshotManifest.pages.entries()) {
    const content = await readFile(join(input.snapshotsRoot, entry.path), 'utf8');
    if (sha256(content) !== entry.sha256)
      throw new Error(`Snapshot checksum mismatch: ${entry.path}`);
    const page = parseKlevalkaHtml(content, entry.path);
    if (page.sourceMode !== 'ALL') throw new Error(`Snapshot is not ALL mode: ${entry.path}`);
    if (entry.status === 'EMPTY_CONFIRMED') {
      emptySnapshots += 1;
      const unexpected = page.issues.filter((issue) => issue.code !== 'SOURCE_TABLE_MISSING');
      if (page.rows.length !== 0 || unexpected.length > 0) {
        throw new Error(`Confirmed empty snapshot changed adapter result: ${entry.path}`);
      }
    } else {
      if (page.issues.length > 0 || page.rows.length !== entry.rowCount) {
        throw new Error(`Snapshot adapter validation failed: ${entry.path}`);
      }
      reviewer.addRows(page.rows);
    }
    if ((index + 1) % 100 === 0 || index + 1 === input.snapshotManifest.pages.length) {
      console.error(`resolved snapshots: ${index + 1}/${input.snapshotManifest.pages.length}`);
    }
  }
  if (
    emptySnapshots !==
    input.snapshotManifest.pages.filter((page) => page.status === 'EMPTY_CONFIRMED').length
  ) {
    throw new Error('Empty snapshot count changed during release');
  }
  return reviewer.finishForGeneration();
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile()) files.push(relative(root, absolutePath));
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function runKlevalkaRelease(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const startedAt = performance.now();
  const command = parseKlevalkaReleaseCommand(args);
  const outputRoot = await assertExternalOutput(command.outputPath);
  const snapshotsRoot = await realpath(command.snapshotsPath);
  if (!(await stat(snapshotsRoot)).isDirectory())
    throw new Error('--snapshots must be a directory');

  const snapshotManifestText = await readFile(join(snapshotsRoot, 'manifest.json'), 'utf8');
  const snapshotManifest = validateKlevalkaSnapshotManifest(
    JSON.parse(snapshotManifestText) as unknown,
  );
  const snapshotManifestSha256 = sha256(snapshotManifestText);
  const reviewManifestText = await readFile(command.reviewManifestPath, 'utf8');
  const reviewManifest = validateKlevalkaReviewManifest(JSON.parse(reviewManifestText) as unknown);
  if (reviewManifest.snapshotManifestSha256 !== snapshotManifestSha256) {
    throw new Error('Review manifest snapshot checksum does not match the frozen release');
  }
  if (reviewManifest.datasetId !== command.datasetId) {
    throw new Error('Review manifest datasetId does not match --dataset-id');
  }
  validateAcceptedFailures(snapshotManifest.failures, reviewManifest.acceptedSourceFailures);

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required to read the current catalog');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const catalog = await loadCurrentKlevalkaCatalog(prisma);
    const currentCatalogSha256 = catalogSha256(catalog);
    if (currentCatalogSha256 !== reviewManifest.catalogSha256) {
      throw new Error('Review manifest catalog checksum does not match the current catalog');
    }
    const { projection, retainedRows } = await readReviewedDataset({
      snapshotsRoot,
      snapshotManifest,
      catalog,
      reviewManifest,
      datasetId: command.datasetId,
    });
    if (projection.blockedRows !== 0 || projection.issues.length > 0) {
      throw new Error(`Release remains blocked by ${projection.blockedRows} rows`);
    }
    if (projection.projectedGeneratedCount !== command.expectedLines) {
      throw new Error(
        `Projected line count ${projection.projectedGeneratedCount} does not match expected ${command.expectedLines}`,
      );
    }

    const parser = command.skipParserValidation
      ? null
      : await createReleaseParser(prisma, catalog, reviewManifest.decisions);
    const byBase = new Map<
      string,
      { base: ResolvedKlevalkaRow['fishingBase']; rows: ResolvedKlevalkaRow[] }
    >();
    for (const row of retainedRows) {
      const group = byBase.get(row.fishingBase.id) ?? { base: row.fishingBase, rows: [] };
      group.rows.push(row);
      byBase.set(row.fishingBase.id, group);
    }
    const baseGroups = [...byBase.values()].sort(
      (left, right) =>
        normalizeCatalogLookupText(left.base.name).localeCompare(
          normalizeCatalogLookupText(right.base.name),
          'ru',
        ) || left.base.id.localeCompare(right.base.id),
    );

    const releaseFiles: ReleaseFile[] = [];
    const baseTotals: BaseTotal[] = [];
    let generatedLines = 0;
    let generatedBytes = 0;
    let parserValidatedLines = 0;
    let reusedValidatedFiles = 0;
    let reusedValidatedLines = 0;

    for (const [baseIndex, group] of baseGroups.entries()) {
      group.rows.sort(
        (left, right) =>
          tupleKey(left).localeCompare(tupleKey(right)) ||
          left.sourceId.localeCompare(right.sourceId),
      );
      const baseTotal: BaseTotal = {
        id: group.base.id,
        name: group.base.name,
        lines: 0,
        files: 0,
        bytes: 0,
      };
      let lines: string[] = [];
      let expectedRows: ExpectedParserRow[] = [];
      let codeUnits = 0;

      const flush = async (): Promise<void> => {
        if (lines.length === 0) return;
        const content = `${lines.join('\n')}\n`;
        const part = baseTotal.files + 1;
        const relativePath = `catches/${klevalkaBaseSlug(group.base.name)}--${group.base.id}.part-${String(part).padStart(4, '0')}.txt`;
        const absolutePath = join(outputRoot, relativePath);
        const reused = await isExistingIdentical(absolutePath, content);
        if (reused) {
          reusedValidatedFiles += 1;
          reusedValidatedLines += lines.length;
        } else {
          if (parser !== null) await validateGeneratedContent(parser, content, expectedRows);
          await writeIdempotent(absolutePath, content);
        }
        const bytes = Buffer.byteLength(content, 'utf8');
        releaseFiles.push({
          path: relativePath,
          sha256: sha256(content),
          bytes,
          lines: lines.length,
          fishingBaseId: group.base.id,
          fishingBaseName: group.base.name,
        });
        baseTotal.lines += lines.length;
        baseTotal.files += 1;
        baseTotal.bytes += bytes;
        generatedLines += lines.length;
        generatedBytes += bytes;
        if (parser !== null) parserValidatedLines += lines.length;
        lines = [];
        expectedRows = [];
        codeUnits = 0;
      };

      for (const row of group.rows) {
        const int = row.int;
        if (int === null) throw new Error('Retained release row has invalid INT');
        const count = deterministicCatchCount(int, command.datasetId, row.sourceId);
        for (let ordinal = 1; ordinal <= count; ordinal += 1) {
          const weightGrams = deterministicWeight(
            row.minWeightGrams,
            row.maxWeightGrams,
            command.datasetId,
            row.sourceId,
            ordinal,
            klevalkaWeightProfileForBase(row.fishingBase.name),
          );
          const line = formatKlevalkaCatchLine(row, weightGrams);
          const rowCodeUnits = line.length + 1;
          if (
            lines.length > 0 &&
            (lines.length >= KLEVALKA_MAX_LINES_PER_FILE ||
              codeUnits + rowCodeUnits > KLEVALKA_MAX_FILE_CODE_UNITS)
          ) {
            await flush();
          }
          lines.push(line);
          if (parser !== null) {
            expectedRows.push({
              line,
              fishId: row.fish.id,
              fishingBaseId: row.fishingBase.id,
              locationId: row.location.id,
              baitId: row.bait.id,
              weightGrams,
            });
          }
          codeUnits += rowCodeUnits;
        }
      }
      await flush();
      baseTotals.push(baseTotal);
      console.error(
        `generated bases: ${baseIndex + 1}/${baseGroups.length}; lines: ${generatedLines}/${command.expectedLines}`,
      );
    }

    if (
      generatedLines !== command.expectedLines ||
      (parser !== null && parserValidatedLines !== generatedLines) ||
      generatedBytes !== projection.projectedOutputBytes ||
      releaseFiles.length !== projection.projectedOutputFiles
    ) {
      throw new Error('Generated release totals do not match the approved projection');
    }

    const releaseDescriptor = {
      schemaVersion: 1,
      releaseKind: 'KLEVALKA_CATCH_TXT',
      generatorVersion: KLEVALKA_GENERATOR_VERSION,
      sourcePolicyVersion: KLEVALKA_SOURCE_POLICY_VERSION,
      weightDistributionVersion: KLEVALKA_WEIGHT_DISTRIBUTION_VERSION,
      datasetId: command.datasetId,
      snapshotManifestSha256,
      reviewManifestSha256: sha256(reviewManifestText),
      catalogSha256: currentCatalogSha256,
      source: {
        discoveredFish: snapshotManifest.discovery.fishCount,
        validSnapshots: snapshotManifest.pages.length,
        emptySnapshots: snapshotManifest.pages.filter((page) => page.status === 'EMPTY_CONFIRMED')
          .length,
        acceptedSourceSkips: reviewManifest.acceptedSourceFailures,
        sourceRows: projection.sourceRows,
        resolvedRows: projection.resolvedRows,
        excludedRows: projection.excludedRows,
        blockedRows: projection.blockedRows,
        uniqueTuples: projection.uniqueTuples,
        duplicatesRemoved: projection.duplicatesRemoved,
      },
      output: {
        lines: generatedLines,
        files: releaseFiles.length,
        bytes: generatedBytes,
        parserValidation:
          parser === null
            ? { status: 'SKIPPED', lines: 0 }
            : { status: 'PASSED', lines: parserValidatedLines },
      },
      bases: baseTotals,
      files: releaseFiles,
    };
    const releaseSha256 = sha256(stableJson(releaseDescriptor));
    const manifestContent = stableJson({ ...releaseDescriptor, releaseSha256 });
    await writeIdempotent(join(outputRoot, 'manifest.json'), manifestContent);
    const expectedPaths = [...releaseFiles.map((file) => file.path), 'manifest.json'].sort(
      (left, right) => left.localeCompare(right),
    );
    const actualPaths = await listFiles(outputRoot);
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
      throw new Error('Output contains files outside the deterministic release manifest');
    }
    console.log(
      stableJson({
        outputRoot,
        lines: generatedLines,
        files: releaseFiles.length,
        bytes: generatedBytes,
        parserValidatedLines,
        releaseSha256,
        manifestSha256: sha256(manifestContent),
        runtimeSeconds: Math.round((performance.now() - startedAt) / 1000),
        reusedValidatedFiles,
        reusedValidatedLines,
      }).trimEnd(),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runKlevalkaRelease().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
