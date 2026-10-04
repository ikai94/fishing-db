import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeOfficialMax, type OfficialMaxInput } from './official-max-analysis.js';

/** Контрольные пары задают известную границу, не подменяя реальный источник CatchReport. */
function fixture(weights: number[][], current = 9900): OfficialMaxInput {
  const input: OfficialMaxInput = { snapshots: [], observations: [], pairs: [] };
  for (let week = 0; week < weights.length; week++) {
    input.snapshots.push({
      id: `s${week}`,
      weekStartsAt: `week${week}`,
      fetchedAt: `fetch${week}`,
    });
  }
  for (let pair = 0; pair <= 20; pair++) {
    const fishId = `fish${pair}`;
    input.pairs.push({
      fishId,
      fishingBaseId: 'base',
      fishName: fishId,
      baseName: 'Base',
      maxWeightGrams: pair === 0 ? current : 11000,
    });
    const pairWeights = pair === 0 ? weights : [[10950], [10970], [10990]];
    pairWeights.forEach((values, week) =>
      values.forEach((weightGrams, index) =>
        input.observations.push({
          fishId,
          fishingBaseId: 'base',
          weekStartsAt: `week${week}`,
          weightGrams,
          waterbodyRaw: 'Base',
          caughtAt: `${week}:${index}`,
          copies: 100,
        }),
      ),
    );
  }
  return input;
}

/** Возвращает исследуемую пару без зависимости от ранжирования контрольных данных. */
function target(input: OfficialMaxInput) {
  return analyzeOfficialMax(input).candidates.find((row) => row.fishId === 'fish0')!;
}

void test('one over-max mutant week and any number of snapshot copies cannot justify correction', () => {
  const input = fixture([[10990]]);
  assert.equal(target(input).classification, 'REVIEW');
  input.observations = input.observations.map((o) => ({ ...o, copies: 100000 }));
  assert.equal(target(input).classification, 'REVIEW');
});

void test('normal repeated lower cluster protects against isolated and repeated higher mutants', () => {
  const row = target(
    fixture([
      [9880, 15000],
      [9890, 15005],
      [9900, 15010],
    ]),
  );
  assert.equal(row.classification, 'OK');
  assert.equal(row.proposedExactMaxGrams, null);
});

void test('three independent weeks infer a supported exact normal boundary, not the absolute record', () => {
  const row = target(fixture([[10950], [10970], [10990, 14000]]));
  assert.equal(row.classification, 'MAX_TOO_LOW');
  assert.equal(row.confidence, 'HIGH');
  assert.equal(row.proposedExactMaxGrams, 11000);
  assert.equal(row.increaseAssessment, 'NORMAL_CAP_MISMATCH');
  assert.ok(row.weekly[2].weightsGrams.includes(14000));
});

void test('two weeks yield a range and three equal rounded weights do not claim HIGH', () => {
  assert.equal(target(fixture([[10970], [10990]])).confidence, 'MEDIUM');
  assert.equal(target(fixture([[11000], [11000], [11000]])).confidence, 'MEDIUM');
  assert.equal(target(fixture([[11000], [11000], [11000]])).proposedExactMaxGrams, null);
});

void test('stable lower boundary is tentative; dispersed low weights never prove max too high', () => {
  assert.equal(target(fixture([[2740], [2745], [2750]], 3300)).classification, 'MAX_TOO_HIGH');
  assert.equal(target(fixture([[2740], [2745], [2750]], 3300)).confidence, 'MEDIUM');
  assert.equal(target(fixture([[100], [1000], [2000]])).classification, 'REVIEW');
});

void test('empty history, null max and missing membership stay explicit', () => {
  const input = fixture([[10950], [10970], [10990]]);
  input.pairs[0].maxWeightGrams = null;
  assert.equal(target(input).classification, 'REVIEW');
  input.pairs.shift();
  assert.equal(analyzeOfficialMax(input).counts.missingMembershipPairs, 1);
  assert.deepEqual(
    analyzeOfficialMax({ snapshots: [], observations: [], pairs: [] }).counts.classifications,
    { OK: 0, MAX_TOO_LOW: 0, MAX_TOO_HIGH: 0, REVIEW: 0 },
  );
});

