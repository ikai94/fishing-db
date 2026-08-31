import { inflateRawSync } from 'node:zlib';
import {
  stableJson,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';

const POSTGRES_INTEGER_MAX = 2_147_483_647n;

export type WeightCellStatus = 'VALID' | 'MISSING' | 'INVALID';
export type WeightRowStatus =
  | 'VALID_COMPLETE'
  | 'MISSING_MIN'
  | 'MISSING_MAX'
  | 'MISSING_BOTH'
  | 'SWAPPED'
  | 'INVALID'
  | 'NO_TARGET';
export type WeightTargetGroupStatus = 'UNIQUE' | 'DUPLICATE_IDENTICAL' | 'CONFLICT';

export interface XlsxAuditCell {
  reference: string;
  cellType: string;
  rawValue: string | null;
  formula: string | null;
}

export interface ParsedWeightCell {
  cell: string;
  cellType: string | null;
  rawValue: string | null;
  formula: string | null;
  status: WeightCellStatus;
  valueGrams: number | null;
  invalidReason: string | null;
}

export interface BaseFishWeightAuditRow {
  baseName: string;
  canonicalFish: string | null;
  forumTopicId: string | null;
  reconciliationCategory: WorkbookFishResolution['category'];
  sourceSheet: string;
  fishCell: string;
  rawFishName: string;
  min: ParsedWeightCell;
  max: ParsedWeightCell;
  status: WeightRowStatus;
  targetGroupStatus: WeightTargetGroupStatus | null;
  requiresManualReview: boolean;
  manualReviewReasons: string[];
}

export interface BaseFishWeightDuplicateGroup {
  baseName: string;
  canonicalFish: string;
  forumTopicId: string;
  status: Exclude<WeightTargetGroupStatus, 'UNIQUE'>;
  sourceRows: Array<{
    fishCell: string;
    minCell: string;
    maxCell: string;
    rawMin: string | null;
    rawMax: string | null;
    rowStatus: WeightRowStatus;
  }>;
}

export interface BaseFishWeightAudit {
  schemaVersion: 1;
  mode: 'AUDIT_ONLY';
  sources: {
    workbookFileName: string;
    workbookSha256: string;
    reconciliationSha256: string;
    forum69Sha256: string;
  };
  policy: {
    identitySource: 'accepted Excel reconciliation -> forum69 topicId';
    normalColumns: { fish: 'A'; min: 'E'; max: 'F' };
    volgaColumns: { fish: 'C'; min: 'G'; max: 'H' };
    automaticSwapsOrFixes: false;
    catchReportsRead: false;
  };
  reconciliation: {
    totalRows: number;
    mappedRows: number;
    noTargetRows: number;
    statusCounts: Record<string, number>;
    explanation: string;
  };
  uniqueTargetMemberships: number;
  weightStatusCounts: Record<WeightRowStatus, number>;
  duplicateIdenticalGroups: number;
  conflictingGroups: number;
  duplicateGroups: BaseFishWeightDuplicateGroup[];
  manualReviewRows: BaseFishWeightAuditRow[];
  blockersBeforeApplyReady: string[];
  applyReady: boolean;
  rows: BaseFishWeightAuditRow[];
}

export interface BaseFishWeightAuditInput {
  reconciliationRows: readonly WorkbookFishResolution[];
  forumFish: readonly ForumFishIdentity[];
  worksheets: ReadonlyMap<string, ReadonlyMap<string, XlsxAuditCell>>;
  sources: BaseFishWeightAudit['sources'];
  expectedCounts?: {
    totalRows: number;
    mappedRows: number;
    uniqueTargetMemberships: number;
  };
}

interface ZipEntry {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('XLSX ZIP end-of-central-directory record is missing');
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('XLSX ZIP central directory is malformed');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { compressedSize, compressionMethod, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipText(buffer: Buffer, entries: Map<string, ZipEntry>, name: string): string {
  const entry = entries.get(name);
  if (entry === undefined) throw new Error(`XLSX ZIP entry is missing: ${name}`);
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`XLSX ZIP local header is malformed: ${name}`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const bodyOffset = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(bodyOffset, bodyOffset + entry.compressedSize);
  const body =
    entry.compressionMethod === 8
      ? inflateRawSync(compressed)
      : entry.compressionMethod === 0
        ? compressed
        : undefined;
  if (body === undefined) throw new Error(`Unsupported XLSX compression method for ${name}`);
  return body.toString('utf8');
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, entity: string) =>
      String.fromCodePoint(
        entity.toLowerCase().startsWith('x')
          ? Number.parseInt(entity.slice(1), 16)
          : Number.parseInt(entity, 10),
      ),
    )
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function attribute(value: string, name: string): string | undefined {
  return value.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u'))?.[1];
}

function xmlText(value: string): string {
  return decodeXml(
    [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((match) => match[1] ?? '').join(''),
  );
}

export function readWorksheetAuditCells(
  worksheet: string,
  sharedStrings: readonly string[],
): Map<string, XlsxAuditCell> {
  const cells = new Map<string, XlsxAuditCell>();
  for (const match of worksheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
    const attributes = match[1] ?? '';
    const reference = attribute(attributes, 'r');
    if (reference === undefined) continue;
    const body = match[2];
    const cellType = attribute(attributes, 't') ?? 'n';
    const storedValue = body?.match(/<v>([\s\S]*?)<\/v>/u)?.[1];
    const formulaMatch = body?.match(/<f(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/f>)/u);
    let rawValue: string | null = null;
    if (body !== undefined && cellType === 'inlineStr') rawValue = xmlText(body);
    else if (storedValue !== undefined && cellType === 's') {
      rawValue = sharedStrings[Number(storedValue)] ?? null;
    } else if (storedValue !== undefined) rawValue = decodeXml(storedValue);

    cells.set(reference, {
      reference,
      cellType,
      rawValue,
      formula:
        formulaMatch === undefined || formulaMatch === null
          ? null
          : decodeXml(formulaMatch[1] ?? ''),
    });
  }
  return cells;
}

export function readWorkbookAuditWorksheets(
  workbook: Buffer,
  sourceSheets: readonly string[],
): Map<string, Map<string, XlsxAuditCell>> {
  const entries = readZipEntries(workbook);
  const workbookXml = readZipText(workbook, entries, 'xl/workbook.xml');
  const relationshipsXml = readZipText(workbook, entries, 'xl/_rels/workbook.xml.rels');
  const sharedStringsXml = readZipText(workbook, entries, 'xl/sharedStrings.xml');
  const relationships = new Map<string, string>();

  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]+)\/>/gu)) {
    const id = attribute(match[1] ?? '', 'Id');
    const target = attribute(match[1] ?? '', 'Target');
    if (id !== undefined && target !== undefined) relationships.set(id, target);
  }

  const sheets = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b([^>]+)\/>/gu)) {
    const name = attribute(match[1] ?? '', 'name');
    const relationshipId = attribute(match[1] ?? '', 'r:id');
    const target = relationshipId === undefined ? undefined : relationships.get(relationshipId);
    if (name !== undefined && target !== undefined) sheets.set(decodeXml(name), target);
  }

  const sharedStrings = [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)].map(
    (match) => xmlText(match[1] ?? ''),
  );
  const result = new Map<string, Map<string, XlsxAuditCell>>();

  for (const sourceSheet of [...new Set(sourceSheets)].sort(compareText)) {
    const target = sheets.get(sourceSheet);
    if (target === undefined) throw new Error(`Workbook sheet is missing: ${sourceSheet}`);
    const path = `xl/${target.replace(/^\/?xl\//u, '')}`;
    result.set(
      sourceSheet,
      readWorksheetAuditCells(readZipText(workbook, entries, path), sharedStrings),
    );
  }

  return result;
}

