import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCatalogLookupText } from '../catalog/catalog-lookup.js';
import { parseKlevalkaHtml } from './klevalka-catch-generator.js';
import {
  refineKlevalkaOrdinaryMax,
  type KlevalkaMaxWeightRefinement,
} from './klevalka-max-weight-refinement.js';
import {
  validateAcceptedFailures,
  validateKlevalkaReviewManifest,
  validateKlevalkaSnapshotManifest,
} from './review-klevalka-snapshots.js';

interface Command {
  auditPath: string;
  snapshotsPath: string;
  reviewManifestPath: string;
  outputPath: string;
}

interface SelectedAuditRow {
  fishingBaseName: string;
  fishName: string;
  databaseMaxWeightGrams: number;
  previousInferredMaxWeightGrams: number;
  expectedSourceRows: number;
  expectedLocationDiversity: number;
  expectedBaitDiversity: number;
}

interface RefinedAuditRow extends SelectedAuditRow, KlevalkaMaxWeightRefinement {}

interface EvidenceAccumulator {
  weightsGrams: number[];
  locationNames: string[];
  baitNames: string[];
}

const REQUIRED_AUDIT_COLUMNS = [
  'Base',
  'Fish',
  'DB max',
  'inferred max',
  'source rows',
  'Location diversity',
  'Bait diversity',
  'confidence',
] as const;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaMaxWeightRefinementCommand(args: readonly string[]): Command {
  let auditPath: string | undefined;
  let snapshotsPath: string | undefined;
  let reviewManifestPath: string | undefined;
  let outputPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--audit') auditPath = requiredValue(args, index++, option);
    else if (option === '--snapshots') snapshotsPath = requiredValue(args, index++, option);
    else if (option === '--review-manifest') {
      reviewManifestPath = requiredValue(args, index++, option);
    } else if (option === '--output') outputPath = requiredValue(args, index++, option);
    else throw new Error(`Unknown argument: ${option ?? ''}`);
  }
  if (
    auditPath === undefined ||
    snapshotsPath === undefined ||
    reviewManifestPath === undefined ||
    outputPath === undefined
  ) {
    throw new Error(
      'usage: refine-klevalka-max-weights --audit <absolute TSV> --snapshots <absolute frozen release> --review-manifest <absolute JSON> --output <absolute external TSV>',
    );
  }
  for (const [option, value] of [
    ['--audit', auditPath],
    ['--snapshots', snapshotsPath],
    ['--review-manifest', reviewManifestPath],
    ['--output', outputPath],
  ] as const) {
    if (!isAbsolute(value)) throw new Error(`${option} must be an absolute path`);
  }
  return { auditPath, snapshotsPath, reviewManifestPath, outputPath };
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

function exactInteger(value: string, field: string, rowNumber: number): number {
  if (!/^-?\d+$/u.test(value)) throw new Error(`Invalid ${field} at audit row ${rowNumber}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe ${field} at audit row ${rowNumber}`);
  return parsed;
}

function selectedPairKey(fishingBaseName: string, fishName: string): string {
  return `${normalizeCatalogLookupText(fishingBaseName)}\0${normalizeCatalogLookupText(fishName)}`;
}

