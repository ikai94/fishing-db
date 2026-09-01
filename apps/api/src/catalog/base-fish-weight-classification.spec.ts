import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessBaseFishWeight, classifyBaseFishWeight } from './base-fish-weight-classification.js';

void describe('base Fish weight classification', () => {
  void it('classifies complete bounds inclusively with an exact integer mutant ceiling', () => {
    assert.equal(classifyBaseFishWeight(99, 100, 101), 'suspicious-low');
    assert.equal(classifyBaseFishWeight(100, 100, 101), 'ordinary');
    assert.equal(classifyBaseFishWeight(101, 100, 101), 'ordinary');
    assert.equal(classifyBaseFishWeight(102, 100, 101), 'mutant');
    assert.equal(classifyBaseFishWeight(106, 100, 101), 'mutant');
    assert.equal(classifyBaseFishWeight(107, 100, 101), 'suspicious-high');
  });

  void it('supports partial and absent bounds without inventing ordinary classifications', () => {
    assert.equal(classifyBaseFishWeight(99, 100, null), 'suspicious-low');
    assert.equal(classifyBaseFishWeight(100, 100, null), 'unclassified');
    assert.equal(classifyBaseFishWeight(200, null, 200), 'unclassified');
    assert.equal(classifyBaseFishWeight(201, null, 200), 'mutant');
    assert.equal(classifyBaseFishWeight(211, null, 200), 'suspicious-high');
    assert.deepEqual(assessBaseFishWeight(100, { minWeightGrams: null, maxWeightGrams: null }), {
      classification: 'unclassified',
      minWeightGrams: null,
      maxWeightGrams: null,
    });
  });

  void it('rejects invalid persisted-domain inputs', () => {
    assert.throws(() => classifyBaseFishWeight(0, null, null), TypeError);
    assert.throws(() => classifyBaseFishWeight(100, 200, 100), TypeError);
  });
});
