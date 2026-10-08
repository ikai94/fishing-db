import { analyzeOfficialRatios, matchMutantBands } from '../records/official-ratio-analysis.js';
import type { OfficialMaxCandidate, OfficialMaxInput } from '../records/official-max-analysis.js';
import { inferKlevalkaOrdinaryMax } from '../klevalka-catch-generator/klevalka-max-weight-audit.js';

/** Полный срез членств; уловы приложения намеренно отсутствуют в контракте. */
export interface WeightPair {
  fishId: string;
  fishingBaseId: string;
  fishName: string;
  baseName: string;
  forumTopicId: string | null;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

/** Ручная отметка /records задаёт глобальный максимум рыбы, пока база не указана явно. */
export interface AdminWeightIssue {
  fishId: string;
  expectedWeightGrams: number | null;
  note: string | null;
  updatedAt: string;
}

/** Источник хранит наблюдения отдельно от сгенерированных CatchReport. */
export interface PairSource {
  weightsGrams: number[];
  locations: string[];
  baits: string[];
  references: string[];
}

/** Внешняя ручная правка имеет точную пару и прежнюю границу для проверки дрейфа. */
export interface ManualCorrection {
  fishName: string;
  baseName: string;
  oldMaxWeightGrams: number | null;
  proposedMaxWeightGrams: number;
  reference: string;
}

/** Все источники сериализуются для повторного анализа одного и того же среза. */
export interface ReconciliationInput {
  capturedAt: string;
  head: string;
  pairs: WeightPair[];
  issues: AdminWeightIssue[];
  official: OfficialMaxInput;
  klevalka: Record<string, PairSource>;
  workbook: Record<string, { min: number | null; max: number | null; references: string[] }>;
  historicalCorrections: ManualCorrection[];
  sources: Array<{ kind: string; reference: string; sha256?: string; limitation: string }>;
  mappingReviews: Array<{ reference: string; reason: string }>;
}

/** Девять явно подтверждённых пользователем правок сохраняют исходные целые граммы. */
export const REVIEW_CORRECTIONS: ManualCorrection[] = [
  ['Акула серо-голубая', 'Побережье Камчатки', 1100000, 1430000],
  ['Ламна', 'Антарктика', 143000, 154000],
  ['Рыба-лягушка', 'Побережье Камчатки', 3520, 3850],
  ['Сейвал', 'Лофотенские острова', 44000000, 51700000],
  ['Сима', 'Кроноцкий залив', 11000, 13200],
  ['Угорь речной японский', 'Янцзы', 12100, 14300],
  ['Носорог Вламинга', 'Гавайские острова', 3300, 2750],
  ['Гребнистый крокодил', 'Большой Барьерный Риф', 1870000, 2530000],
  ['Чир', 'Ундюлюнг', 15400, 19800],
].map(([fishName, baseName, oldMaxWeightGrams, proposedMaxWeightGrams]) => ({
  fishName: fishName as string,
  baseName: baseName as string,
  oldMaxWeightGrams: oldMaxWeightGrams as number,
  proposedMaxWeightGrams: proposedMaxWeightGrams as number,
  reference: 'user-confirmed-review:2026-10-04',
}));

/** Статус пары отделяет ручное решение, статистическую гипотезу и недостаток доказательств. */
export type ReconciliationStatus =
  | 'CONFIRMED'
  | 'SAFE_TO_CORRECT'
  | 'LIKELY_WRONG_SMALL_WEIGHT'
  | 'STRONG_REVIEW'
  | 'CONFLICT'
  | 'INSUFFICIENT';

/** Идентификаторы, а не похожие имена, определяют ключ членства. */
export function weightPairKey(pair: Pick<WeightPair, 'fishId' | 'fishingBaseId'>): string {
  return `${pair.fishId}/${pair.fishingBaseId}`;
}

/** Нормализуем лишь регистр и пробелы: е/ё, пунктуацию и алиасы не объединяем. */
export function exactWeightName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
}

