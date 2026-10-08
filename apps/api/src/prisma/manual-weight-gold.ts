/** Ручной эталон хранится отдельно от решений о применении исправлений. */
export interface ManualWeightGoldEntry {
  fishId: string;
  fishingBaseId: string;
  fishName: string;
  baseName: string;
  confirmedMaxWeightGrams: number;
  confirmedMinWeightGrams: number | null;
  note: string | null;
  source: 'MANUAL';
}

/** Версия файла неизменяема: добавление создает следующий файл, не меняя старый. */
export interface ManualWeightGoldDataset {
  schemaVersion: 1;
  datasetVersion: string;
  entries: ManualWeightGoldEntry[];
}

/** Для проверки существования нужны только идентичности членств, без весов каталога. */
export interface GoldCatalogPair {
  fishId: string;
  fishingBaseId: string;
  fishName: string;
  baseName: string;
}

/** Прогноз подготовлен независимо: контракт не содержит ручных ответов или каталожного max. */
export interface GoldPrediction {
  fishId: string;
  fishingBaseId: string;
  predictedMaxWeightGrams: number | null;
  rangeGrams: [number, number] | null;
}

/** Непохожие имена не объединяются: ключ определяется двумя стабильными ID. */
function pairKey(pair: { fishId: string; fishingBaseId: string }): string {
  return `${pair.fishId}/${pair.fishingBaseId}`;
}

/** JSON проверяется до обращения к полям, чтобы ошибки ввода не обходили ограничения. */
export function goldObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object');
  }
  return value as Record<string, unknown>;
}

/** Вес в граммах должен быть положительным целым числом без потери точности. */
function positiveGrams(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field}: expected positive safe integer grams`);
  }
  return value;
}

/** ID и имя обязательны; приблизительные совпадения здесь запрещены. */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}: required string`);
  return value;
}

/** Снимок членств подтверждает существование рыбы, базы и самой пары без подключения к БД. */
export function parseGoldCatalog(value: unknown): GoldCatalogPair[] {
  const rows = goldObject(value).pairs;
  if (!Array.isArray(rows)) throw new Error('Catalog snapshot must contain pairs[]');
  return rows.map((value: unknown) => {
    const row = goldObject(value);
    return {
      fishId: text(row.fishId, 'fishId'),
      fishingBaseId: text(row.fishingBaseId, 'fishingBaseId'),
      fishName: text(row.fishName, 'fishName'),
      baseName: text(row.baseName, 'baseName'),
    };
  });
}

/** Проверяем эталон и точные имена, не используя его вес для какого-либо прогноза. */
export function validateManualWeightGold(
  value: unknown,
  catalog: GoldCatalogPair[],
): ManualWeightGoldDataset {
  const data = goldObject(value);
  if (data.schemaVersion !== 1) throw new Error('Unsupported GOLD schemaVersion');
  const datasetVersion = text(data.datasetVersion, 'datasetVersion');
  if (!/^\d{4}-\d{2}-\d{2}\.v[1-9]\d*$/u.test(datasetVersion)) {
    throw new Error('datasetVersion must be YYYY-MM-DD.vN');
  }
  if (!Array.isArray(data.entries)) throw new Error('GOLD must contain entries[]');
  const pairs = new Map(catalog.map((p) => [pairKey(p), p]));
  const seen = new Set<string>();
  const entries = data.entries.map((value: unknown): ManualWeightGoldEntry => {
    const row = goldObject(value);
    const identity = {
      fishId: text(row.fishId, 'fishId'),
      fishingBaseId: text(row.fishingBaseId, 'fishingBaseId'),
    };
    const key = pairKey(identity);
    if (seen.has(key)) throw new Error(`Duplicate GOLD Fish/Base: ${key}`);
    seen.add(key);
    const pair = pairs.get(key);
    if (!pair) throw new Error(`Fish/Base does not exist in catalog snapshot: ${key}`);
    if (row.fishName !== pair.fishName || row.baseName !== pair.baseName) {
      throw new Error(`Fish/Base names differ from exact catalog identity: ${key}`);
    }
    if (row.source !== 'MANUAL') throw new Error(`source must be MANUAL: ${key}`);
    const max = positiveGrams(row.confirmedMaxWeightGrams, 'confirmedMaxWeightGrams');
    const min =
      row.confirmedMinWeightGrams === null
        ? null
        : positiveGrams(row.confirmedMinWeightGrams, 'confirmedMinWeightGrams');
    if (min !== null && min > max) throw new Error(`Confirmed min exceeds max: ${key}`);
    if (row.note !== null && typeof row.note !== 'string') {
      throw new Error(`note must be string or null: ${key}`);
    }
    return {
      ...identity,
      fishName: pair.fishName,
      baseName: pair.baseName,
      confirmedMaxWeightGrams: max,
      confirmedMinWeightGrams: min,
      note: row.note,
      source: 'MANUAL',
    };
  });
  return { schemaVersion: 1, datasetVersion, entries };
}