function exactPositiveInteger(
  rawValue: string,
): { status: 'VALID'; value: number } | { status: 'INVALID'; reason: string } {
  const value = rawValue.trim();
  const match = value.match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u);
  if (match === null) return { status: 'INVALID', reason: 'INVALID_NUMERIC_SYNTAX' };
  if (match[1] === '-') return { status: 'INVALID', reason: 'NON_POSITIVE' };

  const integerPart = match[2] ?? '';
  const fractionPart = match[3] ?? '';
  const exponentRaw = match[4] ?? '0';
  if (exponentRaw.length > 6) {
    return exponentRaw.startsWith('-')
      ? { status: 'INVALID', reason: 'NON_INTEGER' }
      : { status: 'INVALID', reason: 'OUT_OF_POSTGRES_INTEGER_RANGE' };
  }
  const exponent = Number(exponentRaw);
  if (!Number.isSafeInteger(exponent)) {
    return { status: 'INVALID', reason: 'INVALID_NUMERIC_SYNTAX' };
  }

  let digits = `${integerPart}${fractionPart}`;
  const scale = fractionPart.length - exponent;
  if (scale > 0) {
    if (scale >= digits.length) {
      if (/^0+$/u.test(digits)) return { status: 'INVALID', reason: 'NON_POSITIVE' };
      return { status: 'INVALID', reason: 'NON_INTEGER' };
    }
    const fractionalDigits = digits.slice(-scale);
    if (!/^0*$/u.test(fractionalDigits)) {
      return { status: 'INVALID', reason: 'NON_INTEGER' };
    }
    digits = digits.slice(0, -scale);
  } else if (scale < 0) {
    const trailingZeros = -scale;
    if (digits.replace(/^0+/u, '').length + trailingZeros > 10) {
      return { status: 'INVALID', reason: 'OUT_OF_POSTGRES_INTEGER_RANGE' };
    }
    digits = `${digits}${'0'.repeat(trailingZeros)}`;
  }

  digits = digits.replace(/^0+/u, '') || '0';
  const exact = BigInt(digits);
  if (exact <= 0n) return { status: 'INVALID', reason: 'NON_POSITIVE' };
  if (exact > POSTGRES_INTEGER_MAX) {
    return { status: 'INVALID', reason: 'OUT_OF_POSTGRES_INTEGER_RANGE' };
  }
  return { status: 'VALID', value: Number(exact) };
}

