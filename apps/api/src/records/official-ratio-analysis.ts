import type { OfficialMaxCandidate } from './official-max-analysis.js';

/** Один вес одной недели: копии снимков не получают дополнительных голосов. */
interface RatioSample {
  ratio: number;
  pairKey: string;
  fishId: string;
  baseId: string;
  week: string;
}

/** Частоты позволяют отличить межвидовой режим от повторений одной рыбы. */
export interface RatioBand {
  id: string;
  lowerRatio: number;
  upperRatio: number;
  medianRatio: number;
  weeklyWeights: number;
  pairs: number;
  fish: number;
  bases: number;
  pairWeeks: number;
  repeatedPairs: number;
  controlPairs: number;
  support: 'CONTROL_SUPPORTED_REGIME' | 'UNANCHORED_POSSIBLE_MUTANT_BAND';
  participants: Array<{
    fishId: string;
    baseId: string;
    fishName: string;
    baseName: string;
    weeks: number;
  }>;
}

/** Сводка считает пары и недели, а не частоту обновлений официальной таблицы. */
function bandStats(samples: readonly RatioSample[], controls: ReadonlySet<string>) {
  const weeksByPair = new Map<string, Set<string>>();
  for (const sample of samples) {
    const weeks = weeksByPair.get(sample.pairKey) ?? new Set<string>();
    weeks.add(sample.week);
    weeksByPair.set(sample.pairKey, weeks);
  }
  return {
    weeklyWeights: samples.length,
    pairs: weeksByPair.size,
    fish: new Set(samples.map((s) => s.fishId)).size,
    bases: new Set(samples.map((s) => s.baseId)).size,
    pairWeeks: [...weeksByPair.values()].reduce((sum, weeks) => sum + weeks.size, 0),
    repeatedPairs: [...weeksByPair.values()].filter((weeks) => weeks.size >= 2).length,
    controlPairs: [...weeksByPair.keys()].filter((pair) => controls.has(pair)).length,
  };
}

/** Медиана не зависит от порядка чтения SQL. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Открывает полосы из данных: сетка 0.005 служит только разрешением гистограммы.
 * Контрольная пара имеет тесный кластер у текущего max в двух неделях; её высокие
 * значения намеренно сохраняются, иначе частота мутантов была бы нулевой по определению.
 */
