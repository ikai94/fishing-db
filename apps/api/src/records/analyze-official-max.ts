import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { analyzeOfficialMax, type OfficialMaxInput } from './official-max-analysis.js';

/** Читает согласованный срез без запуска Nest и фонового синхронизатора. */
export async function loadOfficialMaxInput(prisma: PrismaClient): Promise<OfficialMaxInput> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const snapshots = await tx.officialRecordSnapshot.findMany({
        select: { id: true, weekStartsAt: true, fetchedAt: true },
        orderBy: [{ weekStartsAt: 'asc' }, { fetchedAt: 'asc' }, { id: 'asc' }],
      });
      const pairs = await tx.fishingBaseFish.findMany({
        select: {
          fishId: true,
          fishingBaseId: true,
          maxWeightGrams: true,
          fish: { select: { name: true } },
          fishingBase: { select: { name: true } },
        },
        orderBy: [{ fishId: 'asc' }, { fishingBaseId: 'asc' }],
      });
      // SQL сворачивает почти миллион копий на стороне БД, сохраняя каждое изменение рекорда.
      // Снимок уже содержит принятую привязку водоёма к базе; Location ID в источнике отсутствует.
      const observations = await tx.$queryRaw<
        Array<{
          weekStartsAt: Date;
          fishId: string;
          fishingBaseId: string | null;
          fishName: string;
          baseName: string | null;
          weightGrams: number;
          waterbodyRaw: string;
          caughtAt: Date;
          copies: number;
        }>
      >(Prisma.sql`
      SELECT s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams",
             f.name AS "fishName", b.name AS "baseName",
             r."waterbodyRaw", r."caughtAt", count(*)::int AS copies
      FROM "OfficialRecordSnapshotRow" r
      JOIN "OfficialRecordSnapshot" s ON s.id = r."snapshotId"
      JOIN "Fish" f ON f.id = r."fishId"
      LEFT JOIN "FishingBase" b ON b.id = r."fishingBaseId"
      GROUP BY s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams",
               f.name, b.name, r."waterbodyRaw", r."caughtAt"
      ORDER BY s."weekStartsAt", r."fishId", r."fishingBaseId", r."weightGrams",
               r."waterbodyRaw", r."caughtAt"
    `);
      return {
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
        pairs: pairs.map(({ fish, fishingBase, ...pair }) => ({
          ...pair,
          fishName: fish.name,
          baseName: fishingBase.name,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 60_000 },
  );
}

/** Полный Markdown сохраняет недельные веса каждой пары рядом с воспроизводимой причиной. */
function markdown(report: ReturnType<typeof analyzeOfficialMax>, sourceHash: string): string {
  const lines = [
    '# Official BaseFish max candidates',
    '',
    `Input SHA-256: ${sourceHash}. All weights are integer grams.`,
    '',
    'Analysis only; PostgreSQL READ ONLY transaction; CatchReport is never queried.',
    '',
    `Counts: ${JSON.stringify(report.counts)}`,
    '',
    `History: ${JSON.stringify(report.history)}`,
    '',
    `Missing weeks between earliest and latest available history: ${JSON.stringify(report.missingWeeks)}`,
    '',
    `Calibration: ${JSON.stringify(report.calibration)}`,
    '',
    `Ratio calibration: ${JSON.stringify(report.ratioAnalysis.counts)}`,
    '',
    `Near 1.00: ${JSON.stringify(report.ratioAnalysis.nearOne)}`,
    '',
    `Discovered ratio bands: ${JSON.stringify(report.ratioAnalysis.bands)}`,
    '',
    'Independent support means distinct source weeks, never snapshot refreshes. Every unique weekly weight is retained, including early records displaced later or on another Base. A 1% cluster needs at least two weeks; HIGH needs three weeks, three distinct weights and >=20 calibration pairs. Apparently correct controls have three weekly highs within 98–100% of current max and <=1% spread. Candidate range is cluster upper weight through upper / lowest control saturation ratio.',
    '',
    'Ratio controls require a repeated <=1% normal cluster at 98–100% of current max; higher observations remain included. All observed weekly weights are divided by current max. Histogram resolution is 0.005; contiguous above-max bins with >=5 control Fish and >=3 Bases form supported regimes. Outside them, data-driven windows of width 0.01 need >=2 different Fish on >=2 Bases, each repeated in >=2 weeks. These unanchored bands are possible mutant regimes, not confirmed multipliers. Full histogram and every weekly ratio are in JSON.',
    '',
    'A normal cluster at 98–100% of current max takes precedence over higher mutant candidates. Any sustained above-max cluster creates a provisional increase. Matching a control-supported regime in even one week explains an isolated over-max value; matching an unanchored band in >=2 weeks vetoes a repeated increase. Such rows become POSSIBLE_MUTANT_CAP / REVIEW, with no normal-max proposal; their observed boundary remains separate. Unanchored bands require another Fish, so a pair cannot confirm itself. Remaining increases need a unique catalog-supported grid boundary and become NORMAL_CAP_MISMATCH. Shifts >25% stay MEDIUM. Three-week lower clusters with their entire inferred range <95% suggest MAX_TOO_HIGH at MEDIUM only; low effort cannot be excluded. Exact proposals require HIGH confidence and a unique 11-based grid point with >=75% catalog support in that magnitude. Grid rounding remains a hypothesis.',
    '',
    'Only global official record holders are visible. Missing weeks, sparse Base participation, unequal snapshot coverage and persistent mutants limit inference. OK means compatible with a normal cluster, not independently proven correct. The snapshot source resolves waterbody directly to Base; it has no Location foreign key, so no per-Location evidence is invented.',
    '',
    '| Fish | Base | Current max g | Weekly RR3 weights g (UTC week start) | Exact proposal g | Normal candidate range g | Observed boundary range g | Confidence | Classification | Increase assessment | Ratio bands | Reason |',
    '|---|---|---:|---|---:|---|---|---|---|---|---|---|',
  ];
  /** Экранирует только Markdown, не меняя принятые имена в JSON. */
  const cell = (value: string) => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  for (const row of report.candidates) {
    lines.push(
      `| ${cell(row.fishName)} | ${cell(row.baseName)} | ${row.currentMaxGrams ?? 'unknown'} | ${row.weekly.map((w) => `${w.weekStartsAt}: ${w.weightsGrams.join(', ')}`).join('<br>')} | ${row.proposedExactMaxGrams ?? ''} | ${row.candidateRangeGrams?.join('–') ?? ''} | ${row.observedBoundaryRangeGrams?.join('–') ?? ''} | ${row.confidence} | ${row.classification} | ${row.increaseAssessment ?? ''} | ${row.matchedRatioBands.join(', ')} | ${row.reason} |`,
    );
  }
  return lines.join('\n') + '\n';
}

/** CLI имеет только output-параметр и не содержит режима применения кандидатов. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || args[1].startsWith('--')) {
    throw new Error('Usage: analyze-official-max.ts --output <report prefix>');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  let input: OfficialMaxInput;
  try {
    input = await loadOfficialMaxInput(prisma);
  } finally {
    await prisma.$disconnect();
  }
  const sourceHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const analysis = analyzeOfficialMax(input);
  const report = { sourceHash, ...analysis };
  const output = resolve(args[1]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
  await writeFile(`${output}.md`, markdown(analysis, sourceHash));
  console.log(
    JSON.stringify(
      {
        sourceHash,
        counts: analysis.counts,
        history: analysis.history,
        calibration: analysis.calibration,
        ratioAnalysis: {
          counts: analysis.ratioAnalysis.counts,
          bands: analysis.ratioAnalysis.bands,
        },
        topCorrections: analysis.candidates
          .filter((c) => c.classification.startsWith('MAX_TOO_'))
          .slice(0, 20),
        outputs: [`${output}.json`, `${output}.md`],
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Official max analysis failed');
    process.exitCode = 1;
  });
}
