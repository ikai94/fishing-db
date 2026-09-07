import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CatchReportParserService } from '../catch-reports/parser/catch-report-parser.service.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import {
  KLEVALKA_GENERATOR_VERSION,
  KLEVALKA_SOURCE_POLICY_VERSION,
  KLEVALKA_WEIGHT_DISTRIBUTION_VERSION,
  generateKlevalkaCatches,
  parseKlevalkaHtml,
  type GeneratedCatchFile,
  type KlevalkaCatalogSnapshot,
  type MappingDecision,
} from './klevalka-catch-generator.js';

interface Command {
  sourcePath: string;
  workspacePath: string;
  datasetId: string;
  decisionsPath?: string;
  maxTuples?: number;
}

interface SourceFile {
  relativePath: string;
  absolutePath: string;
  content: string;
  sha256: string;
}

export type KlevalkaRunMode = 'DRY_RUN' | 'BLOCKED_REVIEW' | 'EXPORT_READY';

export function determineKlevalkaRunMode(input: {
  maxTuples?: number;
  blockedRowCount: number;
  reviewIssueCount: number;
}): KlevalkaRunMode {
  if (input.maxTuples !== undefined) return 'DRY_RUN';
  return input.blockedRowCount > 0 || input.reviewIssueCount > 0
    ? 'BLOCKED_REVIEW'
    : 'EXPORT_READY';
}

function sha256(value: string): string {
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

export function parseKlevalkaGeneratorCommand(args: readonly string[]): Command {
  let sourcePath: string | undefined;
  let workspacePath: string | undefined;
  let decisionsPath: string | undefined;
  let datasetId = 'klevalka-html-v1';
  let maxTuples: number | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--source') sourcePath = requiredValue(args, index++, option);
    else if (option === '--workspace') workspacePath = requiredValue(args, index++, option);
    else if (option === '--decisions') decisionsPath = requiredValue(args, index++, option);
    else if (option === '--dataset-id') datasetId = requiredValue(args, index++, option);
    else if (option === '--max-tuples') {
      const rawValue = requiredValue(args, index++, option);
      if (!/^[1-9]\d*$/u.test(rawValue)) throw new Error('--max-tuples must be a positive integer');
      maxTuples = Number(rawValue);
      if (!Number.isSafeInteger(maxTuples)) throw new Error('--max-tuples is too large');
    } else {
      throw new Error(`Unknown argument: ${option ?? ''}`);
    }
  }
  if (sourcePath === undefined || workspacePath === undefined) {
    throw new Error(
      'usage: generate-klevalka-catches --source <absolute HTML file/directory> --workspace <absolute external directory> [--decisions <absolute JSON>] [--dataset-id <id>] [--max-tuples <count>]',
    );
  }
  for (const [label, value] of [
    ['--source', sourcePath],
    ['--workspace', workspacePath],
    ['--decisions', decisionsPath],
  ] as const) {
    if (value !== undefined && !isAbsolute(value))
      throw new Error(`${label} must be an absolute path`);
  }
  if (datasetId.trim().length === 0) throw new Error('--dataset-id must not be empty');
  return { sourcePath, workspacePath, decisionsPath, datasetId, maxTuples };
}

async function listHtmlFiles(
  sourcePath: string,
): Promise<Array<{ relativePath: string; absolutePath: string }>> {
  const sourceStats = await stat(sourcePath);
  if (sourceStats.isFile()) {
    if (!/\.html?$/iu.test(sourcePath))
      throw new Error('--source file must have an .html or .htm extension');
    return [{ relativePath: basename(sourcePath), absolutePath: sourcePath }];
  }
  if (!sourceStats.isDirectory()) throw new Error('--source must be an HTML file or directory');

  const found: Array<{ relativePath: string; absolutePath: string }> = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolutePath);
      else if (entry.isFile() && /\.html?$/iu.test(entry.name)) {
        found.push({ relativePath: relative(sourcePath, absolutePath), absolutePath });
      }
    }
  }
  await visit(sourcePath);
  if (found.length === 0) throw new Error('--source directory contains no HTML files');
  return found.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function readSources(sourcePath: string): Promise<SourceFile[]> {
  const files = await listHtmlFiles(sourcePath);
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(file.absolutePath, 'utf8');
      return { ...file, content, sha256: sha256(content) };
    }),
  );
}

async function assertExternalWorkspace(workspacePath: string): Promise<string> {
  const repositoryRoot = await realpath(resolve(import.meta.dirname, '../../../..'));
  const requestedWorkspace = resolve(workspacePath);
  const requestedFromRepository = relative(repositoryRoot, requestedWorkspace);
  if (
    requestedFromRepository === '' ||
    (!requestedFromRepository.startsWith(`..${sep}`) && requestedFromRepository !== '..')
  ) {
    throw new Error(`--workspace must resolve outside the repository: ${repositoryRoot}`);
  }
  await mkdir(workspacePath, { recursive: true });
  const workspaceRoot = await realpath(workspacePath);
  const fromRepository = relative(repositoryRoot, workspaceRoot);
  if (
    fromRepository === '' ||
    (!fromRepository.startsWith(`..${sep}`) && fromRepository !== '..')
  ) {
    throw new Error(`--workspace must resolve outside the repository: ${repositoryRoot}`);
  }
  return workspaceRoot;
}

