import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferKlevalkaOrdinaryMax,
  klevalkaMaxWeightAuditTsv,
  type KlevalkaMaxWeightAuditRow,
} from './klevalka-max-weight-audit.js';

void describe('Klevalka inferred maximum-weight audit', () => {
  void it('finds the calibrated 18,700 g dense-cluster boundary without using source MAX', () => {
    const lowerDistribution = Array.from({ length: 400 }, (_, index) => 1_000 + index * 30);
    const denseCluster = Array.from({ length: 176 }, (_, index) => 18_350 + index * 2);
    const mutantTail = [
      18_764, 18_773, 18_798, 18_833, 18_854, 18_874, 18_943, 18_945, 18_964, 18_965, 18_986,
      18_992, 19_024, 19_035, 19_221, 19_291, 19_331, 19_337, 19_365, 19_402, 19_421,
    ];
    const weights = [...lowerDistribution, ...denseCluster, ...mutantTail];
    const inferred = inferKlevalkaOrdinaryMax({
      weightsGrams: weights,
      locationNames: ['Открытая вода', 'Шхера'],
      baitNames: ['Живец', 'X-Tail-09', 'Foam-Blue'],
    });

    assert.equal(inferred.inferredMaxWeightGrams, 18_700);
    assert.equal(inferred.confidence, 'HIGH');
    assert.equal(inferred.nearBoundaryCount, 94);
    assert.equal(inferred.aboveBoundaryMutantTailCount, mutantTail.length);
    assert.notEqual(inferred.inferredMaxWeightGrams, Math.max(...weights));
  });

  void it('does not infer from sparse evidence and distinguishes an absent source', () => {
    const sparse = inferKlevalkaOrdinaryMax({
      weightsGrams: [90, 95, 99, 100, 110],
      locationNames: ['Локация'],
      baitNames: ['Наживка'],
    });
    assert.equal(sparse.confidence, 'LOW');
    assert.equal(sparse.inferredMaxWeightGrams, null);
    assert.match(sparse.reason, /sparse evidence/u);

    const absent = inferKlevalkaOrdinaryMax({
      weightsGrams: [],
      locationNames: [],
      baitNames: [],
    });
    assert.equal(absent.confidence, 'NO_SOURCE');
    assert.equal(absent.inferredMaxWeightGrams, null);
  });

  void it('favors a nearby round boundary without ever snapping to source MAX', () => {
    const lowerDistribution = Array.from({ length: 100 }, (_, index) => 1_000 + index * 35);
    const upperCluster = Array.from({ length: 101 }, (_, index) => 5_301 + index * 2);
    const mutantTail = [5_600, 5_720, 5_810, 5_900];
    const inferred = inferKlevalkaOrdinaryMax({
      weightsGrams: [...lowerDistribution, ...upperCluster, ...mutantTail],
      locationNames: ['Первая', 'Вторая'],
      baitNames: ['A', 'B', 'C'],
    });

    assert.equal(inferred.inferredMaxWeightGrams, 5_500);
    assert.equal(inferred.confidence, 'HIGH');
    assert.equal(inferred.aboveBoundaryMutantTailCount, 5);
    assert.match(inferred.reason, /observed cluster edge 5501 g/u);
  });

  void it('emits one stable TSV data row with all requested columns and safe text cells', () => {
    const row: KlevalkaMaxWeightAuditRow = {
      fishingBaseName: 'База',
      fishName: 'Рыба',
      databaseMaxWeightGrams: 19_370,
      inferredMaxWeightGrams: 18_700,
      deltaGrams: -670,
      ratio: 18_700 / 19_370,
      sourceRows: 831,
      nearBoundaryCount: 92,
      aboveBoundaryMutantTailCount: 21,
      locationDiversity: 12,
      baitDiversity: 143,
      confidence: 'HIGH',
      reason: 'dense\tcluster\nwith tail',
    };
    const lines = klevalkaMaxWeightAuditTsv([row]).trimEnd().split('\n');

    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.split('\t').length, 13);
    assert.equal(lines[1]?.split('\t').length, 13);
    assert.match(lines[1] ?? '', /\t-670\t0\.965410\t/u);
    assert.match(lines[1] ?? '', /dense cluster with tail$/u);
  });
});