export function analyzeOfficialRatios(candidates: readonly OfficialMaxCandidate[]) {
  const binWidth = 0.005;
  const crossSpeciesWindow = 0.01;
  const controls = new Set<string>();
  const samples: RatioSample[] = [];
  const pairByKey = new Map(candidates.map((c) => [`${c.fishId}\0${c.fishingBaseId}`, c]));
  for (const row of candidates) {
    const current = row.currentMaxGrams;
    if (current === null) continue;
    const pairKey = `${row.fishId}\0${row.fishingBaseId}`;
    const possibleNormalWeights = row.weekly
      .flatMap((w) => w.weightsGrams)
      .filter((w) => w >= current * 0.98 && w <= current);
    if (
      possibleNormalWeights.some(
        (upper) =>
          row.weekly.filter((week) =>
            week.weightsGrams.some((w) => w >= upper / 1.01 && w <= upper),
          ).length >= 2,
      )
    )
      controls.add(pairKey);
    for (const week of row.weekly) {
      for (const weight of week.weightsGrams)
        samples.push({
          ratio: weight / current,
          pairKey,
          fishId: row.fishId,
          baseId: row.fishingBaseId,
          week: week.weekStartsAt,
        });
    }
  }
  const bins = new Map<number, RatioSample[]>();
  for (const sample of samples) {
    const bin = Math.round(sample.ratio / binWidth);
    const values = bins.get(bin) ?? [];
    values.push(sample);
    bins.set(bin, values);
  }
  const histogram = [...bins]
    .sort(([a], [b]) => a - b)
    .map(([bin, values]) => ({
      centerRatio: bin * binWidth,
      lowerRatio: (bin - 0.5) * binWidth,
      upperRatio: (bin + 0.5) * binWidth,
      all: bandStats(values, controls),
      controls: bandStats(
        values.filter((s) => controls.has(s.pairKey)),
        controls,
      ),
    }));
  const bands: RatioBand[] = [];
  const controlAbove = samples.filter((s) => controls.has(s.pairKey) && s.ratio > 1);
  // Соседние наполненные интервалы описывают непрерывный режим, а не несколько выдуманных потолков.
  const denseBins = [...bins]
    .filter(([, values]) => {
      const above = values.filter((s) => controls.has(s.pairKey) && s.ratio > 1);
      return (
        new Set(above.map((s) => s.fishId)).size >= 5 &&
        new Set(above.map((s) => s.baseId)).size >= 3
      );
    })
    .map(([bin]) => bin)
    .sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const bin of denseBins) {
    const previous = runs.at(-1);
    if (previous !== undefined && previous.at(-1)! + 1 === bin) previous.push(bin);
    else runs.push([bin]);
  }
  for (const run of runs) {
    const lowerRatio = Math.max(1, (run[0] - 0.5) * binWidth);
    const upperRatio = (run.at(-1)! + 0.5) * binWidth;
    const members = samples.filter((s) => s.ratio > lowerRatio && s.ratio <= upperRatio);
    bands.push({
      id: `control-${bands.length + 1}`,
      lowerRatio,
      upperRatio,
      medianRatio: median(
        controlAbove
          .filter((s) => s.ratio > lowerRatio && s.ratio <= upperRatio)
          .map((s) => s.ratio),
      ),
      ...bandStats(members, controls),
      support: 'CONTROL_SUPPORTED_REGIME',
      participants: [],
    });
  }
  const aboveEnvelope = samples.filter(
    (s) => s.ratio > 1 && !bands.some((b) => s.ratio >= b.lowerRatio && s.ratio <= b.upperRatio),
  );
  const windows: Array<{ members: RatioSample[]; repeated: RatioSample[] }> = [];
  for (const lower of [...new Set(aboveEnvelope.map((s) => s.ratio))].sort((a, b) => a - b)) {
    const members = aboveEnvelope.filter(
      (s) => s.ratio >= lower && s.ratio <= lower + crossSpeciesWindow,
    );
    const repeatedKeys = new Set(
      members
        .filter(
          (s) =>
            new Set(members.filter((o) => o.pairKey === s.pairKey).map((o) => o.week)).size >= 2,
        )
        .map((s) => s.pairKey),
    );
    const repeated = members.filter((s) => repeatedKeys.has(s.pairKey));
    if (
      new Set(repeated.map((s) => s.fishId)).size >= 2 &&
      new Set(repeated.map((s) => s.baseId)).size >= 2
    )
      windows.push({ members, repeated });
  }
  windows.sort(
    (a, b) =>
      bandStats(b.repeated, controls).pairWeeks - bandStats(a.repeated, controls).pairWeeks ||
      Math.max(...a.repeated.map((s) => s.ratio)) -
        Math.min(...a.repeated.map((s) => s.ratio)) -
        (Math.max(...b.repeated.map((s) => s.ratio)) -
          Math.min(...b.repeated.map((s) => s.ratio))) ||
      Math.min(...a.repeated.map((s) => s.ratio)) - Math.min(...b.repeated.map((s) => s.ratio)),
  );
  for (const window of windows) {
    const lowerRatio = Math.min(...window.repeated.map((s) => s.ratio));
    const upperRatio = Math.max(...window.repeated.map((s) => s.ratio));
    const repeatedKeys = [...new Set(window.repeated.map((s) => s.pairKey))].sort();
    // Перекрывающиеся окна одной группы рыб не превращаются в независимые подтверждения режима.
    if (
      bands.some(
        (b) =>
          b.support === 'UNANCHORED_POSSIBLE_MUTANT_BAND' &&
          b.participants.some((p) => repeatedKeys.includes(`${p.fishId}\0${p.baseId}`)),
      )
    )
      continue;
    const pairWeeks = new Map<string, number>();
    for (const sample of window.repeated) {
      const key = `${sample.pairKey}\0${sample.week}`;
      pairWeeks.set(key, Math.max(pairWeeks.get(key) ?? 0, sample.ratio));
    }
    bands.push({
      id: `cross-${bands.filter((b) => b.support === 'UNANCHORED_POSSIBLE_MUTANT_BAND').length + 1}`,
      lowerRatio,
      upperRatio,
      medianRatio: median([...pairWeeks.values()]),
      ...bandStats(
        aboveEnvelope.filter((s) => s.ratio >= lowerRatio && s.ratio <= upperRatio),
        controls,
      ),
      support: 'UNANCHORED_POSSIBLE_MUTANT_BAND',
      participants: repeatedKeys.map((pairKey) => {
        const pair = pairByKey.get(pairKey)!;
        return {
          fishId: pair.fishId,
          baseId: pair.fishingBaseId,
          fishName: pair.fishName,
          baseName: pair.baseName,
          weeks: new Set(window.repeated.filter((s) => s.pairKey === pairKey).map((s) => s.week))
            .size,
        };
      }),
    });
  }
  bands.sort((a, b) => a.lowerRatio - b.lowerRatio);
  const controlsWithAbove = new Set(controlAbove.map((s) => s.pairKey));
  const validPairs = new Set(samples.map((s) => s.pairKey));
  return {
    policy: {
      binWidth,
      crossSpeciesWindow,
      minimumControlFishPerBin: 5,
      minimumControlBasesPerBin: 3,
      minimumRecurringFishOutsideControls: 2,
      minimumRecurringBasesOutsideControls: 2,
      bandMatchTolerance: binWidth / 2,
      note: 'No preset mutant multipliers. Unanchored recurring bands block corrections but do not prove a game multiplier. Histogram counts distinct pair/week/weight, not snapshot copies.',
    },
    counts: {
      validPairs: validPairs.size,
      weeklyWeights: samples.length,
      pairsWithAboveMax: new Set(samples.filter((s) => s.ratio > 1).map((s) => s.pairKey)).size,
      controlPairs: controls.size,
      controlPairsWithAboveMax: controlsWithAbove.size,
      controlAboveMaxFraction: controls.size === 0 ? null : controlsWithAbove.size / controls.size,
      controlWeeklyWeights: samples.filter((s) => controls.has(s.pairKey)).length,
      controlAboveMaxWeeklyWeights: controlAbove.length,
      controlAboveMaxPairWeeks: new Set(controlAbove.map((s) => `${s.pairKey}\0${s.week}`)).size,
      controlAboveMaxMinRatio:
        controlAbove.length === 0 ? null : Math.min(...controlAbove.map((s) => s.ratio)),
      controlAboveMaxMaxRatio:
        controlAbove.length === 0 ? null : Math.max(...controlAbove.map((s) => s.ratio)),
    },
    bands,
    histogram,
    nearOne: {
      lowerRatio: 1 - binWidth,
      upperRatio: 1 + binWidth,
      all: bandStats(
        samples.filter((s) => Math.abs(s.ratio - 1) <= binWidth),
        controls,
      ),
      controls: bandStats(
        samples.filter((s) => controls.has(s.pairKey) && Math.abs(s.ratio - 1) <= binWidth),
        controls,
      ),
    },
  };
}

/**
 * Для неподтверждённой полосы нужны другая рыба и две недели совпадений.
 * Контрольный режим объясняет даже одиночное превышение: его не превращаем в исправление max.
 */
export function matchMutantBands(row: OfficialMaxCandidate, bands: readonly RatioBand[]): string[] {
  if (row.currentMaxGrams === null || row.clusterWeightsGrams.length === 0) return [];
  const current = row.currentMaxGrams;
  const clusterWeights = new Set(row.clusterWeightsGrams);
  return bands
    .filter(
      (band) =>
        row.weekly.filter((week) =>
          week.weightsGrams.some(
            (weight) =>
              clusterWeights.has(weight) &&
              weight > current &&
              weight / current >= band.lowerRatio - 0.0025 &&
              weight / current <= band.upperRatio + 0.0025,
          ),
        ).length >= (band.support === 'CONTROL_SUPPORTED_REGIME' ? 1 : 2) &&
        (band.support === 'CONTROL_SUPPORTED_REGIME' ||
          band.participants.some((p) => p.fishId !== row.fishId)),
    )
    .map((band) => band.id);
}