type KlevalkaCatalogDatabase = Pick<
  PrismaClient,
  'fishingBase' | 'fish' | 'bait' | 'fishingBaseFish'
>;

export async function loadCurrentKlevalkaCatalog(
  prisma: KlevalkaCatalogDatabase,
): Promise<KlevalkaCatalogSnapshot> {
  const [fishingBases, fish, baits, memberships] = await Promise.all([
    prisma.fishingBase.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        locations: {
          where: { isActive: true },
          orderBy: [{ number: 'asc' }, { nameNormalized: 'asc' }, { id: 'asc' }],
          select: { id: true, number: true, name: true },
        },
      },
    }),
    prisma.fish.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    }),
    prisma.bait.findMany({
      where: { isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, type: true },
    }),
    prisma.fishingBaseFish.findMany({
      where: { fishingBase: { isActive: true }, fish: { isActive: true } },
      orderBy: [{ fishingBaseId: 'asc' }, { fishId: 'asc' }],
      select: { fishingBaseId: true, fishId: true, minWeightGrams: true, maxWeightGrams: true },
    }),
  ]);
  return { schemaVersion: 1, fishingBases, fish, baits, memberships };
}

function readDecisions(value: unknown): MappingDecision[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('schemaVersion' in value) ||
    !('decisions' in value)
  ) {
    throw new Error('Review decisions must contain schemaVersion and decisions');
  }
  const input = value;
  if (input.schemaVersion !== 1 || !Array.isArray(input.decisions)) {
    throw new Error('Review decisions schemaVersion must be 1 and decisions must be an array');
  }
  const decisions: MappingDecision[] = [];
  const sourceIds = new Set<string>();
  for (const entry of input.decisions) {
    if (typeof entry !== 'object' || entry === null)
      throw new Error('Each review decision must be an object');
    const record = entry as Record<string, unknown>;
    if (typeof record.sourceId !== 'string' || !/^[a-f0-9]{64}$/u.test(record.sourceId)) {
      throw new Error('Each review decision needs a SHA-256 sourceId');
    }
    if (sourceIds.has(record.sourceId))
      throw new Error(`Duplicate review decision: ${record.sourceId}`);
    sourceIds.add(record.sourceId);
    if (
      record.action === 'EXCLUDE' &&
      typeof record.reason === 'string' &&
      record.reason.trim().length > 0
    ) {
      decisions.push({ sourceId: record.sourceId, action: 'EXCLUDE', reason: record.reason });
      continue;
    }
    if (record.action === 'MAP') {
      if (typeof record.reason !== 'string' || record.reason.trim().length === 0) {
        throw new Error(`MAP review decision ${record.sourceId} requires a reason`);
      }
      const ids: Record<string, string> = {};
      for (const key of ['fishId', 'fishingBaseId', 'locationId', 'baitId'] as const) {
        if (record[key] !== undefined) {
          if (typeof record[key] !== 'string') throw new Error(`${key} must be a string`);
          ids[key] = record[key];
        }
      }
      decisions.push({ sourceId: record.sourceId, action: 'MAP', reason: record.reason, ...ids });
      continue;
    }
    throw new Error(`Invalid review decision for ${record.sourceId}`);
  }
  return decisions;
}

async function validateGeneratedFiles(
  parser: CatchReportParserService,
  files: readonly GeneratedCatchFile[],
): Promise<number> {
  let validated = 0;
  for (const file of files) {
    const parsed = await parser.parseBatch(file.content);
    if (parsed.rows.length !== file.rows.length)
      throw new Error(`Parser row count mismatch for ${file.relativePath}`);
    for (const [index, parsedRow] of parsed.rows.entries()) {
      const expected = file.rows[index];
      if (expected === undefined) throw new Error(`Generated row ${index} is missing`);
      const draft = parsedRow.draft;
      const actual = {
        fishId: draft.fields.fish.value?.id,
        fishingBaseId: draft.fields.fishingBase.value?.id,
        locationId: draft.fields.location.value?.id,
        baitId: draft.fields.bait.value?.id,
        weightGrams: draft.fields.weightGrams.value,
      };
      if (
        !draft.canConfirm ||
        actual.fishId !== expected.fishId ||
        actual.fishingBaseId !== expected.fishingBaseId ||
        actual.locationId !== expected.locationId ||
        actual.baitId !== expected.baitId ||
        actual.weightGrams !== expected.weightGrams ||
        draft.fields.holeDepthCm.value !== null ||
        draft.fields.spotPositionRaw.value !== null ||
        draft.fields.fishingNote.value !== null ||
        draft.fields.userNoteRaw.value !== null
      ) {
        throw new Error(`Generated line failed parser round-trip: ${expected.line}`);
      }
      const unexpectedIssues = draft.issues.filter((issue) => issue.code !== 'DUPLICATE_INPUT_ROW');
      if (unexpectedIssues.length > 0) {
        throw new Error(
          `Generated line has parser issues: ${expected.line} (${unexpectedIssues.map((issue) => issue.code).join(', ')})`,
        );
      }
      validated += 1;
    }
  }
  return validated;
}