/** Евклид применяется к целым граммам; коэффициенты сетки не задаются заранее. */
function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/**
 * Кандидаты шага открываются через НОД наблюдаемых границ одного порядка величины.
 * Поддержку считаем также по разным значениям: повтор одного веса не создаёт сетку.
 */
export function discoverWeightGrids(values: readonly number[]) {
  const byMagnitude = new Map<number, number[]>();
  for (const value of values.filter((v) => Number.isSafeInteger(v) && v > 0)) {
    const magnitude = Math.floor(Math.log10(value));
    byMagnitude.set(magnitude, [...(byMagnitude.get(magnitude) ?? []), value]);
  }
  return [...byMagnitude]
    .sort(([a], [b]) => a - b)
    .map(([magnitude, weights]) => {
      const unique = [...new Set(weights)].sort((a, b) => a - b);
      const steps = new Set<number>();
      for (let i = 0; i < unique.length; i++)
        for (let j = i + 1; j < unique.length; j++) {
          const step = gcd(unique[i], unique[j]);
          if (step > 1) steps.add(step);
        }
      const candidates = [...steps]
        .map((stepGrams) => ({
          stepGrams,
          pairs: weights.length,
          distinctValues: unique.length,
          supportingPairs: weights.filter((v) => v % stepGrams === 0).length,
          supportingDistinctValues: unique.filter((v) => v % stepGrams === 0).length,
        }))
        .filter(
          (s) =>
            s.supportingPairs / s.pairs >= 0.75 && s.pairs >= 20 && s.supportingDistinctValues >= 5,
        )
        .sort((a, b) => b.stepGrams - a.stepGrams);
      return { magnitude, candidates, stepGrams: candidates[0]?.stepGrams ?? null };
    });
}

/** Срезы одной недели дают один голос; каждый изменившийся вес остаётся видимым. */
function weekly(input: ReconciliationInput, pair: WeightPair) {
  const weeks = new Map<string, Set<number>>();
  for (const o of input.official.observations) {
    if (o.fishId !== pair.fishId || o.fishingBaseId !== pair.fishingBaseId) continue;
    weeks.set(o.weekStartsAt, new Set([...(weeks.get(o.weekStartsAt) ?? []), o.weightGrams]));
  }
  return [...weeks]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartsAt, weights]) => ({
      weekStartsAt,
      weightsGrams: [...weights].sort((a, b) => a - b),
    }));
}

/** Малая рыба допускает дискретность 1–2 г; проценты не заменяют абсолютную ошибку. */
function repeatedClusters(weeks: ReturnType<typeof weekly>) {
  return [...new Set(weeks.flatMap((w) => w.weightsGrams))]
    .map((upper) => {
      const lower = upper - Math.max(2, Math.floor(upper * 0.01));
      const members = [
        ...new Set(weeks.flatMap((w) => w.weightsGrams).filter((v) => v >= lower && v <= upper)),
      ].sort((a, b) => a - b);
      const supportWeeks = weeks.filter((w) =>
        w.weightsGrams.some((v) => v >= lower && v <= upper),
      ).length;
      return { upper, members, supportWeeks };
    })
    .filter((c) => c.supportWeeks >= 2);
}

