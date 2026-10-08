import 'dotenv/config';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from './prisma-adapter.js';
import { parseWeightCell, readWorkbookAuditWorksheets } from './base-fish-weight-audit.js';
import { parseKlevalkaHtml } from '../klevalka-catch-generator/klevalka-catch-generator.js';
import {
  validateAcceptedFailures,
  validateKlevalkaReviewManifest,
  validateKlevalkaSnapshotManifest,
} from '../klevalka-catch-generator/review-klevalka-snapshots.js';
import {
  exactWeightName,
  reconcileWeights,
  weightPairKey,
  type ManualCorrection,
  type ReconciliationInput,
  type WeightPair,
} from './weight-reconciliation.js';

const apiRoot = resolve(import.meta.dirname, '../..');
const catalogRoot = join(apiRoot, 'prisma/catalog-data');
const defaultOutput = join(apiRoot, '.local/weight-reconciliation-v1/report');

/** Хэш среза позволяет связать постоянное решение с неизменным доказательством. */
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** CLI не имеет режима применения; создание манифеста явно отделено от повторного анализа. */
export function parseWeightReconciliationCommand(args: string[]) {
  const allowed = new Set([
    '--input',
    '--output',
    '--create-manifest',
    '--klevalka-snapshots',
    '--review-manifest',
  ]);
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) {
      throw new Error(
        'Usage: reconcile-all-weights.ts [--input frozen.json] [--output report-prefix] [--create-manifest new-version.json] [--klevalka-snapshots release --review-manifest decisions.json]',
      );
    }
    options[args[i]] = resolve(args[i + 1]);
  }
  if (Boolean(options['--klevalka-snapshots']) !== Boolean(options['--review-manifest'])) {
    throw new Error('Klevalka snapshots require their reviewed identity manifest');
  }
  if (options['--input'] && options['--klevalka-snapshots'])
    throw new Error('Frozen input already includes its source evidence');
  return {
    input: options['--input'],
    output: options['--output'] ?? defaultOutput,
    manifest: options['--create-manifest'],
    snapshots: options['--klevalka-snapshots'],
    review: options['--review-manifest'],
  };
}

/** Читает каталог и историю в одной защищённой транзакции без доступа к CatchReport. */
async function captureDatabase(prisma: PrismaClient): Promise<ReconciliationInput> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const [guard] = await tx.$queryRaw<Array<{ readonly: string; capturedAt: Date }>>`
      SELECT current_setting('transaction_read_only') AS readonly, transaction_timestamp() AS "capturedAt"`;
      if (guard.readonly !== 'on') throw new Error('Database transaction must be READ ONLY');
      const pairs = await tx.fishingBaseFish.findMany({
        select: {
          fishId: true,
          fishingBaseId: true,
          minWeightGrams: true,
          maxWeightGrams: true,
          fish: { select: { name: true, forumTopicId: true } },
          fishingBase: { select: { name: true } },
        },
        orderBy: [{ fishId: 'asc' }, { fishingBaseId: 'asc' }],
      });
      const issues = await tx.fishWrongMaxIssue.findMany({
        select: { fishId: true, expectedWeightGrams: true, note: true, updatedAt: true },
        orderBy: { fishId: 'asc' },
      });
      const snapshots = await tx.officialRecordSnapshot.findMany({
        select: { id: true, weekStartsAt: true, fetchedAt: true },
        orderBy: [{ weekStartsAt: 'asc' }, { fetchedAt: 'asc' }, { id: 'asc' }],
      });
      const observations = await tx.$queryRaw<
        Array<{
          weekStartsAt: Date;
          fishId: string;
          fishingBaseId: string | null;
          weightGrams: number;
          waterbodyRaw: string;
          caughtAt: Date;
          copies: number;
        }>
      >(Prisma.sql`
      SELECT s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams", r."waterbodyRaw", r."caughtAt", count(*)::int AS copies
      FROM "OfficialRecordSnapshotRow" r JOIN "OfficialRecordSnapshot" s ON s.id = r."snapshotId"
      GROUP BY s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams", r."waterbodyRaw", r."caughtAt"
      ORDER BY s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams", r."waterbodyRaw", r."caughtAt"`);
      const catalog = pairs.map(({ fish, fishingBase, ...p }) => ({
        ...p,
        fishName: fish.name,
        baseName: fishingBase.name,
        forumTopicId: fish.forumTopicId,
      }));
      return {
        capturedAt: guard.capturedAt.toISOString(),
        head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        pairs: catalog,
        issues: issues.map((i) => ({ ...i, updatedAt: i.updatedAt.toISOString() })),
        official: {
          pairs: catalog,
          snapshots: snapshots.map((s) => ({
            ...s,
            weekStartsAt: s.weekStartsAt.toISOString(),
            fetchedAt: s.fetchedAt.toISOString(),
          })),
          observations: observations.map((o) => ({
            ...o,
            weekStartsAt: o.weekStartsAt.toISOString(),
            caughtAt: o.caughtAt.toISOString(),
          })),
        },
        klevalka: {},
        workbook: {},
        historicalCorrections: [],
        mappingReviews: [],
        sources: [
          {
            kind: 'POSTGRES_READ_ONLY',
            reference: 'FishingBaseFish + FishWrongMaxIssue + OfficialRecordSnapshot/Row',
            limitation:
              'Single RepeatableRead transaction; distinct observations retain refresh-copy counts; records contain Base, no Location.',
          },
        ],
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 60000 },
  );
}