async function writeIdempotent(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path, 'utf8');
    if (existing !== content)
      throw new Error(`Refusing to replace different existing artifact: ${path}`);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
  }
}

export async function runKlevalkaGenerator(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseKlevalkaGeneratorCommand(args);
  const workspaceRoot = await assertExternalWorkspace(command.workspacePath);
  const sourceFiles = await readSources(command.sourcePath);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is required to read the current catalog');
  const decisions =
    command.decisionsPath === undefined
      ? []
      : readDecisions(JSON.parse(await readFile(command.decisionsPath, 'utf8')) as unknown);
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const catalog = await loadCurrentKlevalkaCatalog(prisma);
    const pages = sourceFiles.map((file) => parseKlevalkaHtml(file.content, file.relativePath));
    const result = generateKlevalkaCatches({
      pages,
      catalog,
      datasetId: command.datasetId,
      decisions,
      maxTuples: command.maxTuples,
    });
    const blockedRowCount = result.reviewRows.filter((row) => row.status === 'BLOCKED').length;
    const mode = determineKlevalkaRunMode({
      maxTuples: command.maxTuples,
      blockedRowCount,
      reviewIssueCount: result.reviewIssues.length,
    });
    const releasedFiles = mode === 'BLOCKED_REVIEW' ? [] : result.generatedFiles;
    const parserValidatedCount = await validateGeneratedFiles(
      new CatchReportParserService(prisma as never),
      releasedFiles,
    );
    const provenance = {
      generatorVersion: KLEVALKA_GENERATOR_VERSION,
      sourcePolicyVersion: KLEVALKA_SOURCE_POLICY_VERSION,
      weightDistributionVersion: KLEVALKA_WEIGHT_DISTRIBUTION_VERSION,
      datasetId: command.datasetId,
      sourceFiles: sourceFiles.map((file) => ({ path: file.relativePath, sha256: file.sha256 })),
      sourceModes: pages.map((page) => ({ path: page.sourceFile, mode: page.sourceMode })),
      catalogSha256: sha256(stableJson(catalog)),
      decisionsSha256: sha256(stableJson({ schemaVersion: 1, decisions })),
      maxTuples: command.maxTuples ?? null,
    };
    const releaseId = sha256(stableJson(provenance)).slice(0, 16);
    const releaseRoot = join(workspaceRoot, `${KLEVALKA_GENERATOR_VERSION}-${releaseId}`);
    const artifacts = new Map<string, string>([
      ['catalog.json', stableJson(catalog)],
      [
        'review.json',
        stableJson({ schemaVersion: 1, issues: result.reviewIssues, rows: result.reviewRows }),
      ],
      ['source-manifest.json', stableJson({ schemaVersion: 1, ...provenance })],
    ]);
    for (const file of releasedFiles) artifacts.set(file.relativePath, file.content);
    const manifest = {
      schemaVersion: 1,
      mode,
      ...provenance,
      sourceRowCount: pages.reduce((sum, page) => sum + page.rows.length, 0),
      eligibleTupleCount: result.eligibleTupleCount,
      selectedTupleCount: result.retainedRows.length,
      ignoredDuplicateCount: result.ignoredDuplicateCount,
      blockedRowCount,
      excludedRowCount: result.reviewRows.filter((row) => row.status === 'EXCLUDED').length,
      candidateGeneratedCount: result.generatedCount,
      releasedGeneratedCount: releasedFiles.reduce((sum, file) => sum + file.rows.length, 0),
      parserValidatedCount,
      files: [...artifacts.entries()]
        .map(([path, content]) => ({ path, sha256: sha256(content) }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
    artifacts.set('manifest.json', stableJson(manifest));
    for (const [path, content] of [...artifacts.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      await writeIdempotent(join(releaseRoot, path), content);
    }
    console.info(
      stableJson({
        releaseRoot,
        mode,
        sourceRows: manifest.sourceRowCount,
        eligibleTuples: manifest.eligibleTupleCount,
        selectedTuples: manifest.selectedTupleCount,
        ignoredDuplicates: manifest.ignoredDuplicateCount,
        blockedRows: manifest.blockedRowCount,
        generatedLines: manifest.releasedGeneratedCount,
        parserValidatedLines: manifest.parserValidatedCount,
      }).trimEnd(),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runKlevalkaGenerator().catch((error: unknown) => {
    console.error(
      `Klevalka generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    process.exitCode = 1;
  });
}