/** Промежуточное предположение не даёт разрешения на исправление. */
function inferAll(input: ReconciliationInput, excludedFish: Set<string>) {
  const training = input.pairs.filter((p) => !excludedFish.has(p.fishId));
  const grids = discoverWeightGrids(
    training.flatMap((p) => (p.maxWeightGrams === null ? [] : [p.maxWeightGrams])),
  );
  const minGrids = discoverWeightGrids(
    training.flatMap((p) => (p.minWeightGrams === null ? [] : [p.minWeightGrams])),
  );
  const controls: number[] = [];
  for (const pair of training) {
    const max = pair.maxWeightGrams;
    const highs = weekly(input, pair).map((w) => Math.max(...w.weightsGrams));
    if (
      max !== null &&
      highs.length >= 3 &&
      Math.min(...highs) >= max * 0.98 &&
      Math.max(...highs) <= max &&
      Math.max(...highs) - Math.min(...highs) <= Math.max(2, max * 0.01)
    ) {
      controls.push(Math.max(...highs) / max);
    }
  }
  const floor = controls.length >= 20 ? Math.min(...controls) : null;
  const rows = input.pairs.map((pair) => {
    const weeks = weekly(input, pair);
    const clusters = repeatedClusters(weeks).sort(
      (a, b) => b.supportWeeks - a.supportWeeks || b.upper - a.upper,
    );
    const max = pair.maxWeightGrams;
    const normal =
      max === null ? undefined : clusters.find((c) => c.upper <= max && c.upper >= max * 0.98);
    const cluster = normal ?? clusters[0];
    const range: [number, number] | null =
      cluster && floor !== null ? [cluster.upper, Math.ceil(cluster.upper / floor)] : null;
    const peers = input.pairs.filter(
      (p) => p.fishId === pair.fishId && p.fishingBaseId !== pair.fishingBaseId,
    );
    const peerCandidates = [
      ...new Set(
        peers.flatMap((p) =>
          p.maxWeightGrams !== null &&
          range !== null &&
          p.maxWeightGrams >= range[0] &&
          p.maxWeightGrams <= range[1]
            ? [p.maxWeightGrams]
            : [],
        ),
      ),
    ];
    const grid =
      range === null
        ? undefined
        : grids.find((g) => g.magnitude === Math.floor(Math.log10(range[0])));
    const step = grid?.stepGrams;
    const point = range && step ? Math.ceil(range[0] / step) * step : null;
    const uniqueGrid =
      range && step && point !== null && point <= range[1] && point + step > range[1]
        ? point
        : null;
    const source = input.klevalka[weightPairKey(pair)];
    const klevalkaInference = inferKlevalkaOrdinaryMax({
      weightsGrams: source?.weightsGrams ?? [],
      locationNames: source?.locations ?? [],
      baitNames: source?.baits ?? [],
    });
    const candidate =
      klevalkaInference.confidence === 'HIGH'
        ? klevalkaInference.inferredMaxWeightGrams
        : peerCandidates.length === 1
          ? peerCandidates[0]
          : uniqueGrid;
    const ratioRow: OfficialMaxCandidate = {
      fishId: pair.fishId,
      fishingBaseId: pair.fishingBaseId,
      fishName: pair.fishName,
      baseName: pair.baseName,
      currentMaxGrams: max,
      weekly: weeks.map((w) => ({
        ...w,
        highestGrams: Math.max(...w.weightsGrams),
        ratiosToCurrentMax: max === null ? null : w.weightsGrams.map((v) => v / max),
      })),
      clusterWeightsGrams: cluster?.members ?? [],
      clusterWeeks: cluster?.supportWeeks ?? 0,
      proposedExactMaxGrams: null,
      candidateRangeGrams: range,
      observedBoundaryRangeGrams: range,
      catalogGridCandidateGrams: uniqueGrid,
      increaseAssessment: null,
      matchedRatioBands: [],
      confidence: 'LOW',
      classification: 'REVIEW',
      reason: '',
    };
    return {
      pair,
      weeks,
      cluster,
      range,
      candidate,
      normal: normal !== undefined,
      grid,
      peerCandidates,
      klevalkaInference,
      ratioRow,
    };
  });
  const ratios = analyzeOfficialRatios(
    rows.filter((r) => !excludedFish.has(r.pair.fishId)).map((r) => r.ratioRow),
  );
  return {
    rows: rows.map((r) => ({ ...r, mutantBands: matchMutantBands(r.ratioRow, ratios.bands) })),
    grids,
    minGrids,
    controls: controls.length,
    floor,
    ratios,
  };
}

/** Точность всегда измеряется до подстановки ручных значений; воздержание считается промахом. */
function benchmarkCases(
  cases: Array<{ reference: string; expected: number; predicted: number | null; small: boolean }>,
) {
  const summarize = (rows: typeof cases) => {
    const predicted = rows.filter((c) => c.predicted !== null).length;
    const exact = rows.filter((c) => c.predicted === c.expected).length;
    return {
      total: rows.length,
      predicted,
      exact,
      exactMatchAccuracy: rows.length ? exact / rows.length : null,
      predictionPrecision: predicted ? exact / predicted : null,
      coverage: rows.length ? predicted / rows.length : null,
    };
  };
  return { ...summarize(cases), smallWeight: summarize(cases.filter((c) => c.small)), cases };
}