/** Привязка допускается лишь при одной точной паре; неоднозначности записываются для REVIEW. */
function exactPair(pairs: WeightPair[], fish: string, base: string, topic?: string) {
  const matches = pairs.filter(
    (p) =>
      exactWeightName(p.fishName) === exactWeightName(fish) &&
      exactWeightName(p.baseName) === exactWeightName(base) &&
      (topic === undefined || p.forumTopicId === topic),
  );
  return matches.length === 1 ? matches[0] : null;
}

/** Перечитывает настоящие XLSX-ячейки, используя уже принятые идентичности импорта. */
async function addWorkbook(input: ReconciliationInput) {
  const workbookPath = join(apiRoot, '.local/catalog/Klevalka-2026.xlsx');
  const manifestPath = join(catalogRoot, 'fishing-base-fish-weights.json');
  const [bytes, manifestBytes] = await Promise.all([
    readFile(workbookPath),
    readFile(manifestPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString()) as {
    sources: { workbookSha256: string };
    entries: Array<{
      baseName: string;
      canonicalFish: string;
      forumTopicId: string;
      minWeightGrams: number | null;
      maxWeightGrams: number | null;
      resolution: string;
      sourceRows: Array<{ sourceSheet: string; minCell: string; maxCell: string }>;
    }>;
  };
  if (sha256(bytes) !== manifest.sources.workbookSha256)
    throw new Error('Accepted Klevalka workbook checksum mismatch');
  const sheets = readWorkbookAuditWorksheets(bytes, [
    ...new Set(manifest.entries.flatMap((e) => e.sourceRows.map((s) => s.sourceSheet))),
  ]);
  for (const entry of manifest.entries) {
    const pair = exactPair(input.pairs, entry.canonicalFish, entry.baseName, entry.forumTopicId);
    if (!pair) {
      input.mappingReviews.push({
        reference: `${manifestPath}:${entry.baseName}/${entry.canonicalFish}`,
        reason: 'NO_UNIQUE_EXACT_ACCEPTED_PAIR',
      });
      continue;
    }
    for (const row of entry.sourceRows) {
      const cells = sheets.get(row.sourceSheet);
      const min = parseWeightCell(row.minCell, cells?.get(row.minCell));
      const max = parseWeightCell(row.maxCell, cells?.get(row.maxCell));
      if (
        entry.resolution === 'SOURCE' &&
        (min.valueGrams !== entry.minWeightGrams || max.valueGrams !== entry.maxWeightGrams)
      ) {
        throw new Error(
          `Workbook cell/accepted manifest mismatch: ${entry.baseName}/${entry.canonicalFish}`,
        );
      }
    }
    input.workbook[weightPairKey(pair)] = {
      min: entry.minWeightGrams,
      max: entry.maxWeightGrams,
      references: entry.sourceRows.map(
        (r) => `Klevalka-2026.xlsx#${r.sourceSheet}!${r.minCell},${r.maxCell}`,
      ),
    };
  }
  input.sources.push(
    {
      kind: 'KLEVALKA_WORKBOOK',
      reference: workbookPath,
      sha256: sha256(bytes),
      limitation:
        'Catalog origin, not independent validation; accepted mapped bounds and raw cells reread, reviewed overrides retained.',
    },
    {
      kind: 'ACCEPTED_WORKBOOK_IDENTITIES',
      reference: manifestPath,
      sha256: sha256(manifestBytes),
      limitation: 'Exact canonical Fish + Base + forumTopicId; no fuzzy matching.',
    },
  );
  const patchPath = join(catalogRoot, 'base-fish-max-weight-patch-20260909.json');
  const patchBytes = await readFile(patchPath);
  const patch = JSON.parse(patchBytes.toString()) as {
    entries: Array<{
      canonicalFish: string;
      baseName: string;
      previousMaxWeightGrams: number | null;
      maxWeightGrams: number;
    }>;
  };
  input.historicalCorrections = patch.entries.map((e): ManualCorrection => ({
    fishName: e.canonicalFish,
    baseName: e.baseName,
    oldMaxWeightGrams: e.previousMaxWeightGrams ?? null,
    proposedMaxWeightGrams: e.maxWeightGrams,
    reference: `base-fish-max-weight-patch-20260909.json:${e.baseName}/${e.canonicalFish}`,
  }));
  input.sources.push(
    {
      kind: 'HISTORICAL_APPROVED_CORRECTIONS_BENCHMARK_ONLY',
      reference: patchPath,
      sha256: sha256(patchBytes),
      limitation:
        'Historical approved catalog patch; never treated as new independent evidence for current corrections.',
    },
    {
      kind: 'MANUAL_REVIEW',
      reference: 'user-confirmed-review:2026-10-04',
      limitation: 'Nine exact max decisions; no confirmed min decisions.',
    },
  );
}

/** Необязательные замороженные HTML дают только исходные, никогда сгенерированные веса. */
async function addKlevalka(
  input: ReconciliationInput,
  root: string,
  reviewPath: string,
  prisma: PrismaClient,
) {
  const [manifestBytes, reviewBytes] = await Promise.all([
    readFile(join(root, 'manifest.json')),
    readFile(reviewPath),
  ]);
  const manifest = validateKlevalkaSnapshotManifest(
    JSON.parse(manifestBytes.toString()) as unknown,
  );
  const review = validateKlevalkaReviewManifest(JSON.parse(reviewBytes.toString()) as unknown);
  if (review.snapshotManifestSha256 !== sha256(manifestBytes))
    throw new Error('Klevalka review hash mismatch');
  validateAcceptedFailures(manifest.failures, review.acceptedSourceFailures);
  const locations = await prisma.location.findMany({
    select: { id: true, name: true, fishingBaseId: true },
  });
  for (const entry of manifest.pages) {
    const path = resolve(root, entry.path);
    if (!path.startsWith(`${resolve(root)}/`)) throw new Error('Snapshot path escapes release');
    const bytes = await readFile(path);
    if (sha256(bytes) !== entry.sha256)
      throw new Error(`Klevalka page hash mismatch: ${entry.path}`);
    const page = parseKlevalkaHtml(bytes.toString(), entry.path);
    if (page.sourceMode !== 'ALL' || page.rows.length !== entry.rowCount || page.issues.length) {
      if (entry.status !== 'EMPTY_CONFIRMED' || page.rows.length)
        throw new Error(`Invalid frozen page: ${entry.path}`);
    }
    for (const row of page.rows) {
      const decision = review.decisions.find(
        (d) =>
          d.action === 'MAP_FISH' &&
          d.sourceFile === row.sourceFile &&
          d.sourceFishName === row.fishNameRaw,
      );
      const pairs = input.pairs.filter((p) =>
        decision?.action === 'MAP_FISH'
          ? p.fishId === decision.targetFishId && p.fishName === decision.targetFishName
          : exactWeightName(p.fishName) === exactWeightName(row.fishNameRaw),
      );
      const pair = exactPair(pairs, pairs[0]?.fishName ?? row.fishNameRaw, row.fishingBaseNameRaw);
      const matchingLocations = pair
        ? locations.filter(
            (l) =>
              l.fishingBaseId === pair.fishingBaseId &&
              exactWeightName(l.name) === exactWeightName(row.locationNameRaw),
          )
        : [];
      if (
        !pair ||
        matchingLocations.length !== 1 ||
        row.sourceWeightGrams === null ||
        row.sourceWeightGrams <= 0
      ) {
        input.mappingReviews.push({
          reference: `${entry.path}#row-${row.sourceRow}`,
          reason: 'FISH_BASE_LOCATION_OR_WEIGHT_UNRESOLVED',
        });
        continue;
      }
      const key = weightPairKey(pair);
      const source = input.klevalka[key] ?? {
        weightsGrams: [],
        locations: [],
        baits: [],
        references: [],
      };
      source.weightsGrams.push(row.sourceWeightGrams);
      source.locations.push(row.locationNameRaw);
      source.baits.push(row.baitNameRaw);
      source.references.push(
        `${entry.path}@${entry.sha256}#row-${row.sourceRow}:location-${matchingLocations[0].id}`,
      );
      input.klevalka[key] = source;
    }
  }
  input.sources.push({
    kind: 'KLEVALKA_FROZEN_HTML',
    reference: root,
    sha256: sha256(manifestBytes),
    limitation:
      'Exact or explicitly reviewed Fish mapping, exact Base/Location; source weights only.',
  });
}

/** Markdown содержит каждую пару; подробные доказательства хранятся рядом в JSON. */
function markdown(report: ReturnType<typeof reconcileWeights>, hash: string, inputPath: string) {
  const lines = [
    '# Read-only FishingBaseFish weight reconciliation v1',
    '',
    `Input: ${inputPath}; SHA-256: ${hash}. All weights are integer grams.`,
    '',
    'No catalog, CatchReport, txt or schema writes. Classification CONFIRMED covers an explicit max decision only; minima have separate assessments. A retained min is not independently confirmed.',
    '',
    `Counts: ${JSON.stringify(report.counts)}`,
    `Small weights: ${JSON.stringify(report.smallWeight)}`,
    '',
    `Benchmark review: ${JSON.stringify({ ...report.benchmark.review, cases: undefined })}`,
    `Benchmark admin: ${JSON.stringify({ ...report.benchmark.admin, cases: undefined })}`,
    `Benchmark historical: ${JSON.stringify({ ...report.benchmark.historical, cases: undefined })}`,
    '',
    `Inference trusted globally: ${report.policy.inferenceTrusted}. Every benchmark Fish is excluded from training grids, control saturation and mutant regimes. Abstentions count against exact-match accuracy. No manual expected value is fed to inference.`,
    '',
    'Small means either current or proposed max <=5,000 g. Every nonzero gram difference is retained alongside relative difference. Sparse records do not prove a cap or a minimum. Same-Fish Base differences and grid membership alone do not prove an error. All catalog/grid signals share provenance.',
    '',
    'Sources:',
    ...report.sources.map((s) => `- ${s.kind}: ${s.reference}; ${s.sha256 ?? ''}; ${s.limitation}`),
    '',
    `Mapping reviews: ${report.mappingReviews.length}; detailed entries in JSON.`,
    '',
    '| Status | Fish / Base | Fish ID / Base ID | Current min / max g | Proposed min / max g | Delta g / relative | Min assessment | Confidence | Deterministic reason |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of report.rows)
    lines.push(
      `| ${r.status} | ${r.fishName} / ${r.baseName} | ${r.fishId} / ${r.fishingBaseId} | ${r.minWeightGrams ?? '?'} / ${r.maxWeightGrams ?? '?'} | ${r.proposedMinWeightGrams ?? '?'} / ${r.proposedMaxWeightGrams ?? '?'} | ${r.maxDeltaGrams ?? '?'} / ${r.maxRelativeDifference === null ? '?' : `${(r.maxRelativeDifference * 100).toFixed(4)}%`} | ${r.minAssessment.reason} | ${r.confidence} | ${r.reason} |`,
    );
  return `${lines.join('\n')}\n`;
}

/** Сохранённый манифест создаётся один раз: повторный анализ не перезаписывает решения. */
async function main() {
  const command = parseWeightReconciliationCommand(process.argv.slice(2));
  await mkdir(dirname(command.output), { recursive: true });
  let input: ReconciliationInput;
  if (command.input)
    input = JSON.parse(await readFile(command.input, 'utf8')) as ReconciliationInput;
  else {
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required for a fresh read-only capture');
    const prisma = new PrismaClient({ adapter: createPrismaAdapter(process.env.DATABASE_URL) });
    try {
      input = await captureDatabase(prisma);
      await addWorkbook(input);
      if (command.snapshots && command.review)
        await addKlevalka(input, command.snapshots, command.review, prisma);
    } finally {
      await prisma.$disconnect();
    }
  }
  const inputBytes = `${JSON.stringify(input, null, 2)}\n`;
  const inputHash = sha256(inputBytes);
  const report = reconcileWeights(input);
  // Адрес по хэшу сохраняет доказательства старого манифеста при новом захвате БД.
  const inputPath = join(dirname(command.output), 'evidence', `${inputHash}.json`);
  await mkdir(dirname(inputPath), { recursive: true });
  try {
    await writeFile(inputPath, inputBytes, { flag: 'wx' });
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
      sha256(await readFile(inputPath)) !== inputHash
    )
      throw error;
  }
  // Удобное имя первого среза тоже неизменно: обычный rerun не теряет его источник.
  if (!command.input) {
    try {
      await writeFile(`${command.output}.input.json`, inputBytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  await writeFile(
    `${command.output}.json`,
    `${JSON.stringify({ inputHash, inputPath, ...report }, null, 2)}\n`,
  );
  await writeFile(`${command.output}.md`, markdown(report, inputHash, inputPath));
  if (command.manifest) {
    await mkdir(dirname(command.manifest), { recursive: true });
    await writeFile(
      command.manifest,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          version: basename(command.manifest, '.json'),
          createdFromCaptureAt: input.capturedAt,
          mode: 'DECISIONS_ONLY_NOT_APPLIED',
          baselineHead: input.head,
          evidenceInput: { path: inputPath, sha256: inputHash },
          applicationPolicy:
            'Only SAFE_TO_CORRECT or explicitly confirmed decisions may be considered later. Revalidate old bounds and IDs. Review/conflict hypotheses are holds, not instructions to apply. Retained min is unconfirmed. All three application flags start false.',
          entries: report.decisions,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    );
  }
  console.log(
    JSON.stringify(
      {
        report: `${command.output}.md`,
        inputHash,
        totalPairs: report.totalPairs,
        counts: report.counts,
        smallWeight: report.smallWeight,
        benchmark: Object.fromEntries(
          Object.entries(report.benchmark).map(([k, b]) => [k, { ...b, cases: undefined }]),
        ),
        inferenceTrusted: report.policy.inferenceTrusted,
        manifest: command.manifest ?? 'unchanged',
        mappingReviews: report.mappingReviews.length,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
