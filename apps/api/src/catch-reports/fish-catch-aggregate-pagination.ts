const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 2_048;
const MAX_NORMALIZED_NAME_LENGTH = 128;

export interface FishCatchAggregateCursor {
  baseNameNormalized: string;
  baseId: string;
  locationNumber: number;
  locationId: string;
  intensity: number;
  baitNameNormalized: string;
  baitId: string;
}

export class InvalidFishCatchAggregateCursorError extends Error {
  constructor() {
    super('Invalid Fish catch aggregate cursor');
    this.name = 'InvalidFishCatchAggregateCursorError';
  }
}

function invalidCursor(): never {
  throw new InvalidFishCatchAggregateCursorError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNormalizedName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= MAX_NORMALIZED_NAME_LENGTH
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function encodeFishCatchAggregateCursor(value: FishCatchAggregateCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeFishCatchAggregateCursor(value: string): FishCatchAggregateCursor {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(value)) {
    return invalidCursor();
  }

  const buffer = Buffer.from(value, 'base64url');
  if (buffer.toString('base64url') !== value) return invalidCursor();

  let decoded: unknown;
  try {
    decoded = JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    return invalidCursor();
  }

  if (!isRecord(decoded) || Object.keys(decoded).length !== 7) return invalidCursor();

  const {
    baseNameNormalized,
    baseId,
    locationNumber,
    locationId,
    intensity,
    baitNameNormalized,
    baitId,
  } = decoded;

  if (
    !isNormalizedName(baseNameNormalized) ||
    typeof baseId !== 'string' ||
    !UUID_V4_PATTERN.test(baseId) ||
    !isPositiveSafeInteger(locationNumber) ||
    typeof locationId !== 'string' ||
    !UUID_V4_PATTERN.test(locationId) ||
    !isPositiveSafeInteger(intensity) ||
    !isNormalizedName(baitNameNormalized) ||
    typeof baitId !== 'string' ||
    !UUID_V4_PATTERN.test(baitId)
  ) {
    return invalidCursor();
  }

  return {
    baseNameNormalized,
    baseId,
    locationNumber,
    locationId,
    intensity,
    baitNameNormalized,
    baitId,
  };
}