export function parseWeightCell(
  reference: string,
  cell: XlsxAuditCell | undefined,
): ParsedWeightCell {
  if (cell === undefined || cell.rawValue === null || cell.rawValue.trim() === '') {
    return {
      cell: reference,
      cellType: cell?.cellType ?? null,
      rawValue: cell?.rawValue ?? null,
      formula: cell?.formula ?? null,
      status: 'MISSING',
      valueGrams: null,
      invalidReason: null,
    };
  }
  if (cell.formula !== null) {
    return {
      cell: reference,
      cellType: cell.cellType,
      rawValue: cell.rawValue,
      formula: cell.formula,
      status: 'INVALID',
      valueGrams: null,
      invalidReason: 'FORMULA_NOT_ACCEPTED',
    };
  }
  if (cell.cellType !== 'n') {
    return {
      cell: reference,
      cellType: cell.cellType,
      rawValue: cell.rawValue,
      formula: null,
      status: 'INVALID',
      valueGrams: null,
      invalidReason: 'NON_NUMERIC_CELL',
    };
  }

  const parsed = exactPositiveInteger(cell.rawValue);
  return parsed.status === 'VALID'
    ? {
        cell: reference,
        cellType: cell.cellType,
        rawValue: cell.rawValue,
        formula: null,
        status: 'VALID',
        valueGrams: parsed.value,
        invalidReason: null,
      }
    : {
        cell: reference,
        cellType: cell.cellType,
        rawValue: cell.rawValue,
        formula: null,
        status: 'INVALID',
        valueGrams: null,
        invalidReason: parsed.reason,
      };
}

