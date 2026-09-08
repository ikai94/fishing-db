import type { KlevalkaMaxWeightEvidence } from './klevalka-max-weight-audit.js';

export type KlevalkaMaxWeightRefinementConfidence = 'HIGH' | 'UNKNOWN';

export interface KlevalkaMaxWeightRefinementInput {
  databaseMaxWeightGrams: number;
  previousInferredMaxWeightGrams: number;
  evidence: KlevalkaMaxWeightEvidence;
}

export interface KlevalkaMaxWeightRefinement {
  refinedCandidateGrams: number | null;
  sourceRows: number;
  nearBelowCount: number | null;
  aboveTailCount: number | null;
  locationDiversity: number;
  baitDiversity: number;
  confidence: KlevalkaMaxWeightRefinementConfidence;
  reason: string;
}

interface RoundedCandidateEvidence {
  boundary: number;
  nearBelowCount: number;
  aboveTailCount: number;
  gapAbove: number;
  gapRatio: number;
  densityRatio: number;
  clusterToTailRatio: number;
  roundness: number;
  score: number;
}

function normalizeEvidenceLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{White_Space}+/gu, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
}

function diversity(values: readonly string[]): number {
  return new Set(values.map(normalizeEvidenceLabel).filter((value) => value.length > 0)).size;
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

function median(values: number[]): number {
  if (values.length === 0) return 1;
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  const upper = values[middle] ?? 1;
  return values.length % 2 === 1 ? upper : ((values[middle - 1] ?? upper) + upper) / 2;
}

function boundaryRoundness(value: number): number {
  for (const [divisor, score] of [
    [1_000_000, 8],
    [500_000, 7.5],
    [100_000, 7],
    [50_000, 6.5],
    [10_000, 6],
    [5_000, 5.5],
    [1_000, 5],
    [500, 4.5],
    [100, 4],
    [50, 3.5],
    [10, 3],
    [5, 2],
  ] as const) {
    if (value % divisor === 0) return score;
  }
  return 0;
}

function minimumNaturalStep(value: number): number {
  return Math.max(5, Math.round(5 * 10 ** (Math.floor(Math.log10(value)) - 3)));
}

function nearbyRoundedBoundaries(previous: number): number[] {
  const maximumDistance = Math.max(5, Math.round(previous * 0.005));
  const minimum = Math.max(1, previous - maximumDistance);
  const maximum = previous + maximumDistance;
  const magnitudeExponent = Math.floor(Math.log10(previous));
  const steps = new Set<number>();
  for (let exponent = -1; exponent <= magnitudeExponent; exponent += 1) {
    const power = 10 ** exponent;
    for (const multiplier of [1, 2, 2.5, 5]) {
      const step = Math.round(multiplier * power);
      if (step >= 1) steps.add(step);
    }
  }

  const candidates = new Set<number>();
  for (const step of steps) {
    for (const multiple of [Math.floor(previous / step), Math.ceil(previous / step)]) {
      const candidate = multiple * step;
      if (
        Number.isSafeInteger(candidate) &&
        candidate >= minimum &&
        candidate <= maximum &&
        candidate % minimumNaturalStep(candidate) === 0 &&
        boundaryRoundness(candidate) > 0
      ) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates].sort((left, right) => left - right);
}

function assessCandidate(
  sortedWeights: readonly number[],
  candidate: number,
  previous: number,
): RoundedCandidateEvidence | null {
  const sourceMaximum = sortedWeights.at(-1);
  if (sourceMaximum === undefined || candidate >= sourceMaximum) return null;
  const throughBoundary = upperBound(sortedWeights, candidate);
  const aboveTailCount = sortedWeights.length - throughBoundary;
  if (throughBoundary === 0 || aboveTailCount < 2) return null;

  const nearWindow = Math.max(5, Math.round(candidate * 0.01));
  const nearStart = lowerBound(sortedWeights, Math.max(0, candidate - nearWindow));
  const nearBelowCount = throughBoundary - nearStart;
  const firstAbove = sortedWeights[throughBoundary];
  if (firstAbove === undefined) return null;

  const uniqueNear = [
    ...new Set(
      sortedWeights.slice(nearStart, throughBoundary).filter((weight) => weight <= candidate),
    ),
  ];
  const localGaps: number[] = [];
  for (let index = 1; index < uniqueNear.length; index += 1) {
    const left = uniqueNear[index - 1];
    const right = uniqueNear[index];
    if (left !== undefined && right !== undefined) localGaps.push(right - left);
  }
  const gapAbove = firstAbove - candidate;
  const gapRatio = gapAbove / Math.max(1, median(localGaps.slice(-40)));
  const tailSpan = Math.max(1, sourceMaximum - candidate);
  const nearDensity = nearBelowCount / nearWindow;
  const tailDensity = aboveTailCount / tailSpan;
  const densityRatio = nearDensity / Math.max(Number.EPSILON, tailDensity);
  const clusterToTailRatio = nearBelowCount / aboveTailCount;
  const tailFraction = aboveTailCount / sortedWeights.length;
  if (
    nearBelowCount < 20 ||
    tailFraction > 0.08 ||
    gapRatio < 8 ||
    densityRatio < 8 ||
    clusterToTailRatio < 3
  ) {
    return null;
  }

  const roundness = boundaryRoundness(candidate);
  const distancePenalty = (Math.abs(candidate - previous) / previous) * 100;
  const score =
    Math.log2(gapRatio) * 2 +
    Math.log2(densityRatio) +
    Math.log2(clusterToTailRatio) +
    Math.log2(nearBelowCount) * 0.75 +
    roundness * 0.8 -
    distancePenalty;
  return {
    boundary: candidate,
    nearBelowCount,
    aboveTailCount,
    gapAbove,
    gapRatio,
    densityRatio,
    clusterToTailRatio,
    roundness,
    score,
  };
}

function rounded(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function refineKlevalkaOrdinaryMax(
  input: KlevalkaMaxWeightRefinementInput,
): KlevalkaMaxWeightRefinement {
  const weights = input.evidence.weightsGrams
    .filter((weight) => Number.isSafeInteger(weight) && weight >= 0)
    .sort((left, right) => left - right);
  const sourceRows = weights.length;
  const locationDiversity = diversity(input.evidence.locationNames);
  const baitDiversity = diversity(input.evidence.baitNames);
  const unknown = (reason: string): KlevalkaMaxWeightRefinement => ({
    refinedCandidateGrams: null,
    sourceRows,
    nearBelowCount: null,
    aboveTailCount: null,
    locationDiversity,
    baitDiversity,
    confidence: 'UNKNOWN',
    reason,
  });

  if (sourceRows < 80)
    return unknown(`Only ${sourceRows} source rows; rounded boundary is uncertain.`);
  if (locationDiversity < 2 || baitDiversity < 3) {
    return unknown('Insufficient Location/Bait diversity for a confirmed rounded boundary.');
  }

  const candidates = nearbyRoundedBoundaries(input.previousInferredMaxWeightGrams)
    .map((candidate) => assessCandidate(weights, candidate, input.previousInferredMaxWeightGrams))
    .filter((candidate): candidate is RoundedCandidateEvidence => candidate !== null)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.roundness - left.roundness ||
        Math.abs(left.boundary - input.previousInferredMaxWeightGrams) -
          Math.abs(right.boundary - input.previousInferredMaxWeightGrams) ||
        left.boundary - right.boundary,
    );
  const candidate = candidates[0];
  if (candidate === undefined) {
    return unknown(
      'No nearby rounded value has a dense below-boundary cluster and sparse separated tail.',
    );
  }
  if (candidate.boundary >= input.databaseMaxWeightGrams) {
    return unknown(
      'The supported rounded boundary does not confirm that the DB maximum is overstated.',
    );
  }

  return {
    refinedCandidateGrams: candidate.boundary,
    sourceRows,
    nearBelowCount: candidate.nearBelowCount,
    aboveTailCount: candidate.aboveTailCount,
    locationDiversity,
    baitDiversity,
    confidence: 'HIGH',
    reason: `${candidate.nearBelowCount} rows immediately below; ${candidate.aboveTailCount} above after a ${candidate.gapAbove} g gap (${rounded(candidate.gapRatio)}x local spacing); density contrast ${rounded(candidate.densityRatio)}x across ${locationDiversity} Locations and ${baitDiversity} Baits.`,
  };
}
