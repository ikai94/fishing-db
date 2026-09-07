import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type { CatalogBaitType } from '../catalog/catalog.constants.js';
import {
  buildCatalogLookupIndex,
  normalizeCatalogLookupText,
  resolveCatalogLookup,
} from '../catalog/catalog-lookup.js';

export const KLEVALKA_GENERATOR_VERSION = 'klevalka-txt-v1';
export const KLEVALKA_SOURCE_POLICY_VERSION = 'all-mode-v1';
export const KLEVALKA_WEIGHT_DISTRIBUTION_VERSION = 'deterministic-buckets-source-aware-cap-v3';
export const KLEVALKA_MAX_LINES_PER_FILE = 5_000;
export const KLEVALKA_MAX_FILE_CODE_UNITS = 1_000_000;

const UINT64_SPACE = 1n << 64n;
const UINT64_MAX = UINT64_SPACE - 1n;
const DEFAULT_WEIGHT_BUCKETS = [
  { selectionUpperExclusive: 8, rangeStartPercent: 10, rangeEndPercent: 35 },
  { selectionUpperExclusive: 43, rangeStartPercent: 35, rangeEndPercent: 60 },
  { selectionUpperExclusive: 83, rangeStartPercent: 60, rangeEndPercent: 82 },
  { selectionUpperExclusive: 97, rangeStartPercent: 82, rangeEndPercent: 95 },
  { selectionUpperExclusive: 100, rangeStartPercent: 95, rangeEndPercent: 100 },
] as const;

const CONSERVATIVE_WEIGHT_BUCKETS = [
  { selectionUpperExclusive: 10, rangeStartPercent: 10, rangeEndPercent: 35 },
  { selectionUpperExclusive: 50, rangeStartPercent: 35, rangeEndPercent: 60 },
  { selectionUpperExclusive: 88, rangeStartPercent: 60, rangeEndPercent: 82 },
  { selectionUpperExclusive: 98, rangeStartPercent: 82, rangeEndPercent: 94 },
  { selectionUpperExclusive: 100, rangeStartPercent: 94, rangeEndPercent: 100 },
] as const;

export const KLEVALKA_CONSERVATIVE_WEIGHT_BASE_NAMES = [
  'Амазония',
  'Антарктика',
  'Большой Барьерный Риф',
  'Борнео',
  'Восточный Крит',
  'Гавайские острова',
  'Гренландия',
  'Залив Александры',
  'Кроноцкий залив',
  'Лофотенские острова',
  'Миссисипи',
  'Нил',
  'Озера Танзании',
  'Патагонское озеро',
  'Побережье Камчатки',
  'Побережье Танзании',
  'Побережье Чили',
  'Полинезия',
  'Саргассово море',
  'Сейшельские острова',
  'ЮАР',
  'Юго-восточное побережье',
  'Янцзы',
] as const;

const CONSERVATIVE_WEIGHT_BASES = new Set<string>(KLEVALKA_CONSERVATIVE_WEIGHT_BASE_NAMES);

const SOURCE_CAP_EXEMPT_EMPIRICAL_BOUNDS = new Set([
  'Кроноцкий залив\0Кит синий северный',
  'Саргассово море\0Кит синий северный',
  'ЮАР\0Кит синий северный',
]);

export type KlevalkaWeightProfile = 'DEFAULT' | 'CONSERVATIVE';

export interface KlevalkaSourceRow {
  sourceFile: string;
  sourceRow: number;
  sourceId: string;
  fishNameRaw: string;
  fishingBaseNameRaw: string;
  locationNameRaw: string;
  baitNameRaw: string;
  sourceWeightGramsRaw: string;
  sourceWeightGrams: number | null;
  intRaw: string;
  int: number | null;
}

export interface KlevalkaHtmlPage {
  sourceFile: string;
  sourceMode: 'ALL' | 'GOOD' | 'BEST' | 'UNKNOWN';
  fishNameRaw: string | null;
  fishingBaseNameRaw: string | null;
  locationNameRaw: string | null;
  rows: KlevalkaSourceRow[];
  issues: ReviewIssue[];
}

export interface CatalogNamedItem {
  id: string;
  name: string;
}

export interface CatalogLocation extends CatalogNamedItem {
  number: number;
}

export interface CatalogFishingBase extends CatalogNamedItem {
  locations: CatalogLocation[];
}

export interface CatalogBait extends CatalogNamedItem {
  type: CatalogBaitType;
}