/**
 * Строит полный отчёт и отдельные постоянные решения. Ручное подтверждение сильнее
 * модели, но конфликт двух ручных источников блокирует применение до разбора.
 */
export function reconcileWeights(input: ReconciliationInput) {
  const keys = new Set<string>();
  for (const pair of input.pairs) {
    const key = weightPairKey(pair);
    if (keys.has(key)) throw new Error(`Duplicate Fish/Base pair: ${key}`);
    keys.add(key);
    for (const weight of [pair.minWeightGrams, pair.maxWeightGrams]) {
      if (
        weight !== null &&
        (!Number.isSafeInteger(weight) || weight <= 0 || weight > 2147483647)
      ) {
        throw new Error(`Invalid integer catalog weight: ${key}`);
      }
    }
  }
  const manualPairs = REVIEW_CORRECTIONS.map((m) => ({
    m,
    matches: input.pairs.filter(
      (p) =>
        exactWeightName(p.fishName) === exactWeightName(m.fishName) &&
        exactWeightName(p.baseName) === exactWeightName(m.baseName),
    ),
  }));
  const benchmarkFish = new Set(input.issues.map((i) => i.fishId));
  for (const { matches } of manualPairs) for (const p of matches) benchmarkFish.add(p.fishId);
  for (const m of input.historicalCorrections)
    for (const p of input.pairs) {
      if (exactWeightName(p.fishName) === exactWeightName(m.fishName)) benchmarkFish.add(p.fishId);
    }
  // Убираем весь вид из обучающих сеток/режимов, сохраняя сырые официальные наблюдения.
  const inferred = inferAll(input, benchmarkFish);
  /** Для эталона восстанавливаем старый max, чтобы текущая уже принятая правка не подсказала ответ. */
  const benchmarkInference = (corrections: ManualCorrection[]) => {
    const pairs = input.pairs.map((p) => {
      const correction = corrections.find(
        (m) =>
          exactWeightName(p.fishName) === exactWeightName(m.fishName) &&
          exactWeightName(p.baseName) === exactWeightName(m.baseName),
      );
      return correction ? { ...p, maxWeightGrams: correction.oldMaxWeightGrams ?? null } : p;
    });
    return new Map(
      inferAll({ ...input, pairs }, benchmarkFish).rows.map((r) => [weightPairKey(r.pair), r]),
    );
  };
  const reviewInferred = benchmarkInference(REVIEW_CORRECTIONS);
  const historicalInferred = benchmarkInference(input.historicalCorrections);
  const reviewBenchmark = benchmarkCases(
    manualPairs.map(({ m, matches }) => ({
      reference: `${m.fishName}/${m.baseName}`,
      expected: m.proposedMaxWeightGrams,
      predicted:
        matches.length === 1 && !reviewInferred.get(weightPairKey(matches[0]))?.mutantBands.length
          ? (reviewInferred.get(weightPairKey(matches[0]))?.candidate ?? null)
          : null,
      small: Math.min(m.oldMaxWeightGrams ?? Infinity, m.proposedMaxWeightGrams) <= 5000,
    })),
  );
  const adminBenchmark = benchmarkCases(
    input.issues
      .filter((i) => i.expectedWeightGrams !== null)
      .map((i) => {
        const allRows = inferred.rows.filter((r) => r.pair.fishId === i.fishId);
        const noteRows = i.note
          ? allRows.filter((r) => exactWeightName(r.pair.baseName) === exactWeightName(i.note!))
          : [];
        const rows = noteRows.length === 1 ? noteRows : allRows;
        const predictions = rows.map((r) => (r.mutantBands.length ? null : r.candidate));
        // Для глобального max нельзя отбросить базу без вывода и занизить оценку рыбы.
        const predicted =
          rows.length > 0 && predictions.every((p) => p !== null) ? Math.max(...predictions) : null;
        return {
          reference: `FishWrongMaxIssue:${i.fishId}`,
          expected: i.expectedWeightGrams!,
          predicted,
          small: i.expectedWeightGrams! <= 5000,
        };
      }),
  );
  const historicalBenchmark = benchmarkCases(
    input.historicalCorrections.map((m) => {
      const matches = input.pairs.filter(
        (p) =>
          exactWeightName(p.fishName) === exactWeightName(m.fishName) &&
          exactWeightName(p.baseName) === exactWeightName(m.baseName),
      );
      return {
        reference: m.reference,
        expected: m.proposedMaxWeightGrams,
        predicted:
          matches.length === 1 &&
          !historicalInferred.get(weightPairKey(matches[0]))?.mutantBands.length
            ? (historicalInferred.get(weightPairKey(matches[0]))?.candidate ?? null)
            : null,
        small: m.proposedMaxWeightGrams <= 5000,
      };
    }),
  );
  // Низкая точность не маскируется ручными overrides. Порог относится к безопасности, не к игре.
  const inferenceTrusted =
    [reviewBenchmark, adminBenchmark, historicalBenchmark].every(
      (b) => b.total >= 5 && (b.exactMatchAccuracy ?? 0) >= 0.95 && (b.coverage ?? 0) >= 0.8,
    ) && (adminBenchmark.smallWeight.exactMatchAccuracy ?? 0) >= 0.95;
  const rows = inferred.rows.map((r) => {
    const p = r.pair;
    const manual = manualPairs.find(
      ({ matches }) => matches.length === 1 && weightPairKey(matches[0]) === weightPairKey(p),
    )?.m;
    const issue = input.issues.find((i) => i.fishId === p.fishId);
    const siblings = input.pairs.filter((v) => v.fishId === p.fishId);
    const explicitBases = issue?.note
      ? [
          ...new Set(
            siblings
              .filter((v) => exactWeightName(v.baseName) === exactWeightName(issue.note!))
              .map((v) => v.fishingBaseId),
          ),
        ]
      : [];
    const adminResolved =
      issue !== undefined &&
      (siblings.length === 1 ||
        (explicitBases.length === 1 && explicitBases[0] === p.fishingBaseId));
    const adminValue = adminResolved ? (issue?.expectedWeightGrams ?? null) : null;
    const manualValue = manual?.proposedMaxWeightGrams ?? null;
    const conflict = adminValue !== null && manualValue !== null && adminValue !== manualValue;
    const authoritative = conflict ? null : (adminValue ?? manualValue);
    const proposal = authoritative ?? (r.mutantBands.length ? null : r.candidate);
    const delta =
      proposal === null || p.maxWeightGrams === null ? null : proposal - p.maxWeightGrams;
    const ratio = delta === null || !p.maxWeightGrams ? null : delta / p.maxWeightGrams;
    const allObserved = [
      ...r.weeks.flatMap((w) => w.weightsGrams),
      ...(input.klevalka[weightPairKey(p)]?.weightsGrams ?? []),
    ];
    const belowMin =
      p.minWeightGrams === null ? [] : allObserved.filter((v) => v < p.minWeightGrams!);
    const workbook = input.workbook[weightPairKey(p)] ?? null;
    const minPeers = [
      ...new Set(
        siblings.filter((v) => v.fishingBaseId !== p.fishingBaseId).map((v) => v.minWeightGrams),
      ),
    ];
    const minMismatch = workbook !== null && workbook.min !== p.minWeightGrams;
    const small = Math.min(p.maxWeightGrams ?? Infinity, proposal ?? Infinity) <= 5000;
    const maxAnomaly =
      delta !== null &&
      delta !== 0 &&
      (authoritative !== null ||
        (r.mutantBands.length === 0 && !r.normal && (r.cluster?.supportWeeks ?? 0) >= 2));
    const globalAdminAnomaly =
      explicitBases.length === 0 &&
      issue?.expectedWeightGrams !== null &&
      issue !== undefined &&
      Math.max(...siblings.map((v) => v.maxWeightGrams ?? 0)) !== issue.expectedWeightGrams;
    const minAnomaly =
      belowMin.length > 0 ||
      minMismatch ||
      (p.minWeightGrams !== null &&
        p.maxWeightGrams !== null &&
        p.minWeightGrams > p.maxWeightGrams);
    let status: ReconciliationStatus = 'INSUFFICIENT';
    let reason = 'NO_INDEPENDENT_EXACT_BOUND_CONFIRMATION';
    let confidence = 'LOW';
    if (conflict) {
      status = 'CONFLICT';
      reason = 'MANUAL_AUTHORITIES_DISAGREE';
      confidence = 'HIGH';
    } else if (authoritative !== null) {
      status = authoritative === p.maxWeightGrams ? 'CONFIRMED' : 'SAFE_TO_CORRECT';
      reason =
        adminValue !== null
          ? 'ADMIN_EXACT_BASE_OR_SINGLE_MEMBERSHIP'
          : 'MANUALLY_CONFIRMED_EXACT_PAIR';
      confidence = 'HIGH';
      if (
        manual &&
        p.maxWeightGrams !== manual.oldMaxWeightGrams &&
        p.maxWeightGrams !== manual.proposedMaxWeightGrams
      ) {
        status = 'CONFLICT';
        reason = 'MANUAL_OLD_VALUE_DRIFT';
      }
    } else if (small && (maxAnomaly || minAnomaly || globalAdminAnomaly)) {
      status = 'LIKELY_WRONG_SMALL_WEIGHT';
      reason = globalAdminAnomaly
        ? 'ADMIN_GLOBAL_MAX_BASE_UNRESOLVED'
        : minAnomaly
          ? 'SMALL_MIN_REQUIRES_REVIEW'
          : 'SMALL_REPEATED_BOUNDARY_MISMATCH';
      confidence = 'MEDIUM';
    } else if (maxAnomaly || minAnomaly || globalAdminAnomaly) {
      status = 'STRONG_REVIEW';
      reason = globalAdminAnomaly
        ? 'ADMIN_GLOBAL_MAX_BASE_UNRESOLVED'
        : minAnomaly
          ? 'MIN_BOUND_SOURCE_OR_OBSERVATION_MISMATCH'
          : 'REPEATED_BOUNDARY_MISMATCH';
      confidence = 'MEDIUM';
      if (
        inferenceTrusted &&
        maxAnomaly &&
        r.klevalkaInference.confidence === 'HIGH' &&
        r.peerCandidates.includes(proposal!)
      ) {
        status = 'SAFE_TO_CORRECT';
        reason = 'BENCHMARK_PASSED_KLEVALKA_AND_PEER_AGREE';
        confidence = 'HIGH';
      }
    } else if (r.mutantBands.length) {
      status = 'STRONG_REVIEW';
      reason = 'POSSIBLE_MUTANT_REGIME_NO_NORMAL_CAP_DECISION';
    }
    return {
      ...p,
      status,
      confidence,
      reason,
      proposedMinWeightGrams: p.minWeightGrams,
      proposedMaxWeightGrams: status === 'CONFLICT' ? null : proposal,
      manuallyConfirmed: authoritative !== null && status !== 'CONFLICT',
      smallWeight: small,
      smallWeightAnomaly: small && (maxAnomaly || minAnomaly || globalAdminAnomaly),
      maxDeltaGrams: delta,
      maxRelativeDifference: ratio,
      minAssessment: {
        independentlyConfirmed: false,
        proposedChange: false,
        belowMinObservationsGrams: [...new Set(belowMin)].sort((a, b) => a - b),
        maximumShortfallGrams:
          belowMin.length && p.minWeightGrams !== null
            ? p.minWeightGrams - Math.min(...belowMin)
            : null,
        maximumRelativeShortfall:
          belowMin.length && p.minWeightGrams !== null
            ? (p.minWeightGrams - Math.min(...belowMin)) / p.minWeightGrams
            : null,
        workbookMismatch: minMismatch,
        discoveredGrid:
          inferred.minGrids.find(
            (g) =>
              p.minWeightGrams !== null && g.magnitude === Math.floor(Math.log10(p.minWeightGrams)),
          ) ?? null,
        otherBaseValuesGrams: minPeers,
        reason: minAnomaly
          ? 'REVIEW_MIN_NO_EXACT_REPLACEMENT'
          : 'NO_INDEPENDENT_MIN_BOUND_SOURCE;RETAIN_CURRENT',
      },
      maxAssessment: {
        independentlyConfirmed: authoritative !== null && status !== 'CONFLICT',
        inferredCandidateGrams: r.candidate,
        inferenceRule:
          r.klevalkaInference.confidence === 'HIGH'
            ? 'KLEVALKA_DENSE_BOUNDARY'
            : r.peerCandidates.length === 1
              ? 'UNIQUE_SAME_FISH_PEER_IN_OBSERVED_RANGE'
              : r.candidate !== null
                ? 'UNIQUE_DISCOVERED_GRID_POINT_IN_OBSERVED_RANGE'
                : 'NO_UNIQUE_EXACT_CANDIDATE',
        observedRangeGrams: r.range,
        normalClusterNearCurrent: r.normal,
        mutantBands: r.mutantBands,
        clusterWeeks: r.cluster?.supportWeeks ?? 0,
        grid: r.grid ?? null,
      },
      evidence: {
        admin: issue ?? null,
        adminBaseResolved: adminResolved,
        manual: manual ?? null,
        klevalka: input.klevalka[weightPairKey(p)] ?? null,
        klevalkaInference: r.klevalkaInference,
        officialWeeks: r.weeks,
        officialReference: 'captured-input:official.observations',
        officialObservations: input.official.observations.filter(
          (o) => o.fishId === p.fishId && o.fishingBaseId === p.fishingBaseId,
        ),
        workbook,
        sameFishOtherBases: siblings
          .filter((v) => v.fishingBaseId !== p.fishingBaseId)
          .map((v) => ({
            fishingBaseId: v.fishingBaseId,
            baseName: v.baseName,
            minWeightGrams: v.minWeightGrams,
            maxWeightGrams: v.maxWeightGrams,
          })),
        provenanceNote:
          'Workbook, catalog peers and grids share catalog provenance; they are not independent sources.',
      },
    };
  });
  rows.sort(
    (a, b) =>
      Number(b.smallWeightAnomaly) - Number(a.smallWeightAnomaly) ||
      Number(b.status === 'SAFE_TO_CORRECT') - Number(a.status === 'SAFE_TO_CORRECT') ||
      Number(b.manuallyConfirmed) - Number(a.manuallyConfirmed) ||
      Math.abs(b.maxRelativeDifference ?? 0) - Math.abs(a.maxRelativeDifference ?? 0) ||
      Math.abs(b.maxDeltaGrams ?? 0) - Math.abs(a.maxDeltaGrams ?? 0) ||
      weightPairKey(a).localeCompare(weightPairKey(b)),
  );
  const counts = Object.fromEntries(
    (
      [
        'CONFIRMED',
        'SAFE_TO_CORRECT',
        'LIKELY_WRONG_SMALL_WEIGHT',
        'STRONG_REVIEW',
        'CONFLICT',
        'INSUFFICIENT',
      ] as const
    ).map((s) => [s, rows.filter((r) => r.status === s).length]),
  );
  const unmatchedManual = manualPairs
    .filter(({ matches }) => matches.length !== 1)
    .map(({ m, matches }) => ({
      ...m,
      status: 'REVIEW',
      reason: `EXACT_MAPPING_COUNT_${matches.length}`,
    }));
  const decisions = rows
    .filter(
      (r) =>
        r.manuallyConfirmed ||
        r.status === 'CONFLICT' ||
        (r.status !== 'INSUFFICIENT' &&
          (r.minAssessment.maximumShortfallGrams !== null ||
            r.minAssessment.workbookMismatch ||
            r.evidence.admin !== null ||
            (r.proposedMaxWeightGrams !== null &&
              r.maxDeltaGrams !== 0 &&
              r.maxDeltaGrams !== null))),
    )
    .map((r) => ({
      fishId: r.fishId,
      fishName: r.fishName,
      fishingBaseId: r.fishingBaseId,
      baseName: r.baseName,
      oldMinWeightGrams: r.minWeightGrams,
      oldMaxWeightGrams: r.maxWeightGrams,
      proposedMinWeightGrams: r.proposedMinWeightGrams,
      proposedMaxWeightGrams: r.proposedMaxWeightGrams,
      status: r.status,
      confidence: r.confidence,
      manuallyConfirmed: r.manuallyConfirmed,
      appliedToTxt: false,
      appliedToCatalog: false,
      appliedToCatches: false,
      reason: r.reason,
      boundDecisions: {
        min: 'RETAIN_UNCONFIRMED',
        max:
          r.status === 'SAFE_TO_CORRECT'
            ? 'CORRECT'
            : r.status === 'CONFIRMED'
              ? 'KEEP_CONFIRMED'
              : 'HOLD_FOR_REVIEW',
      },
      evidence: {
        references: [
          r.evidence.manual?.reference,
          r.evidence.admin ? `FishWrongMaxIssue:${r.fishId}@${r.evidence.admin.updatedAt}` : null,
          r.evidence.officialWeeks.length
            ? `captured-input:official.observations:${weightPairKey(r)}`
            : null,
          ...(r.evidence.klevalka?.references ?? []),
          ...(r.evidence.workbook?.references ?? []),
        ].filter((v) => v !== null && v !== undefined),
        adminCorrection: r.evidence.admin,
        manualCorrection: r.evidence.manual,
        officialObservations: r.evidence.officialObservations,
        klevalkaReferences: r.evidence.klevalka?.references ?? [],
        workbookBounds: r.evidence.workbook,
        sameFishOtherBaseBounds: r.evidence.sameFishOtherBases,
      },
      notes: `${r.reason}; MIN_RETAINED_WITHOUT_INDEPENDENT_CONFIRMATION; ${r.manuallyConfirmed ? 'manual decision' : 'review hypothesis; do not apply'}; TXT_SOURCE_MAPPING_PENDING`,
    }));
  return {
    schemaVersion: 1,
    analyzerVersion: 'weight-reconciliation-v1',
    policy: {
      readOnly: true,
      catchReportsRead: false,
      presetGridMultipliers: false,
      smallWeightThresholdGrams: 5000,
      smallAbsoluteResolutionGrams: 1,
      confirmedScope:
        'CONFIRMED refers to explicitly confirmed max only; minAssessment remains separate.',
      inferenceTrusted,
      statisticalSafeGate:
        'review/admin/historical exact accuracy >=95%, coverage >=80%, small admin accuracy >=95%',
      minLimitation:
        'Weekly records are upper-tail observations, never proof of a minimum. Workbook agreement is provenance only.',
    },
    counts,
    totalPairs: rows.length,
    smallWeight: {
      pairs: rows.filter((r) => r.smallWeight).length,
      anomalies: rows.filter((r) => r.smallWeightAnomaly).length,
      minAnomalies: rows.filter(
        (r) =>
          r.smallWeight &&
          (r.minAssessment.workbookMismatch || r.minAssessment.belowMinObservationsGrams.length),
      ).length,
      maxAnomalies: rows.filter(
        (r) => r.smallWeightAnomaly && r.maxDeltaGrams !== null && r.maxDeltaGrams !== 0,
      ).length,
      adminBaseUnresolvedAnomalies: rows.filter(
        (r) => r.smallWeightAnomaly && r.reason === 'ADMIN_GLOBAL_MAX_BASE_UNRESOLVED',
      ).length,
    },
    benchmark: { review: reviewBenchmark, admin: adminBenchmark, historical: historicalBenchmark },
    calibration: {
      controls: inferred.controls,
      boundaryRatioFloor: inferred.floor,
      excludedBenchmarkFish: benchmarkFish.size,
    },
    grids: { min: inferred.minGrids, max: inferred.grids },
    mutantRegimes: inferred.ratios,
    sources: input.sources,
    mappingReviews: [...input.mappingReviews, ...unmatchedManual],
    rows,
    decisions,
  };
}
