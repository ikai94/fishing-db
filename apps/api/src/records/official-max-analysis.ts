import { analyzeOfficialRatios, matchMutantBands } from './official-ratio-analysis.js';

/** Минимальные исторические данные: только официальный источник и текущий каталог. */
export interface OfficialMaxInput {
  snapshots: Array<{ id: string; weekStartsAt: string; fetchedAt: string }>;
  observations: Array<{
    weekStartsAt: string;
    fishId: string;
    fishingBaseId: string | null;
    fishName?: string;
    baseName?: string | null;
    weightGrams: number;
    waterbodyRaw: string;
    caughtAt: string;
    copies: number;
  }>;
  pairs: Array<{
    fishId: string;
    fishingBaseId: string;
    fishName: string;
    baseName: string;
    maxWeightGrams: number | null;
  }>;
}

/** Кандидат аналитика не является разрешением на изменение каталога. */
export interface OfficialMaxCandidate {
  fishId: string;
  fishingBaseId: string;
  fishName: string;
  baseName: string;
  currentMaxGrams: number | null;
  weekly: Array<{
    weekStartsAt: string;
    weightsGrams: number[];
    highestGrams: number;
    ratiosToCurrentMax: number[] | null;
  }>;
  clusterWeightsGrams: number[];
  clusterWeeks: number;
  proposedExactMaxGrams: number | null;
  candidateRangeGrams: [number, number] | null;
  observedBoundaryRangeGrams: [number, number] | null;
  catalogGridCandidateGrams: number | null;
  increaseAssessment: 'NORMAL_CAP_MISMATCH' | 'POSSIBLE_MUTANT_CAP' | null;
  matchedRatioBands: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  classification: 'OK' | 'MAX_TOO_LOW' | 'MAX_TOO_HIGH' | 'REVIEW';
  reason: string;
}

/** Ключ не смешивает рыбу с членством на другой базе. */
function key(fishId: string, baseId: string): string {
  return `${fishId}\0${baseId}`;
}

/** Эмпирическая сетка 11 × степень десяти проверяется отдельно для каждого масштаба. */
function gridStep(weight: number): number {
  return 11 * 10 ** Math.max(0, Math.floor(Math.log10(weight)) - 2);
}

/** Разные обновления снимка не увеличивают число независимых недель. */
function weeklyWeights(
  observations: OfficialMaxInput['observations'],
): Array<Omit<OfficialMaxCandidate['weekly'][number], 'ratiosToCurrentMax'>> {
  const weeks = new Map<string, Set<number>>();
  for (const observation of observations) {
    const weights = weeks.get(observation.weekStartsAt) ?? new Set<number>();
    weights.add(observation.weightGrams);
    weeks.set(observation.weekStartsAt, weights);
  }
  return [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartsAt, weights]) => {
      const weightsGrams = [...weights].sort((a, b) => a - b);
      return { weekStartsAt, weightsGrams, highestGrams: weightsGrams.at(-1)! };
    });
}

/** Ищет узкие повторяющиеся кластеры, включая нижнюю границу под отдельными мутантами. */
function clusters(weekly: ReturnType<typeof weeklyWeights>) {
  const weights = [...new Set(weekly.flatMap((week) => week.weightsGrams))].sort((a, b) => a - b);
  return weights
    .map((upper) => {
      const lower = Math.ceil(upper / 1.01);
      const members = weights.filter((weight) => weight >= lower && weight <= upper);
      const weeks = weekly.filter((week) =>
        week.weightsGrams.some((w) => w >= lower && w <= upper),
      ).length;
      return { upper, lower: members[0], weights: members, weeks };
    })
    .filter((cluster) => cluster.weeks >= 2);
}

/**
 * Оценивает нормальную границу по независимым неделям и калибровочным парам.
 * Устойчивый нижний кластер около текущего max защищает от повторяющихся мутантов;
 * низкие рекорды без тесного кластера не доказывают завышенный max.
 */
