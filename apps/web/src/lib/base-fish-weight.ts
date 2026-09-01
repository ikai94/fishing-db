export const BASE_FISH_WEIGHT_CLASSIFICATIONS = [
  'suspicious-low',
  'ordinary',
  'mutant',
  'suspicious-high',
  'unclassified',
] as const;

export type BaseFishWeightClassification = (typeof BASE_FISH_WEIGHT_CLASSIFICATIONS)[number];

export type BaseFishWeightBounds = {
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
};

export type BaseFishWeightAssessment = BaseFishWeightBounds & {
  classification: BaseFishWeightClassification;
};

export function isBaseFishWeightClassification(
  value: unknown,
): value is BaseFishWeightClassification {
  return BASE_FISH_WEIGHT_CLASSIFICATIONS.some((classification) => classification === value);
}

export function weightClassificationLabel(classification: BaseFishWeightClassification): string {
  switch (classification) {
    case 'suspicious-low':
      return 'Подозрительно низкий';
    case 'ordinary':
      return 'Обычный';
    case 'mutant':
      return 'Мутант';
    case 'suspicious-high':
      return 'Подозрительно высокий';
    case 'unclassified':
      return 'Без классификации';
  }
}

export function anomalyWeightLabel(classification: BaseFishWeightClassification): string | null {
  return classification === 'ordinary' || classification === 'unclassified'
    ? null
    : weightClassificationLabel(classification);
}

export function formatCompactWeight(weightGrams: number): string {
  if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
    throw new Error('Некорректный вес.');
  }
  if (weightGrams < 1_000) return `${weightGrams.toLocaleString('ru-RU')} г`;

  const kilograms = Math.trunc(weightGrams / 1_000);
  const grams = weightGrams % 1_000;
  if (grams === 0) return `${kilograms.toLocaleString('ru-RU')} кг`;

  const fraction = String(grams).padStart(3, '0').replace(/0+$/u, '');
  return `${kilograms.toLocaleString('ru-RU')}.${fraction} кг`;
}

export function formatBaseFishWeightBounds(bounds: BaseFishWeightBounds): string {
  if (bounds.minWeightGrams !== null && bounds.maxWeightGrams !== null) {
    return `${formatCompactWeight(bounds.minWeightGrams)} — ${formatCompactWeight(bounds.maxWeightGrams)}`;
  }
  if (bounds.minWeightGrams !== null) return `от ${formatCompactWeight(bounds.minWeightGrams)}`;
  if (bounds.maxWeightGrams !== null) return `до ${formatCompactWeight(bounds.maxWeightGrams)}`;
  return 'границы не указаны';
}
