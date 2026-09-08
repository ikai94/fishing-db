export type KlevalkaMaxWeightConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_SOURCE';

export interface KlevalkaMaxWeightEvidence {
  weightsGrams: readonly number[];
  locationNames: readonly string[];
  baitNames: readonly string[];
}

export interface KlevalkaMaxWeightInference {
  inferredMaxWeightGrams: number | null;
  sourceRows: number;
  nearBoundaryCount: number | null;
  aboveBoundaryMutantTailCount: number | null;
  locationDiversity: number;
  baitDiversity: number;
  confidence: KlevalkaMaxWeightConfidence;
  reason: string;
}

export interface KlevalkaMaxWeightAuditRow extends KlevalkaMaxWeightInference {
  fishingBaseName: string;
  fishName: string;
  databaseMaxWeightGrams: number | null;
  deltaGrams: number | null;
  ratio: number | null;
}

interface BoundaryCandidate {
  boundary: number;
  observedClusterEdge: number;
  nearBoundaryCount: number;
  aboveBoundaryCount: number;
  gapAfterBoundary: number;
  gapRatio: number;
  densityRatio: number;
  clusterToTailRatio: number;
  roundness: number;
  score: number;
}

const MIN_SOURCE_ROWS_FOR_INFERENCE = 40;

function normalizeEvidenceLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 1;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function roundness(value: number): number {
  for (const [divisor, score] of [
    [100_000, 5],
    [10_000, 4.5],
    [1_000, 4],
    [500, 3.5],
    [100, 3],
    [50, 2.5],
    [10, 2],
    [5, 1],
  ] as const) {
    if (value % divisor === 0) return score;
  }
  return 0;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function naturalBoundary(clusterEdge: number, nextWeight: number, maximum: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(clusterEdge));
  const maximumShift = Math.max(2, clusterEdge * 0.002);
  const steps = [magnitude, magnitude / 2, magnitude / 10, magnitude / 20, magnitude / 100]
    .map((step) => Math.round(step))
    .filter((step, index, values) => step >= 1 && values.indexOf(step) === index);
  for (const step of steps) {
    const roundedBoundary = Math.round(clusterEdge / step) * step;
    const shift = Math.abs(roundedBoundary - clusterEdge);
    if (
      shift <= maximumShift &&
      roundedBoundary > 0 &&
      roundedBoundary < maximum &&
      (roundedBoundary <= clusterEdge || roundedBoundary < nextWeight)
    ) {
      return roundedBoundary;
    }
  }
  return clusterEdge;
}

