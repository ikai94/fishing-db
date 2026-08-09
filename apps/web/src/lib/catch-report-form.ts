import type { FishingNote, SpotLandmark } from './catch-reports-api';

export const MAX_DATABASE_INTEGER = 2_147_483_647;

export const SPOT_LANDMARK_OPTIONS: ReadonlyArray<{
  value: SpotLandmark;
  label: string;
}> = [
  { value: 'ROD', label: 'удочка' },
  { value: 'NOTEBOOK', label: 'блокнот' },
  { value: 'BACKPACK', label: 'рюкзак' },
  { value: 'REEL', label: 'катушка' },
  { value: 'CHAT', label: 'чат' },
  { value: 'TACKLE', label: 'снасти' },
];

export const FISHING_NOTE_OPTIONS: ReadonlyArray<{
  value: FishingNote;
  label: string;
}> = [
  { value: 'MIDWATER', label: 'вполводы' },
  { value: 'FROM_BOTTOM', label: 'со дна' },
  { value: 'SURFACE', label: 'поверху' },
];

const MAX_DATABASE_INTEGER_BIGINT = BigInt(MAX_DATABASE_INTEGER);
const ZERO_BIGINT = BigInt(0);
const HUNDRED_BIGINT = BigInt(100);
const DEPTH_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const INTEGER_PATTERN = /^\d+$/;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}]/u;

export function parseMetersToCentimeters(value: string): number | null {
  const normalized = value.trim();

  if (normalized === '') {
    return null;
  }

  if (!DEPTH_PATTERN.test(normalized)) {
    throw new Error('Введите глубину в метрах: целое число и не более двух знаков после запятой.');
  }

  const [meters, fraction = ''] = normalized.replace(',', '.').split('.');
  const centimeters = BigInt(meters) * HUNDRED_BIGINT + BigInt(fraction.padEnd(2, '0'));

  if (centimeters === ZERO_BIGINT) {
    throw new Error('Глубина должна быть больше нуля.');
  }

  if (centimeters > MAX_DATABASE_INTEGER_BIGINT) {
    throw new Error('Глубина превышает допустимое значение.');
  }

  return Number(centimeters);
}

export function formatCentimetersAsMeters(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DATABASE_INTEGER) {
    throw new Error('Некорректная глубина в сантиметрах.');
  }

  const centimetersValue = BigInt(value);
  const meters = centimetersValue / HUNDRED_BIGINT;
  const centimeters = centimetersValue % HUNDRED_BIGINT;
  return `${meters},${String(centimeters).padStart(2, '0')}`;
}

export function parseWeightGrams(value: string): number {
  const normalized = value.trim();

  if (!INTEGER_PATTERN.test(normalized)) {
    throw new Error('Введите вес целым числом граммов.');
  }

  const grams = BigInt(normalized);

  if (grams === ZERO_BIGINT) {
    throw new Error('Вес должен быть больше нуля.');
  }

  if (grams > MAX_DATABASE_INTEGER_BIGINT) {
    throw new Error('Вес превышает допустимое значение.');
  }

  return Number(grams);
}

export function normalizeUserNoteRaw(value: string): string | null {
  if (value === '') {
    return null;
  }

  if (value.trim() === '') {
    throw new Error('Заметка не может состоять только из пробелов.');
  }

  if (CONTROL_OR_FORMAT_CHARACTER.test(value)) {
    throw new Error('Заметка содержит недопустимые управляющие или невидимые символы.');
  }

  if (Array.from(value).length > 1000) {
    throw new Error('Заметка должна быть не длиннее 1000 символов.');
  }

  return value;
}

export function spotLandmarkLabel(value: SpotLandmark | null): string | null {
  return SPOT_LANDMARK_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

export function fishingNoteLabel(value: FishingNote | null): string | null {
  return FISHING_NOTE_OPTIONS.find((option) => option.value === value)?.label ?? null;
}
