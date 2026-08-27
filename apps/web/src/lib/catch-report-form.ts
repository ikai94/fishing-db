import type { BaitType } from './catalog-api';
import type { FishingMethod, FishingNote, SpinningSize, SpinningSpeed } from './catch-reports-api';

export const MAX_DATABASE_INTEGER = 2_147_483_647;
export const MAX_SPOT_POSITION_CODE_POINTS = 1_000;
export const MAX_RAW_SOURCE_CODE_POINTS = 20_000;
export const MAX_BATCH_SOURCE_CHARACTERS = 1_000_000;
export const MAX_BATCH_REPORTS = 5_000;

export const FISHING_NOTE_OPTIONS: ReadonlyArray<{ value: FishingNote; label: string }> = [
  { value: 'MIDWATER', label: 'вполводы' },
  { value: 'FROM_BOTTOM', label: 'со дна' },
  { value: 'SURFACE', label: 'поверху' },
];

export const SPINNING_SIZE_OPTIONS: ReadonlyArray<{ value: SpinningSize; label: string }> = [
  { value: 'SMALL', label: 'Маленькая' },
  { value: 'MEDIUM', label: 'Средняя' },
  { value: 'LARGE', label: 'Большая' },
];

export const SPINNING_SPEED_OPTIONS: ReadonlyArray<{ value: SpinningSpeed; label: string }> = [
  { value: 'SLOW', label: 'Медленная' },
  { value: 'MEDIUM', label: 'Средняя' },
  { value: 'FAST', label: 'Быстрая' },
];

const MAX_DATABASE_INTEGER_BIGINT = BigInt(MAX_DATABASE_INTEGER);
const ZERO_BIGINT = BigInt(0);
const HUNDRED_BIGINT = BigInt(100);
const DEPTH_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;
const INTEGER_PATTERN = /^\d+$/;
const CONTROL_OR_FORMAT_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}]/u;
const UNSAFE_RAW_SOURCE_CHARACTER =
  /[\p{Cf}\p{Cs}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

export function parseMetersToCentimeters(value: string): number | null {
  const normalized = value.trim();
  if (normalized === '') return null;

  if (!DEPTH_PATTERN.test(normalized)) {
    throw new Error('Введите глубину в метрах: целое число и не более двух знаков после запятой.');
  }

  const [meters, fraction = ''] = normalized.replace(',', '.').split('.');
  const centimeters = BigInt(meters) * HUNDRED_BIGINT + BigInt(fraction.padEnd(2, '0'));

  if (centimeters === ZERO_BIGINT) throw new Error('Глубина должна быть больше нуля.');
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
  if (!INTEGER_PATTERN.test(normalized)) throw new Error('Введите вес целым числом граммов.');

  const grams = BigInt(normalized);
  if (grams === ZERO_BIGINT) throw new Error('Вес должен быть больше нуля.');
  if (grams > MAX_DATABASE_INTEGER_BIGINT) {
    throw new Error('Вес превышает допустимое значение.');
  }

  return Number(grams);
}

export function normalizeUserNoteRaw(value: string): string | null {
  return normalizeExactText(value, 1_000, 'Комментарий');
}

export function normalizeSpotPositionRaw(value: string): string | null {
  return normalizeExactText(value, MAX_SPOT_POSITION_CODE_POINTS, 'Позиция');
}

function normalizeExactText(value: string, maximum: number, fieldLabel: string): string | null {
  if (value === '') return null;
  if (value.trim() === '') throw new Error(`${fieldLabel} не может состоять только из пробелов.`);
  if (CONTROL_OR_FORMAT_CHARACTER.test(value)) {
    throw new Error(`${fieldLabel} содержит недопустимые управляющие или невидимые символы.`);
  }
  if (Array.from(value).length > maximum) {
    throw new Error(`${fieldLabel} должен быть не длиннее ${maximum} символов.`);
  }
  return value;
}

export function validateRawSourceText(value: string): string {
  if (value === '' || value.trim() === '') {
    throw new Error('Вставьте непустую запись из игрового блокнота.');
  }
  if (UNSAFE_RAW_SOURCE_CHARACTER.test(value)) {
    throw new Error('Запись содержит недопустимые управляющие или невидимые символы.');
  }
  if (Array.from(value).length > MAX_RAW_SOURCE_CODE_POINTS) {
    throw new Error('Запись должна быть не длиннее 20000 символов.');
  }
  return value;
}

export function validateBatchRawSourceText(value: string): string {
  if (value === '' || value.trim() === '') {
    throw new Error('Вставьте непустую запись из игрового блокнота.');
  }
  if (value.length > MAX_BATCH_SOURCE_CHARACTERS) {
    throw new Error(`Пакет должен быть не длиннее ${MAX_BATCH_SOURCE_CHARACTERS} символов.`);
  }

  let reportCount = 0;
  for (const [lineIndex, line] of value.split(/\r\n|[\n\r]/u).entries()) {
    if (line.trim() === '') continue;
    reportCount += 1;
    if (reportCount > MAX_BATCH_REPORTS) {
      throw new Error(`За один раз можно разобрать не больше ${MAX_BATCH_REPORTS} строк.`);
    }
    try {
      validateRawSourceText(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'некорректная запись';
      throw new Error(`Строка ${lineIndex + 1}: ${message}`);
    }
  }

  return value;
}

export function baitTypeToFishingMethod(type: BaitType): FishingMethod {
  return type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
}

export function fishingMethodLabel(value: FishingMethod): string {
  return value === 'BAIT_FISHING' ? 'Ловля на наживку' : 'Спиннинг';
}

export function fishingNoteLabel(value: FishingNote | null): string | null {
  return FISHING_NOTE_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

export function spinningSizeLabel(value: SpinningSize | null): string | null {
  return SPINNING_SIZE_OPTIONS.find((option) => option.value === value)?.label ?? null;
}

export function spinningSpeedLabel(value: SpinningSpeed | null): string | null {
  return SPINNING_SPEED_OPTIONS.find((option) => option.value === value)?.label ?? null;
}
