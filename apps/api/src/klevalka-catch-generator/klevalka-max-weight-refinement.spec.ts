import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { refineKlevalkaOrdinaryMax } from './klevalka-max-weight-refinement.js';

function diverseEvidence(weightsGrams: readonly number[]) {
  return {
    weightsGrams,
    locationNames: ['Первая', 'Вторая', 'Третья'],
    baitNames: ['A', 'B', 'C', 'D'],
  };
}

void describe('Klevalka rounded maximum-weight refinement', () => {
  void it('confirms the calibrated 18,700 g boundary from direct distribution support', () => {
    const lowerDistribution = Array.from({ length: 400 }, (_, index) => 1_000 + index * 30);
    const upperCluster = Array.from({ length: 176 }, (_, index) => 18_350 + index * 2);
    const mutantTail = [
      18_764, 18_773, 18_798, 18_833, 18_854, 18_874, 18_943, 18_945, 18_964, 18_965, 18_986,
      18_992, 19_024, 19_035, 19_221, 19_291, 19_331, 19_337, 19_365, 19_402, 19_421,
    ];
    const result = refineKlevalkaOrdinaryMax({
      databaseMaxWeightGrams: 19_370,
      previousInferredMaxWeightGrams: 18_700,
      evidence: diverseEvidence([...lowerDistribution, ...upperCluster, ...mutantTail]),
    });

    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.refinedCandidateGrams, 18_700);
    assert.equal(result.nearBelowCount, 94);
    assert.equal(result.aboveTailCount, mutantTail.length);
  });

  void it('accepts a nearby rounded value only when it remains inside the supported gap', () => {
    const lowerDistribution = Array.from({ length: 200 }, (_, index) => 50_000 + index * 300);
    const upperCluster = Array.from({ length: 120 }, (_, index) => 114_881 + index * 5);
    const mutantTail = [116_000, 116_400, 117_000, 118_000];
    const result = refineKlevalkaOrdinaryMax({
      databaseMaxWeightGrams: 126_500,
      previousInferredMaxWeightGrams: 115_476,
      evidence: diverseEvidence([...lowerDistribution, ...upperCluster, ...mutantTail]),
    });

    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.refinedCandidateGrams, 115_500);
    assert.equal(result.aboveTailCount, mutantTail.length);
  });

  void it('does not preserve a large observed edge merely because its last digit is zero', () => {
    const lowerDistribution = Array.from({ length: 200 }, (_, index) => 5_000 + index * 60);
    const upperCluster = Array.from({ length: 131 }, (_, index) => 18_000 + index * 2);
    const mutantTail = [18_700, 18_900, 19_100, 19_300];
    const result = refineKlevalkaOrdinaryMax({
      databaseMaxWeightGrams: 20_000,
      previousInferredMaxWeightGrams: 18_260,
      evidence: diverseEvidence([...lowerDistribution, ...upperCluster, ...mutantTail]),
    });

    assert.equal(result.confidence, 'HIGH');
    assert.equal(result.refinedCandidateGrams, 18_300);
  });

  void it('returns UNKNOWN when nearby rounded values cut through a dense continuation', () => {
    const weights = Array.from({ length: 500 }, (_, index) => 4_000 + index * 4);
    const result = refineKlevalkaOrdinaryMax({
      databaseMaxWeightGrams: 7_000,
      previousInferredMaxWeightGrams: 5_501,
      evidence: diverseEvidence(weights),
    });

    assert.equal(result.confidence, 'UNKNOWN');
    assert.equal(result.refinedCandidateGrams, null);
    assert.equal(result.nearBelowCount, null);
    assert.equal(result.aboveTailCount, null);
  });
});