export function readSelectedAuditRows(content: string): SelectedAuditRow[] {
  const lines = content.trimEnd().split(/\r?\n/u);
  const header = lines[0]?.split('\t') ?? [];
  const indexes = new Map(header.map((column, index) => [column, index]));
  for (const column of REQUIRED_AUDIT_COLUMNS) {
    if (!indexes.has(column)) throw new Error(`Existing audit is missing column: ${column}`);
  }
  const value = (cells: readonly string[], column: string): string =>
    cells[indexes.get(column) ?? -1] ?? '';
  const selected: SelectedAuditRow[] = [];
  const keys = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = (lines[index] ?? '').split('\t');
    if (value(cells, 'confidence') !== 'HIGH') continue;
    const databaseRaw = value(cells, 'DB max');
    const inferredRaw = value(cells, 'inferred max');
    if (databaseRaw.length === 0 || inferredRaw.length === 0) continue;
    const databaseMaxWeightGrams = exactInteger(databaseRaw, 'DB max', index + 1);
    const previousInferredMaxWeightGrams = exactInteger(inferredRaw, 'inferred max', index + 1);
    if (previousInferredMaxWeightGrams >= databaseMaxWeightGrams) continue;
    const fishingBaseName = value(cells, 'Base');
    const fishName = value(cells, 'Fish');
    const key = selectedPairKey(fishingBaseName, fishName);
    if (keys.has(key)) throw new Error(`Duplicate selected BaseFish in existing audit: ${key}`);
    keys.add(key);
    selected.push({
      fishingBaseName,
      fishName,
      databaseMaxWeightGrams,
      previousInferredMaxWeightGrams,
      expectedSourceRows: exactInteger(value(cells, 'source rows'), 'source rows', index + 1),
      expectedLocationDiversity: exactInteger(
        value(cells, 'Location diversity'),
        'Location diversity',
        index + 1,
      ),
      expectedBaitDiversity: exactInteger(
        value(cells, 'Bait diversity'),
        'Bait diversity',
        index + 1,
      ),
    });
  }
  return selected;
}

function tsvCell(value: string | number | null): string {
  if (value === null) return '';
  return String(value).replace(/[\t\r\n]+/gu, ' ');
}

function refinedRowsTsv(rows: readonly RefinedAuditRow[]): string {
  const header = [
    'Base',
    'Fish',
    'DB max',
    'previous inferred',
    'refined candidate',
    'source rows',
    'near-below count',
    'above-tail count',
    'Locations',
    'Baits',
    'confidence/reason',
  ];
  const lines = rows.map((row) =>
    [
      row.fishingBaseName,
      row.fishName,
      row.databaseMaxWeightGrams,
      row.previousInferredMaxWeightGrams,
      row.refinedCandidateGrams,
      row.sourceRows,
      row.nearBelowCount,
      row.aboveTailCount,
      row.locationDiversity,
      row.baitDiversity,
      `${row.confidence}: ${row.reason}`,
    ]
      .map(tsvCell)
      .join('\t'),
  );
  return `${[header.join('\t'), ...lines].join('\n')}\n`;
}

function orderedRows(rows: readonly RefinedAuditRow[]): RefinedAuditRow[] {
  return [...rows].sort(
    (left, right) =>
      (left.confidence === right.confidence ? 0 : left.confidence === 'HIGH' ? -1 : 1) ||
      right.databaseMaxWeightGrams -
        (right.refinedCandidateGrams ?? right.previousInferredMaxWeightGrams) -
        (left.databaseMaxWeightGrams -
          (left.refinedCandidateGrams ?? left.previousInferredMaxWeightGrams)) ||
      left.fishingBaseName.localeCompare(right.fishingBaseName, 'ru') ||
      left.fishName.localeCompare(right.fishName, 'ru'),
  );
}

