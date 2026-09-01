import { describe, expect, test } from 'vitest';
import {
  anomalyWeightLabel,
  formatBaseFishWeightBounds,
  formatCompactWeight,
  weightClassificationLabel,
} from './base-fish-weight';

describe('Base Fish weight presentation', () => {
  test('formats compact weights and complete or partial Base bounds', () => {
    expect(formatCompactWeight(40)).toBe('40 г');
    expect(formatCompactWeight(1_250)).toBe('1.25 кг');
    expect(formatBaseFishWeightBounds({ minWeightGrams: 200, maxWeightGrams: 8_800 })).toBe(
      '200 г — 8.8 кг',
    );
    expect(formatBaseFishWeightBounds({ minWeightGrams: 200, maxWeightGrams: null })).toBe(
      'от 200 г',
    );
    expect(formatBaseFishWeightBounds({ minWeightGrams: null, maxWeightGrams: 8_800 })).toBe(
      'до 8.8 кг',
    );
    expect(formatBaseFishWeightBounds({ minWeightGrams: null, maxWeightGrams: null })).toBe(
      'границы не указаны',
    );
  });

  test('keeps anomaly labels out of dense rows while retaining explicit detail labels', () => {
    expect(anomalyWeightLabel('ordinary')).toBeNull();
    expect(anomalyWeightLabel('unclassified')).toBeNull();
    expect(anomalyWeightLabel('mutant')).toBe('Мутант');
    expect(weightClassificationLabel('unclassified')).toBe('Без классификации');
  });
});