void test('analysis is deterministic after evidence permutation and keeps Base scope', () => {
  const input = fixture([[10950], [10970], [10990]]);
  const before = analyzeOfficialMax(input);
  input.observations.reverse();
  input.pairs.reverse();
  assert.deepEqual(analyzeOfficialMax(input), before);
  input.observations.push({
    ...input.observations[0],
    fishId: 'fish0',
    fishingBaseId: 'another-base',
    weightGrams: 15000,
  });
  assert.equal(target(input).proposedExactMaxGrams, 11000);
  const otherBase = analyzeOfficialMax(input).candidates.find(
    (row) => row.fishingBaseId === 'another-base',
  )!;
  assert.equal(otherBase.classification, 'REVIEW');
  assert.equal(otherBase.weekly.length, 1);
});

/** Независимые виды и базы проверяют полосы без заранее заданных множителей. */
function addPair(
  input: OfficialMaxInput,
  fishId: string,
  baseId: string,
  weights: number[][],
  current = 11000,
) {
  input.pairs.push({
    fishId,
    fishingBaseId: baseId,
    fishName: fishId,
    baseName: baseId,
    maxWeightGrams: current,
  });
  weights.forEach((values, week) =>
    values.forEach((weightGrams, index) =>
      input.observations.push({
        fishId,
        fishingBaseId: baseId,
        weekStartsAt: `week${week}`,
        weightGrams,
        waterbodyRaw: baseId,
        caughtAt: `${week}:${index}`,
        copies: 100,
      }),
    ),
  );
}

void test('ratio controls retain above-max records and discover a non-preset multiplier', () => {
  const input = fixture([[11590], [11595], [11600]], 10000);
  for (let fish = 0; fish < 5; fish++)
    addPair(input, `mutant-control${fish}`, `base${fish % 3}`, [
      [10950, 12750],
      [10970, 12755],
      [10990, 12760],
    ]);
  const result = analyzeOfficialMax(input);
  assert.equal(result.ratioAnalysis.counts.controlPairs, 25);
  assert.equal(result.ratioAnalysis.counts.controlPairsWithAboveMax, 5);
  assert.equal(result.ratioAnalysis.counts.controlAboveMaxWeeklyWeights, 15);
  assert.ok(
    result.ratioAnalysis.bands.some(
      (band) =>
        band.lowerRatio < 1.16 &&
        band.upperRatio > 1.16 &&
        band.support === 'CONTROL_SUPPORTED_REGIME',
    ),
  );
  const row = target(input);
  assert.equal(row.increaseAssessment, 'POSSIBLE_MUTANT_CAP');
  assert.equal(row.classification, 'REVIEW');
  assert.equal(row.proposedExactMaxGrams, null);
  assert.equal(row.candidateRangeGrams, null);
  assert.deepEqual(row.weekly[0].ratiosToCurrentMax, [1.159]);
});

void test('two unrelated recurring Fish block a grid-supported exact increase without proving a multiplier', () => {
  const input = fixture([[10950], [10970], [10990]]);
  addPair(input, 'other-fish', 'other-base', [[9954], [9972], [9990]], 9000);
  const result = analyzeOfficialMax(input);
  const band = result.ratioAnalysis.bands.find(
    (b) => b.support === 'UNANCHORED_POSSIBLE_MUTANT_BAND',
  )!;
  assert.equal(band.controlPairs, 0);
  assert.equal(band.repeatedPairs, 2);
  assert.equal(target(input).increaseAssessment, 'POSSIBLE_MUTANT_CAP');
  assert.equal(target(input).proposedExactMaxGrams, null);
  assert.equal(target(input).classification, 'REVIEW');
});

void test('one species across multiple Bases or another species in only one week cannot invent a regime', () => {
  const input = fixture([[10950], [10970], [10990]]);
  addPair(input, 'fish0', 'other-base', [[10950], [10970], [10990]], 9900);
  assert.equal(target(input).proposedExactMaxGrams, 11000);
  addPair(input, 'single-week-fish', 'third-base', [[10950]], 9900);
  assert.equal(target(input).increaseAssessment, 'NORMAL_CAP_MISMATCH');
  assert.equal(target(input).proposedExactMaxGrams, 11000);
});

void test('a supported regime explains a single over-max week mixed into a repeated boundary cluster', () => {
  const input = fixture([[11010], [10950], [10000]], 11000);
  for (let fish = 0; fish < 5; fish++)
    addPair(input, `rounding-control${fish}`, `base${fish % 3}`, [
      [10990, 11010],
      [10990, 11010],
      [10990, 11010],
    ]);
  assert.equal(target(input).classification, 'REVIEW');
  assert.equal(target(input).increaseAssessment, 'POSSIBLE_MUTANT_CAP');
  assert.equal(target(input).proposedExactMaxGrams, null);
});