/** Добавление заполняет имена из точного членства; дубликат отвергается, а не заменяется. */
export function appendManualWeightGold(
  current: unknown,
  entry: unknown,
  version: string,
  catalog: GoldCatalogPair[],
): ManualWeightGoldDataset {
  const dataset = validateManualWeightGold(current, catalog);
  if (version === dataset.datasetVersion) throw new Error('Append requires a new dataset version');
  const row = goldObject(entry);
  const pair = catalog.find(
    (p) => p.fishId === row.fishId && p.fishingBaseId === row.fishingBaseId,
  );
  if (!pair) throw new Error('Fish/Base does not exist in catalog snapshot');
  if (row.source !== undefined && row.source !== 'MANUAL') throw new Error('source must be MANUAL');
  if (
    (row.fishName !== undefined && row.fishName !== pair.fishName) ||
    (row.baseName !== undefined && row.baseName !== pair.baseName)
  ) {
    throw new Error('Supplied names differ from exact catalog identity');
  }
  return validateManualWeightGold(
    {
      ...dataset,
      datasetVersion: version,
      entries: [
        ...dataset.entries,
        {
          ...pair,
          confirmedMaxWeightGrams: row.confirmedMaxWeightGrams,
          confirmedMinWeightGrams: row.confirmedMinWeightGrams ?? null,
          note: row.note ?? null,
          source: 'MANUAL',
        },
      ],
    },
    catalog,
  );
}

/** Читаем только прогнозы из отдельного артефакта; подтвержденные ответы в нем не нужны. */
export function parseGoldPredictions(value: unknown): GoldPrediction[] {
  const data = goldObject(value);
  const rows = data.rows ?? data.diagnosticRows;
  if (!Array.isArray(rows)) throw new Error('Predictions must contain rows[] or diagnosticRows[]');
  const seen = new Set<string>();
  return rows.map((value: unknown) => {
    const row = goldObject(value);
    const identity = {
      fishId: text(row.fishId, 'fishId'),
      fishingBaseId: text(row.fishingBaseId, 'fishingBaseId'),
    };
    const key = pairKey(identity);
    if (seen.has(key)) throw new Error(`Duplicate prediction: ${key}`);
    seen.add(key);
    const prediction = row.fusion === undefined ? row : goldObject(row.fusion);
    const max =
      row.fusion === undefined ? prediction.predictedMaxWeightGrams : prediction.candidate;
    const range = prediction.rangeGrams;
    if (range !== null && (!Array.isArray(range) || range.length !== 2)) {
      throw new Error(`Invalid prediction range: ${key}`);
    }
    const bounds: [number, number] | null =
      range === null
        ? null
        : [
            positiveGrams((range as unknown[])[0], 'range lower'),
            positiveGrams((range as unknown[])[1], 'range upper'),
          ];
    if (bounds && bounds[0] > bounds[1]) throw new Error(`Reversed prediction range: ${key}`);
    return {
      ...identity,
      predictedMaxWeightGrams: max === null ? null : positiveGrams(max, 'prediction'),
      rangeGrams: bounds,
    };
  });
}

/** GOLD подключается только после прогнозов: сравнение не вызывает и не обучает inference. */
export function benchmarkManualWeightGold(
  predictions: GoldPrediction[],
  gold: ManualWeightGoldDataset,
) {
  const byPair = new Map(predictions.map((p) => [pairKey(p), p]));
  const cases = gold.entries.map((entry) => {
    const prediction = byPair.get(pairKey(entry));
    const max = prediction?.predictedMaxWeightGrams ?? null;
    const range = prediction?.rangeGrams ?? null;
    return {
      ...entry,
      predictedMaxWeightGrams: max,
      rangeGrams: range,
      exactMatch: max === entry.confirmedMaxWeightGrams,
      withinRange:
        range !== null &&
        range[0] <= entry.confirmedMaxWeightGrams &&
        entry.confirmedMaxWeightGrams <= range[1],
      missingPrediction: prediction === undefined,
    };
  });
  const total = cases.length;
  const exact = cases.filter((c) => c.exactMatch).length;
  const predicted = cases.filter((c) => c.predictedMaxWeightGrams !== null).length;
  return {
    datasetVersion: gold.datasetVersion,
    total,
    exact,
    exactAccuracyIncludingAbstentions: total ? exact / total : null,
    precisionAmongPredictions: predicted ? exact / predicted : null,
    abstentions: total - predicted,
    withinRange: cases.filter((c) => c.withinRange).length,
    missingPredictions: cases.filter((c) => c.missingPrediction).length,
    minBenchmark: 'NOT_EVALUATED',
    cases,
  };
}