function boundaryCandidates(sortedWeights: readonly number[]): BoundaryCandidate[] {
  const uniqueWeights = [...new Set(sortedWeights)];
  const maximum = uniqueWeights.at(-1);
  if (maximum === undefined || uniqueWeights.length < 12) return [];

  const candidates: BoundaryCandidate[] = [];
  for (let index = 1; index < uniqueWeights.length - 1; index += 1) {
    const clusterEdge = uniqueWeights[index];
    const next = uniqueWeights[index + 1];
    if (clusterEdge === undefined || next === undefined || clusterEdge < 1) continue;

    const throughClusterEdge = upperBound(sortedWeights, clusterEdge);
    const rawTailCount = sortedWeights.length - throughClusterEdge;
    const rawTailFraction = rawTailCount / sortedWeights.length;
    if (throughClusterEdge / sortedWeights.length < 0.75 || rawTailFraction > 0.12) continue;

    const clusterWindow = Math.max(5, Math.round(clusterEdge * 0.01));
    const clusterStart = lowerBound(sortedWeights, Math.max(0, clusterEdge - clusterWindow));
    const rawNearCount = throughClusterEdge - clusterStart;
    if (rawNearCount < 8 || rawTailCount < 1) continue;

    const previousGaps: number[] = [];
    const previousStart = Math.max(0, index - 40);
    for (let gapIndex = previousStart; gapIndex < index; gapIndex += 1) {
      const left = uniqueWeights[gapIndex];
      const right = uniqueWeights[gapIndex + 1];
      if (left !== undefined && right !== undefined && left >= clusterEdge - clusterWindow) {
        previousGaps.push(right - left);
      }
    }
    const gapAfterBoundary = next - clusterEdge;
    const gapRatio = gapAfterBoundary / Math.max(1, median(previousGaps));
    const tailSpan = Math.max(1, maximum - clusterEdge);
    const nearDensity = rawNearCount / clusterWindow;
    const tailDensity = rawTailCount / tailSpan;
    const densityRatio = nearDensity / Math.max(Number.EPSILON, tailDensity);
    const clusterToTailRatio = rawNearCount / rawTailCount;
    const relativeGap = gapAfterBoundary / clusterEdge;
    if (gapRatio < 4 || densityRatio < 4 || clusterToTailRatio < 1.5 || relativeGap < 0.0005) {
      continue;
    }

    const boundary = naturalBoundary(clusterEdge, next, maximum);
    const throughBoundary = upperBound(sortedWeights, boundary);
    const aboveBoundaryCount = sortedWeights.length - throughBoundary;
    const nearWindow = Math.max(5, Math.round(boundary * 0.01));
    const nearStart = lowerBound(sortedWeights, Math.max(0, boundary - nearWindow));
    const nearBoundaryCount = throughBoundary - nearStart;
    const naturalBoundaryScore = roundness(boundary);
    const score =
      Math.log2(gapRatio) * 2 +
      Math.log2(densityRatio) +
      Math.log2(clusterToTailRatio) +
      Math.log2(rawNearCount) * 0.75 +
      naturalBoundaryScore * 0.65 -
      rawTailFraction * 10;
    candidates.push({
      boundary,
      observedClusterEdge: clusterEdge,
      nearBoundaryCount,
      aboveBoundaryCount,
      gapAfterBoundary,
      gapRatio,
      densityRatio,
      clusterToTailRatio,
      roundness: naturalBoundaryScore,
      score,
    });
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.roundness - left.roundness ||
      left.boundary - right.boundary,
  );
}

function diversity(values: readonly string[]): number {
  return new Set(values.map(normalizeEvidenceLabel).filter((value) => value.length > 0)).size;
}

