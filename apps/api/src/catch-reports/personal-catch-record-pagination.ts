const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 1_024;
const MAX_NORMALIZED_NAME_LENGTH = 128;

export interface PersonalCatchRecordCursor {
  version: 1;
  fishNameNormalized: string;
  fishId: string;
}

export class InvalidPersonalCatchRecordCursorError extends Error {
  constructor() {
    super('Invalid personal CatchReport record cursor');
    this.name = 'InvalidPersonalCatchRecordCursorError';
  }
}

function invalidCursor(): never {
  throw new InvalidPersonalCatchRecordCursorError();
}

export function encodePersonalCatchRecordCursor(
  value: Omit<PersonalCatchRecordCursor, 'version'>,
): string {
  return Buffer.from(JSON.stringify({ version: 1, ...value }), 'utf8').toString('base64url');
}

export function decodePersonalCatchRecordCursor(value: string): PersonalCatchRecordCursor {
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

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    return invalidCursor();
  }
  const record = decoded as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    record.version !== 1 ||
    typeof record.fishNameNormalized !== 'string' ||
    record.fishNameNormalized.length === 0 ||
    record.fishNameNormalized.length > MAX_NORMALIZED_NAME_LENGTH ||
    typeof record.fishId !== 'string' ||
    !UUID_V4_PATTERN.test(record.fishId)
  ) {
    return invalidCursor();
  }

  return {
    version: 1,
    fishNameNormalized: record.fishNameNormalized,
    fishId: record.fishId,
  };
}
