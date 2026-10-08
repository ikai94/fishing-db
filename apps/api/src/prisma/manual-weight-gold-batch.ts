import {
  validateManualWeightGold,
  type GoldCatalogPair,
  type ManualWeightGoldDataset,
  type ManualWeightGoldEntry,
} from './manual-weight-gold.js';

/** Номер строки — физическая строка начала записи CSV, включая заголовок. */
interface CsvRecord {
  row: number;
  fields: string[];
  error: string | null;
}

/** Частично верные строки не разрешают запись: весь пакет должен пройти проверку. */
export interface GoldBatchValidation {
  valid: boolean;
  accepted: number;
  rejected: number;
  errors: Array<{ row: number; message: string }>;
  entries: ManualWeightGoldEntry[];
}

const header = [
  'fishName',
  'baseName',
  'confirmedMaxWeightGrams',
  'confirmedMinWeightGrams',
  'note',
];

/** CSV сохраняет запятые, переносы и удвоенные кавычки внутри quoted-полей; BOM допустим. */
function parseCsv(input: string): CsvRecord[] {
  const csv = input.replace(/^\uFEFF/u, '');
  const records: CsvRecord[] = [];
  let fields: string[] = [],
    field = '',
    state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let line = 1,
    row = 1,
    started = false,
    error: string | null = null;
  /** Закрываем запись; полностью пустая физическая строка не считается данными. */
  const finish = () => {
    if (started) records.push({ row, fields: [...fields, field], error });
    fields = [];
    field = '';
    state = 'start';
    started = false;
    error = null;
  };
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '\r' || char === '\n') {
      const newline = char === '\r' && csv[i + 1] === '\n' ? '\r\n' : char;
      if (newline.length === 2) i++;
      if (state === 'quoted') field += newline;
      else {
        finish();
        row = line + 1;
      }
      line++;
      continue;
    }
    started = true;
    if (state === 'quoted') {
      if (char === '"' && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') state = 'closed';
      else field += char;
    } else if (char === ',') {
      fields.push(field);
      field = '';
      state = 'start';
    } else if (char === '"' && state === 'start') state = 'quoted';
    else {
      if (state === 'closed') error ??= 'Unexpected character after closing CSV quote';
      if (char === '"') error ??= 'Unexpected CSV quote in unquoted field';
      field += char;
      state = 'plain';
    }
  }
  if (state === 'quoted') error = 'Unterminated CSV quote';
  finish();
  return records;
}

/** Числа записываются десятичными целыми граммами; дроби, знак и экспонента запрещены. */
function csvGrams(value: string, name: string): number {
  const grams = Number(value);
  if (!/^[0-9]+$/u.test(value) || !Number.isSafeInteger(grams) || grams <= 0) {
    throw new Error(`${name}: expected positive integer grams`);
  }
  return grams;
}

/** Разрешаем имена только точным совпадением; неоднозначный каталог не дает выбрать первый ID. */
export function validateManualWeightGoldBatch(
  csv: string,
  current: unknown,
  catalog: GoldCatalogPair[],
): GoldBatchValidation {
  const gold = validateManualWeightGold(current, catalog);
  const records = parseCsv(csv);
  const first = records[0];
  if (!first || first.error || JSON.stringify(first.fields) !== JSON.stringify(header)) {
    return {
      valid: false,
      accepted: 0,
      rejected: Math.max(0, records.length - 1),
      entries: [],
      errors: [
        {
          row: first?.row ?? 1,
          message: first?.error ?? `Expected CSV header: ${header.join(',')}`,
        },
      ],
    };
  }
  const rows = records.slice(1);
  if (!rows.length)
    return {
      valid: false,
      accepted: 0,
      rejected: 0,
      entries: [],
      errors: [{ row: first.row + 1, message: 'Batch contains no data rows' }],
    };
  const names = new Map<string, Map<string, GoldCatalogPair>>();
  for (const p of catalog) {
    const nameKey = JSON.stringify([p.fishName, p.baseName]);
    const matches = names.get(nameKey) ?? new Map<string, GoldCatalogPair>();
    matches.set(`${p.fishId}/${p.fishingBaseId}`, p);
    names.set(nameKey, matches);
  }
  const existing = new Set(gold.entries.map((e) => `${e.fishId}/${e.fishingBaseId}`));
  const seen = new Map<string, number[]>();
  const errors = new Map<number, string>();
  const candidates: Array<{ row: number; entry: ManualWeightGoldEntry }> = [];
  for (const record of rows) {
    try {
      if (record.error) throw new Error(record.error);
      if (record.fields.length !== 5) throw new Error('Expected 5 CSV columns');
      const [fishName, baseName, max, min, note] = record.fields;
      const matches = names.get(JSON.stringify([fishName, baseName]));
      if (!matches?.size) throw new Error(`Unknown exact Fish/Base: ${fishName} / ${baseName}`);
      if (matches.size !== 1) throw new Error(`Ambiguous Fish/Base: ${fishName} / ${baseName}`);
      const pair = [...matches.values()][0];
      const key = `${pair.fishId}/${pair.fishingBaseId}`;
      seen.set(key, [...(seen.get(key) ?? []), record.row]);
      if (existing.has(key)) throw new Error('Duplicate pair already in GOLD');
      const entry: ManualWeightGoldEntry = {
        ...pair,
        confirmedMaxWeightGrams: csvGrams(max, 'max'),
        confirmedMinWeightGrams: min === '' ? null : csvGrams(min, 'min'),
        note: note === '' ? null : note,
        source: 'MANUAL',
      };
      // Единый валидатор сохраняет правила min <= max и положительных целых граммов.
      validateManualWeightGold({ ...gold, entries: [entry] }, catalog);
      candidates.push({ row: record.row, entry });
    } catch (error) {
      errors.set(record.row, error instanceof Error ? error.message : String(error));
    }
  }
  // Обе строки дубликата отвергаются, чтобы результат не зависел от их порядка или веса.
  for (const duplicateRows of seen.values()) {
    if (duplicateRows.length < 2) continue;
    for (const row of duplicateRows)
      if (!errors.has(row)) {
        errors.set(row, `Duplicate pair within batch (rows ${duplicateRows.join(', ')})`);
      }
  }
  const entries = candidates.filter((c) => !errors.has(c.row)).map((c) => c.entry);
  return {
    valid: errors.size === 0,
    accepted: entries.length,
    rejected: errors.size,
    errors: [...errors].sort(([a], [b]) => a - b).map(([row, message]) => ({ row, message })),
    entries,
  };
}

/** Новый эталон создается только из полностью проверенного пакета; прежняя версия сохраняется. */
export function appendManualWeightGoldBatch(
  current: unknown,
  validation: GoldBatchValidation,
  version: string,
  catalog: GoldCatalogPair[],
): ManualWeightGoldDataset {
  if (!validation.valid || !validation.entries.length)
    throw new Error('Batch rejected; no GOLD file written');
  const gold = validateManualWeightGold(current, catalog);
  if (version === gold.datasetVersion) throw new Error('Append requires a new dataset version');
  return validateManualWeightGold(
    { ...gold, datasetVersion: version, entries: [...gold.entries, ...validation.entries] },
    catalog,
  );
}
