const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type BaseFishWeightClassification =
  'suspicious-low' | 'ordinary' | 'mutant' | 'suspicious-high' | 'unclassified';

export interface BaseFishWeightBounds {
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
}

export interface BaseFishWeightAssessment extends BaseFishWeightBounds {
  classification: BaseFishWeightClassification;
}

function assertPositivePostgresInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > POSTGRES_INTEGER_MAX) {
    throw new TypeError(`${label} must be a positive PostgreSQL integer`);
  }
}

export function classifyBaseFishWeight(
  weightGrams: number,
  minWeightGrams: number | null,
  maxWeightGrams: number | null,
): BaseFishWeightClassification {
  assertPositivePostgresInteger(weightGrams, 'weightGrams');
  if (minWeightGrams !== null) {
    assertPositivePostgresInteger(minWeightGrams, 'minWeightGrams');
  }
  if (maxWeightGrams !== null) {
    assertPositivePostgresInteger(maxWeightGrams, 'maxWeightGrams');
  }
  if (minWeightGrams !== null && maxWeightGrams !== null && minWeightGrams > maxWeightGrams) {
    throw new TypeError('minWeightGrams must not exceed maxWeightGrams');
  }

  if (minWeightGrams !== null && weightGrams < minWeightGrams) return 'suspicious-low';
  if (maxWeightGrams !== null && weightGrams > maxWeightGrams) {
    return BigInt(weightGrams) * 20n <= BigInt(maxWeightGrams) * 21n ? 'mutant' : 'suspicious-high';
  }
  if (minWeightGrams !== null && maxWeightGrams !== null) return 'ordinary';
  return 'unclassified';
}

export function assessBaseFishWeight(
  weightGrams: number,
  bounds: BaseFishWeightBounds,
): BaseFishWeightAssessment {
  return {
    classification: classifyBaseFishWeight(
      weightGrams,
      bounds.minWeightGrams,
      bounds.maxWeightGrams,
    ),
    minWeightGrams: bounds.minWeightGrams,
    maxWeightGrams: bounds.maxWeightGrams,
  };
}
