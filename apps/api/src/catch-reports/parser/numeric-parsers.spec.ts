import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHoleDepthCm, parseWeightGrams } from './numeric-parsers.js';

void describe('numeric parsers', () => {
  void it('parses gram and kilogram weights with integer arithmetic', () => {
    assert.equal(parseWeightGrams('40 грамм'), 40);
    assert.equal(parseWeightGrams('7,242 кг'), 7_242);
    assert.equal(parseWeightGrams('42,861 кг'), 42_861);
    assert.equal(parseWeightGrams('1,449 кг'), 1_449);
    assert.equal(parseWeightGrams('25,101 кг'), 25_101);
    assert.equal(parseWeightGrams('2.5 кг'), 2_500);
  });

  void it('rejects malformed, nonpositive, over-precise, and overflowing weights', () => {
    assert.equal(parseWeightGrams('0 грамм'), null);
    assert.equal(parseWeightGrams('-1 кг'), null);
    assert.equal(parseWeightGrams('1e2 грамм'), null);
    assert.equal(parseWeightGrams('1,0001 кг'), null);
    assert.equal(parseWeightGrams('1,5 грамм'), null);
    assert.equal(parseWeightGrams('2147483648 грамм'), null);
  });

  void it('parses depths in centimeters with at most two decimal places', () => {
    assert.equal(parseHoleDepthCm('3.61'), 361);
    assert.equal(parseHoleDepthCm('3,61'), 361);
    assert.equal(parseHoleDepthCm('10.78'), 1_078);
    assert.equal(parseHoleDepthCm('14.68'), 1_468);
    assert.equal(parseHoleDepthCm('6'), 600);
    assert.equal(parseHoleDepthCm('6,0'), 600);
  });

  void it('rejects unsafe depth representations', () => {
    assert.equal(parseHoleDepthCm('0'), null);
    assert.equal(parseHoleDepthCm('-6'), null);
    assert.equal(parseHoleDepthCm('1e2'), null);
    assert.equal(parseHoleDepthCm('6,001'), null);
    assert.equal(parseHoleDepthCm('21474837'), null);
  });
});