export function analyzeOfficialMax(input: OfficialMaxInput) {
  const byPair = new Map<string, OfficialMaxInput['observations']>();
  let unmappedObservations = 0;
  for (const observation of input.observations) {
    if (observation.fishingBaseId === null) {
      unmappedObservations += 1;
      continue;
    }
    const pairKey = key(observation.fishId, observation.fishingBaseId);
    const observations = byPair.get(pairKey) ?? [];
    observations.push(observation);
    byPair.set(pairKey, observations);
  }
  const pairByKey = new Map(
    input.pairs.map((pair) => [key(pair.fishId, pair.fishingBaseId), pair]),
  );
  const calibrationRatios: number[] = [];
  const controlMaxima: number[] = [];
  for (const pair of input.pairs) {
    if (pair.maxWeightGrams === null) continue;
    const weekly = weeklyWeights(byPair.get(key(pair.fishId, pair.fishingBaseId)) ?? []);
    const highs = weekly.map((week) => week.highestGrams);
    // Калибровочная гипотеза: три тесных недельных рекорда прямо под текущим max.
    if (
      highs.length >= 3 &&
      Math.min(...highs) >= pair.maxWeightGrams * 0.98 &&
      Math.max(...highs) <= pair.maxWeightGrams &&
      Math.max(...highs) / Math.min(...highs) <= 1.01
    ) {
      calibrationRatios.push(Math.max(...highs) / pair.maxWeightGrams);
      controlMaxima.push(pair.maxWeightGrams);
    }
  }
  calibrationRatios.sort((a, b) => a - b);
  const calibrated = calibrationRatios.length >= 20;
  // Широкая эмпирическая граница сохраняет редкие недоловленные контрольные пары.
  const boundaryRatioFloor = calibrated ? calibrationRatios[0] : 0.98;
  const catalogMaxima = input.pairs.flatMap((pair) =>
    pair.maxWeightGrams === null ? [] : [pair.maxWeightGrams],
  );
  const candidates: OfficialMaxCandidate[] = [];
  for (const [pairKey, observations] of [...byPair].sort(([a], [b]) => a.localeCompare(b))) {
    const pair = pairByKey.get(pairKey);
    const weekly = weeklyWeights(observations);
    const current = pair?.maxWeightGrams ?? null;
    const available = clusters(weekly);
    const nearCurrent =
      current === null
        ? undefined
        : available
            .filter((c) => c.upper >= current * 0.98 && c.upper <= current)
            .sort((a, b) => b.weeks - a.weeks || b.upper - a.upper)[0];
    // Поддержка тремя неделями сильнее более высокого кластера только из двух недель.
    const cluster =
      nearCurrent ?? available.sort((a, b) => b.weeks - a.weeks || b.upper - a.upper)[0];
    let classification: OfficialMaxCandidate['classification'] = 'REVIEW';
    let confidence: OfficialMaxCandidate['confidence'] = 'LOW';
    let proposedExactMaxGrams: number | null = null;
    let catalogGridCandidateGrams: number | null = null;
    let candidateRangeGrams: [number, number] | null = null;
    let reason = 'INSUFFICIENT_INDEPENDENT_WEEKS_OR_NO_STABLE_1_PERCENT_CLUSTER';
    if (cluster !== undefined) {
      candidateRangeGrams = [cluster.upper, Math.ceil(cluster.upper / boundaryRatioFloor)];
      const [lower, upper] = candidateRangeGrams;
      const step = gridStep(lower);
      const magnitude = Math.floor(Math.log10(lower));
      const comparable = catalogMaxima.filter((m) => Math.floor(Math.log10(m)) === magnitude);
      const gridSupport =
        comparable.filter((m) => m % step === 0).length / Math.max(1, comparable.length);
      const gridCandidate = Math.ceil(lower / step) * step;
      const uniqueGridCandidate = gridCandidate <= upper && gridCandidate + step > upper;
      if (uniqueGridCandidate && comparable.length >= 20 && gridSupport >= 0.75)
        catalogGridCandidateGrams = gridCandidate;
      const strong = calibrated && cluster.weeks >= 3 && cluster.weights.length >= 3;
      confidence = strong ? 'HIGH' : 'MEDIUM';
      if (current === null || pair === undefined) {
        confidence = 'LOW';
        reason = 'MISSING_CURRENT_MAX_OR_MEMBERSHIP';
      } else if (nearCurrent !== undefined) {
        classification = 'OK';
        reason = 'REPEATED_NORMAL_CLUSTER_NEAR_CURRENT_MAX;HIGHER_VALUES_ARE_MUTANT_AMBIGUOUS';
        candidateRangeGrams = null;
      } else if (lower > current) {
        classification = 'MAX_TOO_LOW';
        reason = 'PROVISIONAL_REPEATED_BOUNDARY_ABOVE_CURRENT';
        // Очень крупный сдвиг может быть устойчивым мутантным режимом: точность понижаем.
        if (lower / current > 1.25) confidence = 'MEDIUM';
      } else if (upper < current * 0.95 && cluster.weeks >= 3) {
        classification = 'MAX_TOO_HIGH';
        confidence = 'MEDIUM';
        reason = 'THREE_WEEK_STABLE_BOUNDARY_BELOW_CURRENT;LOW_EFFORT_REMAINS_POSSIBLE';
      } else {
        confidence = 'LOW';
        reason = 'INSUFFICIENT_LOWER_BOUNDARY_SUPPORT';
      }
      if (
        confidence === 'HIGH' &&
        uniqueGridCandidate &&
        comparable.length >= 20 &&
        gridSupport >= 0.75 &&
        classification === 'MAX_TOO_LOW'
      )
        proposedExactMaxGrams = gridCandidate;
      reason += `;clusterWeeks=${cluster.weeks};distinctWeights=${cluster.weights.length};gridStep=${step};gridSupport=${gridSupport.toFixed(4)};calibrators=${calibrationRatios.length}`;
    }
    candidates.push({
      fishId: observations[0].fishId,
      fishingBaseId: observations[0].fishingBaseId!,
      fishName: pair?.fishName ?? observations[0].fishName ?? observations[0].fishId,
      baseName: pair?.baseName ?? observations[0].baseName ?? observations[0].fishingBaseId!,
      currentMaxGrams: current,
      weekly: weekly.map((week) => ({
        ...week,
        ratiosToCurrentMax: current === null ? null : week.weightsGrams.map((w) => w / current),
      })),
      clusterWeightsGrams: cluster?.weights ?? [],
      clusterWeeks: cluster?.weeks ?? 0,
      proposedExactMaxGrams,
      candidateRangeGrams,
      observedBoundaryRangeGrams: candidateRangeGrams,
      catalogGridCandidateGrams,
      increaseAssessment: null,
      matchedRatioBands: [],
      confidence,
      classification,
      reason,
    });
  }
  const ratioAnalysis = analyzeOfficialRatios(candidates);
  for (const row of candidates) {
    row.matchedRatioBands = matchMutantBands(row, ratioAnalysis.bands);
    if (
      row.matchedRatioBands.length > 0 &&
      (row.classification === 'MAX_TOO_LOW' || row.classification === 'REVIEW')
    ) {
      // Общий межвидовой режим запрещает выдавать наблюдаемый потолок мутантов за нормальный max.
      row.increaseAssessment = 'POSSIBLE_MUTANT_CAP';
      row.classification = 'REVIEW';
      row.confidence = 'MEDIUM';
      row.proposedExactMaxGrams = null;
      row.catalogGridCandidateGrams = null;
      row.candidateRangeGrams = null;
      row.reason = `POSSIBLE_MUTANT_CAP;matchedBands=${row.matchedRatioBands.join(',')};${row.reason}`;
    } else if (row.classification === 'MAX_TOO_LOW') {
      if (row.catalogGridCandidateGrams !== null) {
        row.increaseAssessment = 'NORMAL_CAP_MISMATCH';
        row.reason = `NORMAL_CAP_MISMATCH;NO_RECURRING_CROSS_SPECIES_BAND;${row.reason}`;
      } else {
        row.classification = 'REVIEW';
        row.confidence = 'LOW';
        row.proposedExactMaxGrams = null;
        row.candidateRangeGrams = null;
        row.reason = `NO_UNIQUE_SUPPORTED_NORMAL_CATALOG_BOUNDARY;${row.reason}`;
      }
    }
  }
  const confidenceRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  /** Подозреваемые исправления идут первыми; ранжирование воспроизводимо при том же входе. */
  const correctionRank = (row: OfficialMaxCandidate) =>
    row.classification.startsWith('MAX_TOO_') ? 0 : 1;
  candidates.sort(
    (a, b) =>
      correctionRank(a) - correctionRank(b) ||
      confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
      Number(b.proposedExactMaxGrams !== null) - Number(a.proposedExactMaxGrams !== null) ||
      b.clusterWeeks - a.clusterWeeks ||
      b.clusterWeightsGrams.length - a.clusterWeightsGrams.length ||
      a.fishName.localeCompare(b.fishName, 'ru') ||
      a.baseName.localeCompare(b.baseName, 'ru'),
  );
  const classifications = { OK: 0, MAX_TOO_LOW: 0, MAX_TOO_HIGH: 0, REVIEW: 0 };
  const confidences = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of candidates) {
    classifications[row.classification]++;
    confidences[row.confidence]++;
  }
  const weeks = [...new Set(input.snapshots.map((s) => s.weekStartsAt))].sort();
  const missingWeeks: string[] = [];
  const weekMs = 7 * 24 * 60 * 60_000;
  for (let index = 1; index < weeks.length; index++) {
    for (
      let start = Date.parse(weeks[index - 1]) + weekMs;
      start < Date.parse(weeks[index]);
      start += weekMs
    ) {
      missingWeeks.push(new Date(start).toISOString());
    }
  }
  return {
    policy: {
      readOnly: true,
      catchReportsRead: false,
      clusterWidthRatio: 1.01,
      mutantMultipliersPreset: false,
      mutantBandVeto: true,
      exactMeaning: 'Unique supported catalog-grid candidate, not proven game parameter',
      limitation:
        'Only global official record holders are observed; repeated mutants and low fishing effort cannot be ruled out.',
    },
    counts: {
      snapshots: input.snapshots.length,
      weeks: weeks.length,
      catalogPairs: input.pairs.length,
      pairsAnalyzed: candidates.length,
      pairsWithAtLeastTwoWeeks: candidates.filter((c) => c.weekly.length >= 2).length,
      missingMembershipPairs: candidates.filter(
        (c) => !pairByKey.has(key(c.fishId, c.fishingBaseId)),
      ).length,
      unmappedObservations,
      distinctSourceObservations: input.observations.length,
      snapshotRowCopies: input.observations.reduce((sum, o) => sum + o.copies, 0),
      classifications,
      confidences,
      increaseAssessments: {
        NORMAL_CAP_MISMATCH: candidates.filter(
          (c) => c.increaseAssessment === 'NORMAL_CAP_MISMATCH',
        ).length,
        POSSIBLE_MUTANT_CAP: candidates.filter(
          (c) => c.increaseAssessment === 'POSSIBLE_MUTANT_CAP',
        ).length,
      },
    },
    history: weeks.map((weekStartsAt) => {
      const snapshots = input.snapshots.filter((s) => s.weekStartsAt === weekStartsAt);
      const fetched = snapshots.map((s) => s.fetchedAt).sort();
      return {
        weekStartsAt,
        snapshots: snapshots.length,
        firstFetchedAt: fetched[0],
        lastFetchedAt: fetched.at(-1),
      };
    }),
    missingWeeks,
    calibration: {
      assumedCorrectPairs: calibrationRatios.length,
      calibrated,
      boundaryRatioFloor,
      medianUpperRecordToCurrentMax:
        calibrationRatios[Math.floor(calibrationRatios.length / 2)] ?? null,
      p05UpperRecordToCurrentMax:
        calibrationRatios[Math.floor(calibrationRatios.length * 0.05)] ?? null,
      maximaCount: catalogMaxima.length,
      divisibility: [10, 11, 100, 110, 1000, 1100].map((stepGrams) => ({
        stepGrams,
        count: catalogMaxima.filter((m) => m % stepGrams === 0).length,
      })),
      controlDivisibility: [10, 11, 100, 110, 1000, 1100].map((stepGrams) => ({
        stepGrams,
        count: controlMaxima.filter((m) => m % stepGrams === 0).length,
      })),
      note: '11-based values are consistent with 1.1 × round nominal weights; this is an empirical pattern, not an imposed game rule.',
    },
    ratioAnalysis,
    candidates,
  };
}