function weightRowStatus(
  topicId: string | null,
  min: ParsedWeightCell,
  max: ParsedWeightCell,
): WeightRowStatus {
  if (topicId === null) return 'NO_TARGET';
  if (min.status === 'INVALID' || max.status === 'INVALID') return 'INVALID';
  if (min.status === 'MISSING' && max.status === 'MISSING') return 'MISSING_BOTH';
  if (min.status === 'MISSING') return 'MISSING_MIN';
  if (max.status === 'MISSING') return 'MISSING_MAX';
  return (min.valueGrams as number) > (max.valueGrams as number) ? 'SWAPPED' : 'VALID_COMPLETE';
}

function cellSignature(cell: ParsedWeightCell): string {
  if (cell.status === 'VALID') return `VALID:${String(cell.valueGrams)}`;
  if (cell.status === 'MISSING') return 'MISSING';
  return stableJson({
    status: cell.status,
    cellType: cell.cellType,
    rawValue: cell.rawValue,
    formula: cell.formula,
    invalidReason: cell.invalidReason,
  });
}

function emptyWeightStatusCounts(): Record<WeightRowStatus, number> {
  return {
    VALID_COMPLETE: 0,
    MISSING_MIN: 0,
    MISSING_MAX: 0,
    MISSING_BOTH: 0,
    SWAPPED: 0,
    INVALID: 0,
    NO_TARGET: 0,
  };
}