function consoleReport(rows: readonly RefinedAuditRow[], outputPath: string): string {
  const high = rows.filter((row) => row.confidence === 'HIGH');
  const unknown = rows.filter((row) => row.confidence === 'UNKNOWN');
  const section = (title: string, sectionRows: readonly RefinedAuditRow[]): string[] => [
    `${title} (${sectionRows.length})`,
    refinedRowsTsv(sectionRows).trimEnd(),
  ];
  return `${[
    ...section('1. CONFIRMED ROUNDED HIGH MISMATCHES', high),
    '',
    ...section('2. HIGH CASES THAT BECAME UNCERTAIN', unknown),
    '',
    `TSV: ${outputPath}`,
  ].join('\n')}\n`;
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

export async function runKlevalkaMaxWeightRefinement(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseKlevalkaMaxWeightRefinementCommand(args);
  const outputPath = await externalOutputPath(command.outputPath);
  const snapshotsRoot = await realpath(command.snapshotsPath);
  if (!(await stat(snapshotsRoot)).isDirectory())
    throw new Error('--snapshots must be a directory');

  const [auditText, manifestText, reviewManifestText] = await Promise.all([
    readFile(command.auditPath, 'utf8'),
    readFile(join(snapshotsRoot, 'manifest.json'), 'utf8'),
    readFile(command.reviewManifestPath, 'utf8'),
  ]);
  const selected = readSelectedAuditRows(auditText);
  const selectedByKey = new Map(
    selected.map((row) => [selectedPairKey(row.fishingBaseName, row.fishName), row]),
  );
  const selectedFish = new Set(selected.map((row) => normalizeCatalogLookupText(row.fishName)));
  const manifest = validateKlevalkaSnapshotManifest(JSON.parse(manifestText) as unknown);
  const reviewManifest = validateKlevalkaReviewManifest(JSON.parse(reviewManifestText) as unknown);
  if (reviewManifest.snapshotManifestSha256 !== sha256(manifestText)) {
    throw new Error('Review manifest checksum does not match the frozen snapshot release');
  }
  validateAcceptedFailures(manifest.failures, reviewManifest.acceptedSourceFailures);

  const mappedFish = new Map<string, string>();
  const relevantMappedFiles = new Set<string>();
  for (const decision of reviewManifest.decisions) {
    if (decision.action !== 'MAP_FISH') continue;
    mappedFish.set(`${decision.sourceFile}\0${decision.sourceFishName}`, decision.targetFishName);
    if (selectedFish.has(normalizeCatalogLookupText(decision.targetFishName))) {
      relevantMappedFiles.add(decision.sourceFile);
    }
  }

  const evidenceByPair = new Map<string, EvidenceAccumulator>();
  for (const entry of manifest.pages) {
    if (
      !selectedFish.has(normalizeCatalogLookupText(entry.name)) &&
      !relevantMappedFiles.has(entry.path)
    ) {
      continue;
    }
    const content = await readFile(join(snapshotsRoot, entry.path), 'utf8');
    if (sha256(content) !== entry.sha256)
      throw new Error(`Snapshot checksum mismatch: ${entry.path}`);
    const page = parseKlevalkaHtml(content, entry.path);
    if (
      page.sourceMode !== 'ALL' ||
      page.issues.length > 0 ||
      page.rows.length !== entry.rowCount
    ) {
      throw new Error(`Frozen snapshot changed adapter result: ${entry.path}`);
    }
    for (const row of page.rows) {
      if (row.sourceWeightGrams === null) continue;
      const fishName = mappedFish.get(`${row.sourceFile}\0${row.fishNameRaw}`) ?? row.fishNameRaw;
      const key = selectedPairKey(row.fishingBaseNameRaw, fishName);
      if (!selectedByKey.has(key)) continue;
      const evidence = evidenceByPair.get(key) ?? {
        weightsGrams: [],
        locationNames: [],
        baitNames: [],
      };
      evidence.weightsGrams.push(row.sourceWeightGrams);
      evidence.locationNames.push(row.locationNameRaw);
      evidence.baitNames.push(row.baitNameRaw);
      evidenceByPair.set(key, evidence);
    }
  }

  const refined = selected.map((row): RefinedAuditRow => {
    const evidence = evidenceByPair.get(selectedPairKey(row.fishingBaseName, row.fishName)) ?? {
      weightsGrams: [],
      locationNames: [],
      baitNames: [],
    };
    const result = refineKlevalkaOrdinaryMax({
      databaseMaxWeightGrams: row.databaseMaxWeightGrams,
      previousInferredMaxWeightGrams: row.previousInferredMaxWeightGrams,
      evidence,
    });
    if (
      result.sourceRows !== row.expectedSourceRows ||
      result.locationDiversity !== row.expectedLocationDiversity ||
      result.baitDiversity !== row.expectedBaitDiversity
    ) {
      throw new Error(`Existing audit evidence changed for ${row.fishingBaseName}/${row.fishName}`);
    }
    return { ...row, ...result };
  });
  const ordered = orderedRows(refined);
  await atomicWrite(outputPath, refinedRowsTsv(ordered));
  process.stdout.write(consoleReport(ordered, outputPath));
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  runKlevalkaMaxWeightRefinement().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Klevalka max-weight refinement failed: ${message}\n`);
    process.exitCode = 1;
  });
}