function rounded(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function inferKlevalkaOrdinaryMax(
  evidence: KlevalkaMaxWeightEvidence,
): KlevalkaMaxWeightInference {
  const weights = evidence.weightsGrams.filter(
    (weight) => Number.isSafeInteger(weight) && weight >= 0,
  );
  const sourceRows = weights.length;
  const locationDiversity = diversity(evidence.locationNames);
  const baitDiversity = diversity(evidence.baitNames);
  if (sourceRows === 0) {
    return {
      inferredMaxWeightGrams: null,
      sourceRows,
      nearBoundaryCount: null,
      aboveBoundaryMutantTailCount: null,
      locationDiversity,
      baitDiversity,
      confidence: 'NO_SOURCE',
      reason: 'No matching rows in the frozen Klevalka snapshots.',
    };
  }
  if (sourceRows < MIN_SOURCE_ROWS_FOR_INFERENCE) {
    return {
      inferredMaxWeightGrams: null,
      sourceRows,
      nearBoundaryCount: null,
      aboveBoundaryMutantTailCount: null,
      locationDiversity,
      baitDiversity,
      confidence: 'LOW',
      reason: `Only ${sourceRows} source rows; sparse evidence is not inferred.`,
    };
  }

  const sortedWeights = [...weights].sort((left, right) => left - right);
  const candidates = boundaryCandidates(sortedWeights);
  const candidate = candidates[0];
  if (candidate === undefined) {
    return {
      inferredMaxWeightGrams: null,
      sourceRows,
      nearBoundaryCount: null,
      aboveBoundaryMutantTailCount: null,
      locationDiversity,
      baitDiversity,
      confidence: 'LOW',
      reason: `No dense upper cluster followed by a clear sparse tail in ${sourceRows} source rows.`,
    };
  }

  const runnerUp = candidates[1];
  const scoreMargin =
    runnerUp === undefined ? Number.POSITIVE_INFINITY : candidate.score - runnerUp.score;
  const tailFraction = candidate.aboveBoundaryCount / sourceRows;
  const highEvidence =
    sourceRows >= 80 &&
    candidate.nearBoundaryCount >= 20 &&
    candidate.aboveBoundaryCount >= 2 &&
    tailFraction <= 0.08 &&
    candidate.gapRatio >= 8 &&
    candidate.densityRatio >= 8 &&
    candidate.clusterToTailRatio >= 3 &&
    locationDiversity >= 2 &&
    baitDiversity >= 3 &&
    scoreMargin >= 1.5;
  const mediumEvidence =
    candidate.nearBoundaryCount >= 10 &&
    candidate.aboveBoundaryCount >= 2 &&
    tailFraction <= 0.1 &&
    candidate.gapRatio >= 6 &&
    candidate.densityRatio >= 5 &&
    locationDiversity >= 1 &&
    baitDiversity >= 2 &&
    scoreMargin >= 0.5;
  const confidence: KlevalkaMaxWeightConfidence = highEvidence
    ? 'HIGH'
    : mediumEvidence
      ? 'MEDIUM'
      : 'LOW';
  const reason = [
    `${candidate.nearBoundaryCount} rows in the upper 1% through ${candidate.boundary} g`,
    candidate.observedClusterEdge === candidate.boundary
      ? `${candidate.aboveBoundaryCount} rows above after a ${candidate.gapAfterBoundary} g gap`
      : `${candidate.aboveBoundaryCount} rows above; observed cluster edge ${candidate.observedClusterEdge} g precedes a ${candidate.gapAfterBoundary} g gap`,
    `gap ${rounded(candidate.gapRatio)}x local spacing`,
    `${locationDiversity} Locations and ${baitDiversity} Baits`,
    candidate.roundness > 0 ? 'natural boundary favored' : 'non-round boundary',
    scoreMargin < 1.5 ? 'competing upper break reduces confidence' : 'clear best upper break',
  ].join('; ');

  return {
    inferredMaxWeightGrams: candidate.boundary,
    sourceRows,
    nearBoundaryCount: candidate.nearBoundaryCount,
    aboveBoundaryMutantTailCount: candidate.aboveBoundaryCount,
    locationDiversity,
    baitDiversity,
    confidence,
    reason: `${reason}.`,
  };
}

function tsvCell(value: string | number | null): string {
  if (value === null) return '';
  return String(value).replace(/[\t\r\n]+/gu, ' ');
}

export function klevalkaMaxWeightAuditTsv(rows: readonly KlevalkaMaxWeightAuditRow[]): string {
  const header = [
    'Base',
    'Fish',
    'DB max',
    'inferred max',
    'delta',
    'ratio',
    'source rows',
    'near-boundary count',
    'above-boundary mutant-tail count',
    'Location diversity',
    'Bait diversity',
    'confidence',
    'reason',
  ];
  const lines = rows.map((row) =>
    [
      row.fishingBaseName,
      row.fishName,
      row.databaseMaxWeightGrams,
      row.inferredMaxWeightGrams,
      row.deltaGrams,
      row.ratio === null ? null : row.ratio.toFixed(6),
      row.sourceRows,
      row.nearBoundaryCount,
      row.aboveBoundaryMutantTailCount,
      row.locationDiversity,
      row.baitDiversity,
      row.confidence,
      row.reason,
    ]
      .map(tsvCell)
      .join('\t'),
  );
  return `${[header.join('\t'), ...lines].join('\n')}\n`;
}