function countByValue(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort(compareText)) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function buildBaseFishWeightAudit(input: BaseFishWeightAuditInput): BaseFishWeightAudit {
  const sourceBlockers: string[] = [];
  const forumByTopic = new Map<string, ForumFishIdentity>();
  for (const fish of input.forumFish) {
    if (forumByTopic.has(fish.topicId)) {
      sourceBlockers.push(`forum69 topicId is duplicated: ${fish.topicId}`);
    }
    forumByTopic.set(fish.topicId, fish);
  }

  const sortedRows = [...input.reconciliationRows].sort(
    (left, right) =>
      compareText(left.baseName, right.baseName) ||
      compareText(left.sourceSheet, right.sourceSheet) ||
      Number(left.sourceCell.match(/\d+$/u)?.[0] ?? 0) -
        Number(right.sourceCell.match(/\d+$/u)?.[0] ?? 0) ||
      compareText(left.sourceCell, right.sourceCell),
  );
  const rows: BaseFishWeightAuditRow[] = [];

  for (const reconciliation of sortedRows) {
    const sourceCell = reconciliation.sourceCell.match(/^([A-Z]+)([1-9]\d*)$/u);
    if (sourceCell === null) {
      throw new Error(`Invalid reconciliation source cell: ${reconciliation.sourceCell}`);
    }
    const expectedFishColumn = reconciliation.sourceSheet === 'Волга' ? 'C' : 'A';
    if (sourceCell[1] !== expectedFishColumn) {
      sourceBlockers.push(
        `${reconciliation.sourceSheet}!${reconciliation.sourceCell} uses Fish column ${sourceCell[1]}; expected ${expectedFishColumn}`,
      );
    }
    const rowNumber = sourceCell[2];
    const minCell = `${reconciliation.sourceSheet === 'Волга' ? 'G' : 'E'}${rowNumber}`;
    const maxCell = `${reconciliation.sourceSheet === 'Волга' ? 'H' : 'F'}${rowNumber}`;
    const worksheet = input.worksheets.get(reconciliation.sourceSheet);
    if (worksheet === undefined) {
      throw new Error(`Workbook sheet was not loaded: ${reconciliation.sourceSheet}`);
    }
    const min = parseWeightCell(minCell, worksheet.get(minCell));
    const max = parseWeightCell(maxCell, worksheet.get(maxCell));
    const forumFish =
      reconciliation.topicId === null ? undefined : forumByTopic.get(reconciliation.topicId);
    if (reconciliation.topicId !== null && forumFish === undefined) {
      sourceBlockers.push(
        `${reconciliation.sourceSheet}!${reconciliation.sourceCell} references unknown forum69 topic ${reconciliation.topicId}`,
      );
    }
    if (forumFish !== undefined && reconciliation.canonicalName !== forumFish.canonicalName) {
      sourceBlockers.push(
        `${reconciliation.sourceSheet}!${reconciliation.sourceCell} canonical Fish differs from forum69 topic ${reconciliation.topicId as string}`,
      );
    }
    const status = weightRowStatus(reconciliation.topicId, min, max);
    const manualReviewReasons: string[] = [];
    if (status === 'SWAPPED') manualReviewReasons.push('SWAPPED_SOURCE_BOUNDS');
    if (status === 'INVALID') {
      if (min.status === 'INVALID') {
        manualReviewReasons.push(`INVALID_MIN:${min.invalidReason as string}`);
      }
      if (max.status === 'INVALID') {
        manualReviewReasons.push(`INVALID_MAX:${max.invalidReason as string}`);
      }
    }
    rows.push({
      baseName: reconciliation.baseName,
      canonicalFish: forumFish?.canonicalName ?? null,
      forumTopicId: reconciliation.topicId,
      reconciliationCategory: reconciliation.category,
      sourceSheet: reconciliation.sourceSheet,
      fishCell: reconciliation.sourceCell,
      rawFishName: reconciliation.rawName,
      min,
      max,
      status,
      targetGroupStatus: reconciliation.topicId === null ? null : 'UNIQUE',
      requiresManualReview: manualReviewReasons.length > 0,
      manualReviewReasons,
    });
  }

  const targetGroups = new Map<string, BaseFishWeightAuditRow[]>();
  for (const row of rows) {
    if (row.forumTopicId === null) continue;
    const key = `${row.baseName}\0${row.forumTopicId}`;
    const group = targetGroups.get(key) ?? [];
    group.push(row);
    targetGroups.set(key, group);
  }
  const duplicateGroups: BaseFishWeightDuplicateGroup[] = [];
  for (const group of targetGroups.values()) {
    if (group.length === 1) continue;
    const signatures = new Set(
      group.map((row) => `${cellSignature(row.min)}\0${cellSignature(row.max)}`),
    );
    const status = signatures.size === 1 ? 'DUPLICATE_IDENTICAL' : 'CONFLICT';
    for (const row of group) {
      row.targetGroupStatus = status;
      if (status === 'CONFLICT') {
        row.requiresManualReview = true;
        row.manualReviewReasons.push('CONFLICTING_TARGET_GROUP');
      }
    }
    const first = group[0];
    duplicateGroups.push({
      baseName: first.baseName,
      canonicalFish: first.canonicalFish ?? '',
      forumTopicId: first.forumTopicId as string,
      status,
      sourceRows: group.map((row) => ({
        fishCell: row.fishCell,
        minCell: row.min.cell,
        maxCell: row.max.cell,
        rawMin: row.min.rawValue,
        rawMax: row.max.rawValue,
        rowStatus: row.status,
      })),
    });
  }
  duplicateGroups.sort(
    (left, right) =>
      compareText(left.baseName, right.baseName) ||
      compareText(left.forumTopicId, right.forumTopicId),
  );

  const mappedRows = rows.filter((row) => row.forumTopicId !== null).length;
  const noTargetRows = rows.length - mappedRows;
  const reconciliationStatusCounts = countByValue(rows.map((row) => row.reconciliationCategory));
  const weightStatusCounts = emptyWeightStatusCounts();
  for (const row of rows) weightStatusCounts[row.status] += 1;
  const duplicateIdenticalGroups = duplicateGroups.filter(
    (group) => group.status === 'DUPLICATE_IDENTICAL',
  ).length;
  const conflictingGroups = duplicateGroups.filter((group) => group.status === 'CONFLICT').length;
  const manualReviewRows = rows.filter((row) => row.requiresManualReview);

  if (input.expectedCounts !== undefined) {
    const checks: Array<[string, number, number]> = [
      ['reconciliation rows', rows.length, input.expectedCounts.totalRows],
      ['mapped reconciliation rows', mappedRows, input.expectedCounts.mappedRows],
      [
        'unique target memberships',
        targetGroups.size,
        input.expectedCounts.uniqueTargetMemberships,
      ],
    ];
    for (const [label, actual, expected] of checks) {
      if (actual !== expected)
        sourceBlockers.push(`${label} ${String(actual)}; expected ${String(expected)}`);
    }
  }

  const blockersBeforeApplyReady = [...sourceBlockers];
  if (weightStatusCounts.SWAPPED > 0) {
    blockersBeforeApplyReady.push(
      `${String(weightStatusCounts.SWAPPED)} SWAPPED source rows require reviewed decisions`,
    );
  }
  if (weightStatusCounts.INVALID > 0) {
    blockersBeforeApplyReady.push(
      `${String(weightStatusCounts.INVALID)} INVALID source rows require reviewed decisions`,
    );
  }
  if (conflictingGroups > 0) {
    blockersBeforeApplyReady.push(
      `${String(conflictingGroups)} conflicting Base+Fish groups require reviewed decisions`,
    );
  }

  return {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    sources: input.sources,
    policy: {
      identitySource: 'accepted Excel reconciliation -> forum69 topicId',
      normalColumns: { fish: 'A', min: 'E', max: 'F' },
      volgaColumns: { fish: 'C', min: 'G', max: 'H' },
      automaticSwapsOrFixes: false,
      catchReportsRead: false,
    },
    reconciliation: {
      totalRows: rows.length,
      mappedRows,
      noTargetRows,
      statusCounts: reconciliationStatusCounts,
      explanation: `${String(rows.length)} total reconciliation rows = ${String(mappedRows)} rows with forum69 topicId + ${String(noTargetRows)} accepted terminal NO_TARGET rows`,
    },
    uniqueTargetMemberships: targetGroups.size,
    weightStatusCounts,
    duplicateIdenticalGroups,
    conflictingGroups,
    duplicateGroups,
    manualReviewRows,
    blockersBeforeApplyReady: [...new Set(blockersBeforeApplyReady)].sort(compareText),
    applyReady: blockersBeforeApplyReady.length === 0,
    rows,
  };
}

