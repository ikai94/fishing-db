import { CATCH_REPORT_MAX_INTEGER } from '../catch-reports.constants.js';

const POSITIVE_INTEGER = /^\d+$/u;
const WEIGHT = /^(\d+)(?:([,.])(\d{1,3}))?\s*(кг|грамм(?:а|ов)?|гр\.?|г)$/iu;
const DEPTH = /^(\d+)(?:([,.])(\d{1,2}))?$/u;

function scaledPositiveInteger(
  whole: string,
  fraction: string,
  scaleDigits: number,
): number | null {
  if (!POSITIVE_INTEGER.test(whole) || !POSITIVE_INTEGER.test(fraction)) {
    return null;
  }

  const scale = 10n ** BigInt(scaleDigits);
  const value = BigInt(whole) * scale + BigInt(fraction.padEnd(scaleDigits, '0'));

  if (value < 1n || value > BigInt(CATCH_REPORT_MAX_INTEGER)) {
    return null;
  }

  return Number(value);
}

export function parseWeightGrams(sourceText: string): number | null {
  const match = WEIGHT.exec(sourceText.trim());

  if (match === null) {
    return null;
  }

  const whole = match[1];
  const fraction = match[3];
  const unit = match[4]?.toLowerCase();

  if (whole === undefined || unit === undefined) {
    return null;
  }

  if (unit === 'кг') {
    return scaledPositiveInteger(whole, fraction ?? '0', 3);
  }

  if (fraction !== undefined) {
    return null;
  }

  const value = BigInt(whole);
  return value >= 1n && value <= BigInt(CATCH_REPORT_MAX_INTEGER) ? Number(value) : null;
}

export function parseHoleDepthCm(sourceText: string): number | null {
  const match = DEPTH.exec(sourceText.trim());

  if (match === null) {
    return null;
  }

  const whole = match[1];
  const fraction = match[3];

  if (whole === undefined) {
    return null;
  }

  return scaledPositiveInteger(whole, fraction ?? '0', 2);
}