export interface CatalogMembership {
  fishingBaseId: string;
  fishId: string;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

export interface KlevalkaCatalogSnapshot {
  schemaVersion: 1;
  fishingBases: CatalogFishingBase[];
  fish: CatalogNamedItem[];
  baits: CatalogBait[];
  memberships: CatalogMembership[];
}

export type ReviewField =
  | 'source'
  | 'sourceWeight'
  | 'int'
  | 'fish'
  | 'fishingBase'
  | 'location'
  | 'bait'
  | 'membership'
  | 'weightBounds';

export interface ReviewIssue {
  code: string;
  field: ReviewField;
  message: string;
  rawValue?: string;
  candidateIds?: string[];
}

export type MappingDecision =
  | { sourceId: string; action: 'EXCLUDE'; reason: string }
  | {
      sourceId: string;
      action: 'MAP';
      reason: string;
      fishId?: string;
      fishingBaseId?: string;
      locationId?: string;
      baitId?: string;
    };

export interface ResolvedKlevalkaRow extends KlevalkaSourceRow {
  fish: CatalogNamedItem;
  fishingBase: CatalogNamedItem;
  location: CatalogLocation;
  bait: CatalogBait;
  minWeightGrams: number;
  maxWeightGrams: number;
}

export interface ReviewRow {
  sourceFile: string;
  sourceRow: number;
  sourceId: string;
  raw: {
    fish: string;
    fishingBase: string;
    location: string;
    bait: string;
    sourceWeightGrams: string;
    int: string;
  };
  status: 'RESOLVED' | 'BLOCKED' | 'EXCLUDED' | 'IGNORED_DUPLICATE';
  issues: ReviewIssue[];
  resolution: {
    fishId: string | null;
    fishingBaseId: string | null;
    locationId: string | null;
    baitId: string | null;
  };
  decision?: MappingDecision;
  retainedSourceId?: string;
}

export interface GeneratedCatchRow {
  sourceId: string;
  tupleKey: string;
  ordinal: number;
  int: number;
  weightGrams: number;
  fishId: string;
  fishingBaseId: string;
  locationId: string;
  baitId: string;
  line: string;
}

export interface GeneratedCatchFile {
  relativePath: string;
  fishingBase: CatalogNamedItem;
  rows: GeneratedCatchRow[];
  content: string;
}

export interface KlevalkaGenerationResult {
  reviewRows: ReviewRow[];
  reviewIssues: ReviewIssue[];
  retainedRows: ResolvedKlevalkaRow[];
  eligibleTupleCount: number;
  ignoredDuplicateCount: number;
  generatedFiles: GeneratedCatchFile[];
  generatedCount: number;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stableSourceId(row: Omit<KlevalkaSourceRow, 'sourceId' | 'int'>): string {
  return sha256(
    JSON.stringify([
      KLEVALKA_GENERATOR_VERSION,
      normalizeText(row.fishingBaseNameRaw),
      normalizeText(row.locationNameRaw),
      normalizeText(row.fishNameRaw),
      normalizeText(row.baitNameRaw),
      normalizeText(row.intRaw),
    ]),
  );
}

function parsePositiveInt(rawValue: string): number | null {
  const normalized = rawValue.replace(/[\s\u00a0]/gu, '');
  if (!/^[1-9]\d*$/u.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

function parseSourceWeightGrams(rawValue: string): number | null {
  const normalized = normalizeText(rawValue);
  if (!/^\d{1,3}(?:\.\d{3})*$|^\d+$/u.test(normalized)) return null;
  const value = Number(normalized.replaceAll('.', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function bodyTextWithLineBreaks(html: string): string {
  const document = load(html);
  const body = document('body').clone();
  body.find('br').replaceWith('\n');
  return body.text().replace(/\r/gu, '');
}

function pageLabel(pageText: string, label: string): string | null {
  const match = new RegExp(`${label}:\\s*([^\\n]+)`, 'iu').exec(pageText);
  return match === null ? null : normalizeText(match[1] ?? '') || null;
}

function pageFishName(html: string): string | null {
  const document = load(html);
  for (const heading of document('.header h2').toArray()) {
    const match = /^рыба:\s*(.+)$/iu.exec(normalizeText(document(heading).text()));
    if (match !== null) return normalizeText(match[1] ?? '') || null;
  }
  return null;
}

function pageSourceMode(html: string): KlevalkaHtmlPage['sourceMode'] {
  const document = load(html);
  const selectedModes = document('input[type="radio"][name="count_show"][checked]')
    .toArray()
    .map((input) => normalizeText(document(input).attr('value') ?? '').toLocaleUpperCase('en-US'));
  if (selectedModes.length !== 1) return 'UNKNOWN';
  const selectedMode = selectedModes[0];
  return selectedMode === 'ALL' || selectedMode === 'GOOD' || selectedMode === 'BEST'
    ? selectedMode
    : 'UNKNOWN';
}

function headerIndex(headers: readonly string[], predicate: (value: string) => boolean): number {
  return headers.findIndex(predicate);
}

export function parseKlevalkaHtml(html: string, sourceFile: string): KlevalkaHtmlPage {
  const document = load(html);
  const pageText = bodyTextWithLineBreaks(html);
  const fishingBaseNameRaw = pageLabel(pageText, 'База');
  const locationNameRaw = pageLabel(pageText, 'Локация');
  const fishNameFromPage = pageFishName(html);
  const sourceMode = pageSourceMode(html);
  const issues: ReviewIssue[] = [];
  const rows: KlevalkaSourceRow[] = [];

  if (sourceMode !== 'ALL') {
    issues.push({
      code: sourceMode === 'UNKNOWN' ? 'SOURCE_MODE_UNKNOWN' : 'SOURCE_MODE_FILTERED',
      field: 'source',
      rawValue: sourceMode,
      message:
        sourceMode === 'UNKNOWN'
          ? 'Klevalka Fish page must prove that the all source mode is selected'
          : `Klevalka Fish page uses filtered ${sourceMode.toLowerCase()} mode; full generation requires all mode`,
    });
  }

  const tables = document('table#founds_items');
  if (tables.length === 0) {
    issues.push({
      code: 'SOURCE_TABLE_MISSING',
      field: 'source',
      message: 'Klevalka page has no table#founds_items',
    });
    return {
      sourceFile,
      sourceMode,
      fishNameRaw: fishNameFromPage,
      fishingBaseNameRaw,
      locationNameRaw,
      rows,
      issues,
    };
  }

  tables.each((_tableIndex, table) => {
    const tableRows = document(table).find('tr');
    const headerCells = tableRows.first().find('th,td');
    const headers = headerCells
      .toArray()
      .map((cell) => normalizeText(document(cell).text()).toLocaleLowerCase('ru-RU'));
    const fishIndex = headerIndex(headers, (value) => value === 'рыба');
    const baseLocationIndex = headerIndex(
      headers,
      (value) => value.includes('база') && value.includes('локация'),
    );
    const baitIndex = headerIndex(headers, (value) => value.includes('наживка'));
    const weightIndex = headerIndex(headers, (value) => value.startsWith('вес'));
    const intIndex = headerIndex(headers, (value) => value === 'инт');

    if (
      (fishIndex < 0 && fishNameFromPage === null) ||
      (baseLocationIndex < 0 && (fishingBaseNameRaw === null || locationNameRaw === null)) ||
      baitIndex < 0 ||
      weightIndex < 0 ||
      intIndex < 0
    ) {
      issues.push({
        code: 'SOURCE_COLUMNS_MISSING',
        field: 'source',
        message: `Klevalka page must provide Fish, Base, Location, Bait/Lure and INT; found table columns: ${headers.join(', ')}`,
      });
      return;
    }

    tableRows.slice(1).each((rowIndex, row) => {
      const cells = document(row).find('td');
      if (cells.length <= Math.max(baitIndex, weightIndex, intIndex, baseLocationIndex)) return;
      const fishCell = fishIndex < 0 ? null : document(cells.get(fishIndex));
      const baitCell = document(cells.get(baitIndex));
      const baseLocationCell =
        baseLocationIndex < 0 ? null : document(cells.get(baseLocationIndex));
      const fishNameRaw =
        fishNameFromPage ??
        normalizeText(
          fishCell?.find('a[href*="/fish/detail/"]').first().text() || fishCell?.text() || '',
        );
      const rowFishingBaseNameRaw =
        baseLocationCell === null
          ? (fishingBaseNameRaw ?? '')
          : normalizeText(baseLocationCell.find('a[href*="/location/baza/"]').first().text());
      const rowLocationNameRaw =
        baseLocationCell === null
          ? (locationNameRaw ?? '')
          : normalizeText(baseLocationCell.find('a[href*="/location/detail/"]').first().text());
      const baitNameRaw = normalizeText(
        baitCell.find('a[href*="/nazhivka/detail/"], a[href*="/bait/detail/"]').first().text() ||
          baitCell.text(),
      );
      const sourceWeightGramsRaw = normalizeText(document(cells.get(weightIndex)).text());
      const sourceWeightGrams = parseSourceWeightGrams(sourceWeightGramsRaw);
      const intRaw = normalizeText(document(cells.get(intIndex)).text());
      if (
        fishNameRaw.length === 0 &&
        rowFishingBaseNameRaw.length === 0 &&
        rowLocationNameRaw.length === 0 &&
        baitNameRaw.length === 0 &&
        sourceWeightGramsRaw.length === 0 &&
        intRaw.length === 0
      )
        return;

      const partial = {
        sourceFile,
        sourceRow: rowIndex + 1,
        fishNameRaw,
        fishingBaseNameRaw: rowFishingBaseNameRaw,
        locationNameRaw: rowLocationNameRaw,
        baitNameRaw,
        sourceWeightGramsRaw,
        sourceWeightGrams,
        intRaw,
      };
      rows.push({ ...partial, sourceId: stableSourceId(partial), int: parsePositiveInt(intRaw) });
      if (sourceWeightGrams === null) {
        issues.push({
          code: 'INVALID_SOURCE_WEIGHT',
          field: 'sourceWeight',
          rawValue: sourceWeightGramsRaw,
          message: 'Klevalka source weight must be a non-negative integer number of grams',
        });
      }
    });
  });

  if (rows.length === 0) {
    issues.push({
      code: 'SOURCE_ROWS_MISSING',
      field: 'source',
      message: 'Klevalka table contains no data rows; anonymous pages may hide the dataset',
    });
  }

  return {
    sourceFile,
    sourceMode,
    fishNameRaw: fishNameFromPage,
    fishingBaseNameRaw,
    locationNameRaw,
    rows,
    issues,
  };
}

export function absoluteCatchCount(int: number): number {
  if (!Number.isSafeInteger(int) || int < 1)
    throw new TypeError('INT must be a positive safe integer');
  if (int <= 10) return int;
  if (int >= 55_000) return 100;
  return Math.floor(10 + (90 * Math.log(int / 10)) / Math.log(5_500) + 0.5);
}

function deterministicDigest(
  datasetId: string,
  sourceId: string,
  purpose: string,
  ordinal?: number,
): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify([
        KLEVALKA_GENERATOR_VERSION,
        datasetId,
        sourceId,
        purpose,
        ...(ordinal === undefined ? [] : [ordinal]),
      ]),
    )
    .digest();
}

export function deterministicCatchCount(int: number, datasetId: string, sourceId: string): number {
  const baseCount = absoluteCatchCount(int);
  if (int <= 10) return baseCount;
  const offsets = [-1, 0, 0, 1] as const;
  const firstByte = deterministicDigest(datasetId, sourceId, 'count')[0] ?? 0;
  return Math.max(10, Math.min(100, baseCount + offsets[firstByte % offsets.length]));
}

export function deterministicWeight(
  minWeightGrams: number,
  maxWeightGrams: number,
  datasetId: string,
  sourceId: string,
  ordinal: number,
  profile: KlevalkaWeightProfile = 'DEFAULT',
): number {
  if (
    !Number.isSafeInteger(minWeightGrams) ||
    !Number.isSafeInteger(maxWeightGrams) ||
    minWeightGrams < 1 ||
    minWeightGrams > maxWeightGrams ||
    !Number.isSafeInteger(ordinal) ||
    ordinal < 1
  ) {
    throw new TypeError('Weight bounds and ordinal must be valid positive integers');
  }
  const digest = deterministicDigest(datasetId, sourceId, 'weight', ordinal);
  return weightFromDeterministicDraws(
    minWeightGrams,
    maxWeightGrams,
    digest.readBigUInt64BE(0),
    digest.readBigUInt64BE(8),
    profile,
  );
}

export function klevalkaWeightProfileForBase(fishingBaseName: string): KlevalkaWeightProfile {
  return CONSERVATIVE_WEIGHT_BASES.has(fishingBaseName) ? 'CONSERVATIVE' : 'DEFAULT';
}

export function klevalkaSourceAwareGeneratorMax(input: {
  fishingBaseName: string;
  fishName: string;
  effectiveMaxWeightGrams: number;
  sourceMaxWeightGrams: number;
  sourceRowCount: number;
  usesReviewedWeightOverride?: boolean;
}): number {
  const { effectiveMaxWeightGrams, sourceMaxWeightGrams, sourceRowCount } = input;
  if (
    !Number.isSafeInteger(effectiveMaxWeightGrams) ||
    !Number.isSafeInteger(sourceMaxWeightGrams) ||
    !Number.isSafeInteger(sourceRowCount) ||
    effectiveMaxWeightGrams < 1 ||
    sourceMaxWeightGrams < 0 ||
    sourceRowCount < 1
  ) {
    throw new TypeError('Source-aware weight cap inputs must be valid safe integers');
  }
  if (klevalkaWeightProfileForBase(input.fishingBaseName) !== 'CONSERVATIVE') {
    return effectiveMaxWeightGrams;
  }
  if (
    input.usesReviewedWeightOverride === true &&
    SOURCE_CAP_EXEMPT_EMPIRICAL_BOUNDS.has(`${input.fishingBaseName}\0${input.fishName}`)
  ) {
    return effectiveMaxWeightGrams;
  }
  if (sourceMaxWeightGrams < 1) {
    throw new TypeError('Conservative source-aware weight cap needs a positive source maximum');
  }
  if (BigInt(effectiveMaxWeightGrams) * 2n <= BigInt(sourceMaxWeightGrams) * 3n) {
    return effectiveMaxWeightGrams;
  }

  const [multiplierNumerator, multiplierDenominator] =
    sourceRowCount <= 2
      ? ([200n, 100n] as const)
      : sourceRowCount <= 5
        ? ([175n, 100n] as const)
        : sourceRowCount <= 20
          ? ([150n, 100n] as const)
          : sourceRowCount <= 100
            ? ([135n, 100n] as const)
            : ([125n, 100n] as const);
  const sourceDerivedCap =
    (BigInt(sourceMaxWeightGrams) * multiplierNumerator) / multiplierDenominator;
  const effectiveMax = BigInt(effectiveMaxWeightGrams);
  return Number(sourceDerivedCap < effectiveMax ? sourceDerivedCap : effectiveMax);
}

export function weightFromDeterministicDraws(
  minWeightGrams: number,
  maxWeightGrams: number,
  bucketDraw: bigint,
  positionDraw: bigint,
  profile: KlevalkaWeightProfile = 'DEFAULT',
): number {
  if (
    !Number.isSafeInteger(minWeightGrams) ||
    !Number.isSafeInteger(maxWeightGrams) ||
    minWeightGrams < 1 ||
    minWeightGrams > maxWeightGrams
  ) {
    throw new TypeError('Weight bounds must be valid positive integers');
  }
  if (
    bucketDraw < 0n ||
    bucketDraw > UINT64_MAX ||
    positionDraw < 0n ||
    positionDraw > UINT64_MAX
  ) {
    throw new TypeError('Weight draws must be unsigned 64-bit integers');
  }
  if (minWeightGrams === maxWeightGrams) return minWeightGrams;

  const bucketSlot = Number((bucketDraw * 100n) / UINT64_SPACE);
  const buckets = profile === 'CONSERVATIVE' ? CONSERVATIVE_WEIGHT_BUCKETS : DEFAULT_WEIGHT_BUCKETS;
  const bucket = buckets.find((candidate) => bucketSlot < candidate.selectionUpperExclusive);
  if (bucket === undefined) throw new RangeError('Weight bucket selection is out of range');

  const percentageNumerator =
    BigInt(bucket.rangeStartPercent) * UINT64_MAX +
    BigInt(bucket.rangeEndPercent - bucket.rangeStartPercent) * positionDraw;
  const range = BigInt(maxWeightGrams - minWeightGrams);
  const offset = (range * percentageNumerator) / (100n * UINT64_MAX);
  return minWeightGrams + Number(offset);
}

function decisionTarget<T extends CatalogNamedItem>(
  items: readonly T[],
  id: string | undefined,
): T | null {
  return id === undefined ? null : (items.find((item) => item.id === id) ?? null);
}

function resolveNamed<T extends CatalogNamedItem>(
  rawValue: string,
  items: readonly T[],
  decisionId: string | undefined,
  field: ReviewField,
): { item: T | null; issue: ReviewIssue | null } {
  if (decisionId !== undefined) {
    const item = decisionTarget(items, decisionId);
    return item === null
      ? {
          item: null,
          issue: {
            code: 'REVIEW_TARGET_MISSING',
            field,
            rawValue,
            message: `Reviewed ${field} target ${decisionId} is absent from the active catalog`,
          },
        }
      : { item, issue: null };
  }
  const resolution = resolveCatalogLookup(buildCatalogLookupIndex(items), rawValue);
  if (resolution.status === 'UNIQUE') return { item: resolution.item, issue: null };
  return {
    item: null,
    issue: {
      code: resolution.status === 'AMBIGUOUS' ? 'CATALOG_MATCH_AMBIGUOUS' : 'CATALOG_MATCH_UNKNOWN',
      field,
      rawValue,
      candidateIds:
        resolution.status === 'AMBIGUOUS'
          ? resolution.items.map((item) => item.id).sort()
          : undefined,
      message:
        resolution.status === 'AMBIGUOUS'
          ? `${field} matches multiple active catalog items`
          : `${field} does not match an active catalog item`,
    },
  };
}

function tupleKey(row: ResolvedKlevalkaRow): string {
  return [row.fish.id, row.fishingBase.id, row.location.id, row.bait.id].join('\0');
}

interface SourceWeightStats {
  rowCount: number;
  maximumGrams: number;
}

function baseFishKey(fishingBaseId: string, fishId: string): string {
  return `${fishingBaseId}\0${fishId}`;
}

function addSourceWeight(
  stats: Map<string, SourceWeightStats>,
  key: string,
  sourceWeightGrams: number,
): void {
  const current = stats.get(key) ?? { rowCount: 0, maximumGrams: 0 };
  current.rowCount += 1;
  current.maximumGrams = Math.max(current.maximumGrams, sourceWeightGrams);
  stats.set(key, current);
}

function generatorMaxForResolvedRow(
  row: ResolvedKlevalkaRow,
  stats: SourceWeightStats,
  usesReviewedWeightOverride = false,
): number {
  const generatorMax = klevalkaSourceAwareGeneratorMax({
    fishingBaseName: row.fishingBase.name,
    fishName: row.fish.name,
    effectiveMaxWeightGrams: row.maxWeightGrams,
    sourceMaxWeightGrams: stats.maximumGrams,
    sourceRowCount: stats.rowCount,
    usesReviewedWeightOverride,
  });
  if (generatorMax < row.minWeightGrams) {
    throw new Error(
      `Klevalka source-aware maximum is below minimum weight for ${row.fishingBase.name}/${row.fish.name}`,
    );
  }
  return generatorMax;
}

export function klevalkaBaseSlug(value: string): string {
  return (
    value
      .normalize('NFKC')
      .toLocaleLowerCase('ru-RU')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'base'
  );
}

export function formatKlevalkaCatchLine(row: ResolvedKlevalkaRow, weightGrams: number): string {
  return `${row.fish.name} ${formatKlevalkaWeight(weightGrams)}. Поймана на ${row.fishingBase.name}: ${row.location.name}, ${row.bait.name}.`;
}

export function formatKlevalkaWeight(weightGrams: number): string {
  if (!Number.isSafeInteger(weightGrams) || weightGrams < 1) {
    throw new TypeError('Weight must be a positive integer number of grams');
  }
  if (weightGrams < 1_000) return `${weightGrams} грамм`;
  const kilograms = Math.floor(weightGrams / 1_000);
  const remainder = String(weightGrams % 1_000).padStart(3, '0');
  return `${kilograms},${remainder} кг`;
}

function chunkRows(rows: GeneratedCatchRow[]): GeneratedCatchRow[][] {
  const chunks: GeneratedCatchRow[][] = [];
  let current: GeneratedCatchRow[] = [];
  let codeUnits = 0;
  for (const row of rows) {
    const rowUnits = row.line.length + 1;
    if (
      current.length > 0 &&
      (current.length >= KLEVALKA_MAX_LINES_PER_FILE ||
        codeUnits + rowUnits > KLEVALKA_MAX_FILE_CODE_UNITS)
    ) {
      chunks.push(current);
      current = [];
      codeUnits = 0;
    }
    current.push(row);
    codeUnits += rowUnits;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export function generateKlevalkaCatches(input: {
  pages: readonly KlevalkaHtmlPage[];
  catalog: KlevalkaCatalogSnapshot;
  datasetId: string;
  decisions?: readonly MappingDecision[];
  maxTuples?: number;
}): KlevalkaGenerationResult {
  if (input.datasetId.trim().length === 0) throw new TypeError('datasetId must not be empty');
  if (
    input.maxTuples !== undefined &&
    (!Number.isSafeInteger(input.maxTuples) || input.maxTuples < 1)
  ) {
    throw new TypeError('maxTuples must be a positive safe integer');
  }
  const reviewIssues = input.pages.flatMap((page) => page.issues);
  const sourceRows = input.pages.flatMap((page) => page.rows);
  const decisionMap = new Map(
    (input.decisions ?? []).map((decision) => [decision.sourceId, decision]),
  );
  const observedSourceIds = new Set(sourceRows.map((row) => row.sourceId));
  for (const decision of input.decisions ?? []) {
    if (!observedSourceIds.has(decision.sourceId)) {
      reviewIssues.push({
        code: 'REVIEW_DECISION_UNUSED',
        field: 'source',
        rawValue: decision.sourceId,
        message: 'Review decision does not match any current source row',
      });
    }
  }

  const memberships = new Map(
    input.catalog.memberships.map(
      (item) => [`${item.fishingBaseId}\0${item.fishId}`, item] as const,
    ),
  );
  const reviewRows: ReviewRow[] = [];
  const resolvedRows: ResolvedKlevalkaRow[] = [];
  const sourceWeightsByBaseFish = new Map<string, SourceWeightStats>();

  for (const row of sourceRows) {
    const decision = decisionMap.get(row.sourceId);
    const review: ReviewRow = {
      sourceFile: row.sourceFile,
      sourceRow: row.sourceRow,
      sourceId: row.sourceId,
      raw: {
        fish: row.fishNameRaw,
        fishingBase: row.fishingBaseNameRaw,
        location: row.locationNameRaw,
        bait: row.baitNameRaw,
        sourceWeightGrams: row.sourceWeightGramsRaw,
        int: row.intRaw,
      },
      status: 'BLOCKED',
      issues: [],
      resolution: { fishId: null, fishingBaseId: null, locationId: null, baitId: null },
      ...(decision === undefined ? {} : { decision }),
    };
    reviewRows.push(review);

    if (decision?.action === 'EXCLUDE') {
      review.status = 'EXCLUDED';
      review.issues.push({ code: 'REVIEWED_EXCLUSION', field: 'source', message: decision.reason });
      continue;
    }
    if (row.int === null) {
      review.issues.push({
        code: 'INVALID_INT',
        field: 'int',
        rawValue: row.intRaw,
        message: 'INT must be a positive integer',
      });
    }
    if (row.sourceWeightGrams === null) {
      review.issues.push({
        code: 'INVALID_SOURCE_WEIGHT',
        field: 'sourceWeight',
        rawValue: row.sourceWeightGramsRaw,
        message: 'Klevalka source weight must be a non-negative integer number of grams',
      });
    }

    const mapping = decision?.action === 'MAP' ? decision : undefined;
    const fishingBaseResult = resolveNamed(
      row.fishingBaseNameRaw,
      input.catalog.fishingBases,
      mapping?.fishingBaseId,
      'fishingBase',
    );
    if (fishingBaseResult.issue !== null) review.issues.push(fishingBaseResult.issue);
    const fishResult = resolveNamed(row.fishNameRaw, input.catalog.fish, mapping?.fishId, 'fish');
    if (fishResult.issue !== null) review.issues.push(fishResult.issue);
    const baitResult = resolveNamed(row.baitNameRaw, input.catalog.baits, mapping?.baitId, 'bait');
    if (baitResult.issue !== null) review.issues.push(baitResult.issue);
    const locationResult = resolveNamed(
      row.locationNameRaw,
      fishingBaseResult.item?.locations ?? [],
      mapping?.locationId,
      'location',
    );
    if (locationResult.issue !== null) review.issues.push(locationResult.issue);

    review.resolution = {
      fishId: fishResult.item?.id ?? null,
      fishingBaseId: fishingBaseResult.item?.id ?? null,
      locationId: locationResult.item?.id ?? null,
      baitId: baitResult.item?.id ?? null,
    };
    if (
      fishingBaseResult.item !== null &&
      fishResult.item !== null &&
      row.sourceWeightGrams !== null
    ) {
      addSourceWeight(
        sourceWeightsByBaseFish,
        baseFishKey(fishingBaseResult.item.id, fishResult.item.id),
        row.sourceWeightGrams,
      );
    }
    if (
      row.int === null ||
      row.sourceWeightGrams === null ||
      fishingBaseResult.item === null ||
      fishResult.item === null ||
      locationResult.item === null ||
      baitResult.item === null
    ) {
      continue;
    }
    const membership = memberships.get(`${fishingBaseResult.item.id}\0${fishResult.item.id}`);
    if (membership === undefined) {
      review.issues.push({
        code: 'FISH_NOT_IN_BASE',
        field: 'membership',
        message: 'Resolved Fish is not linked to the resolved Base',
      });
      continue;
    }
    if (
      membership.minWeightGrams === null ||
      membership.maxWeightGrams === null ||
      membership.minWeightGrams < 1 ||
      membership.minWeightGrams > membership.maxWeightGrams
    ) {
      review.issues.push({
        code: 'WEIGHT_BOUNDS_MISSING',
        field: 'weightBounds',
        message: 'BaseFish needs valid minimum and maximum weights',
      });
      continue;
    }

    review.status = 'RESOLVED';
    resolvedRows.push({
      ...row,
      fish: fishResult.item,
      fishingBase: fishingBaseResult.item,
      location: locationResult.item,
      bait: baitResult.item,
      minWeightGrams: membership.minWeightGrams,
      maxWeightGrams: membership.maxWeightGrams,
    });
  }

  const cappedResolvedRows = resolvedRows.map((row) => {
    const stats = sourceWeightsByBaseFish.get(baseFishKey(row.fishingBase.id, row.fish.id));
    if (stats === undefined)
      throw new Error('Resolved Klevalka row has no source weight statistics');
    const maxWeightGrams = generatorMaxForResolvedRow(row, stats);
    return maxWeightGrams === row.maxWeightGrams ? row : { ...row, maxWeightGrams };
  });

  const retainedByTuple = new Map<string, ResolvedKlevalkaRow>();
  for (const row of cappedResolvedRows) {
    const key = tupleKey(row);
    const retained = retainedByTuple.get(key);
    const rowTieKey = `${row.sourceId}\0${row.sourceFile}\0${row.sourceRow.toString().padStart(10, '0')}`;
    const retainedTieKey =
      retained === undefined
        ? ''
        : `${retained.sourceId}\0${retained.sourceFile}\0${retained.sourceRow.toString().padStart(10, '0')}`;
    if (
      retained === undefined ||
      (row.int ?? 0) > (retained.int ?? 0) ||
      ((row.int ?? 0) === (retained.int ?? 0) && rowTieKey < retainedTieKey)
    ) {
      retainedByTuple.set(key, row);
    }
  }

  for (const row of cappedResolvedRows) {
    const retained = retainedByTuple.get(tupleKey(row));
    if (retained !== row) {
      const review = reviewRows.find(
        (item) =>
          item.sourceFile === row.sourceFile &&
          item.sourceRow === row.sourceRow &&
          item.sourceId === row.sourceId,
      );
      if (review !== undefined) {
        review.status = 'IGNORED_DUPLICATE';
        review.retainedSourceId = retained?.sourceId;
        review.issues.push({
          code: 'LOWER_OR_TIED_INT_DUPLICATE',
          field: 'int',
          message: `Tuple retained from source ${retained?.sourceId ?? 'unknown'} with INT ${retained?.int ?? 'unknown'}`,
        });
      }
    }
  }

  const eligibleRows = [...retainedByTuple.values()].sort(
    (left, right) =>
      tupleKey(left).localeCompare(tupleKey(right)) || left.sourceId.localeCompare(right.sourceId),
  );
  const retainedRows = eligibleRows.slice(0, input.maxTuples);
  const generatedByBase = new Map<string, { base: CatalogNamedItem; rows: GeneratedCatchRow[] }>();
  for (const row of retainedRows) {
    const int = row.int;
    if (int === null) throw new Error('Retained row has invalid INT');
    const count = deterministicCatchCount(int, input.datasetId, row.sourceId);
    const group = generatedByBase.get(row.fishingBase.id) ?? { base: row.fishingBase, rows: [] };
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      const weightGrams = deterministicWeight(
        row.minWeightGrams,
        row.maxWeightGrams,
        input.datasetId,
        row.sourceId,
        ordinal,
        klevalkaWeightProfileForBase(row.fishingBase.name),
      );
      group.rows.push({
        sourceId: row.sourceId,
        tupleKey: tupleKey(row),
        ordinal,
        int,
        weightGrams,
        fishId: row.fish.id,
        fishingBaseId: row.fishingBase.id,
        locationId: row.location.id,
        baitId: row.bait.id,
        line: formatKlevalkaCatchLine(row, weightGrams),
      });
    }
    generatedByBase.set(row.fishingBase.id, group);
  }

  const generatedFiles = [...generatedByBase.values()]
    .sort(
      (left, right) =>
        normalizeCatalogLookupText(left.base.name).localeCompare(
          normalizeCatalogLookupText(right.base.name),
          'ru',
        ) || left.base.id.localeCompare(right.base.id),
    )
    .flatMap(({ base, rows }) => {
      const sortedRows = rows.sort(
        (left, right) =>
          left.tupleKey.localeCompare(right.tupleKey) || left.ordinal - right.ordinal,
      );
      return chunkRows(sortedRows).map((chunk, index) => ({
        relativePath: `catches/${klevalkaBaseSlug(base.name)}--${base.id}.part-${String(index + 1).padStart(4, '0')}.txt`,
        fishingBase: base,
        rows: chunk,
        content: `${chunk.map((row) => row.line).join('\n')}\n`,
      }));
    });

  return {
    reviewRows: reviewRows.sort(
      (left, right) =>
        left.sourceId.localeCompare(right.sourceId) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.sourceRow - right.sourceRow,
    ),
    reviewIssues: reviewIssues.sort(
      (left, right) =>
        left.code.localeCompare(right.code) || left.message.localeCompare(right.message),
    ),
    retainedRows,
    eligibleTupleCount: eligibleRows.length,
    ignoredDuplicateCount: cappedResolvedRows.length - retainedByTuple.size,
    generatedFiles,
    generatedCount: generatedFiles.reduce((sum, file) => sum + file.rows.length, 0),
  };
}