function csvCell(value: string | number | boolean | null | undefined | readonly string[]): string {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function baseFishWeightAuditCsv(rows: readonly BaseFishWeightAuditRow[]): string {
  const header = [
    'baseName',
    'canonicalFish',
    'forumTopicId',
    'reconciliationCategory',
    'sourceSheet',
    'fishCell',
    'rawFishName',
    'minCell',
    'maxCell',
    'rawMin',
    'rawMax',
    'minCellType',
    'maxCellType',
    'minParseStatus',
    'maxParseStatus',
    'minInvalidReason',
    'maxInvalidReason',
    'minWeightGrams',
    'maxWeightGrams',
    'rowStatus',
    'targetGroupStatus',
    'requiresManualReview',
    'manualReviewReasons',
  ];
  const body = rows.map((row) => [
    row.baseName,
    row.canonicalFish,
    row.forumTopicId,
    row.reconciliationCategory,
    row.sourceSheet,
    row.fishCell,
    row.rawFishName,
    row.min.cell,
    row.max.cell,
    row.min.rawValue,
    row.max.rawValue,
    row.min.cellType,
    row.max.cellType,
    row.min.status,
    row.max.status,
    row.min.invalidReason,
    row.max.invalidReason,
    row.min.valueGrams,
    row.max.valueGrams,
    row.status,
    row.targetGroupStatus,
    row.requiresManualReview,
    row.manualReviewReasons,
  ]);
  return `${[header, ...body].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}
