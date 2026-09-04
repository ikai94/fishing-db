const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const MAX_CURSOR_LENGTH = 1_024;

export class InvalidActivityCursorError extends Error {
  constructor() {
    super('Invalid ActivityEvent cursor');
    this.name = 'InvalidActivityCursorError';
  }
}

function invalidCursor(): never {
  throw new InvalidActivityCursorError();
}

export function encodeActivityCursor(beforeId: bigint): string {
  return Buffer.from(JSON.stringify({ v: 1, beforeId: beforeId.toString(10) }), 'utf8').toString(
    'base64url',
  );
}

export function decodeActivityCursor(value: string): bigint {
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

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    Array.isArray(decoded) ||
    Object.keys(decoded).length !== 2 ||
    !('v' in decoded) ||
    decoded.v !== 1 ||
    !('beforeId' in decoded) ||
    typeof decoded.beforeId !== 'string' ||
    !POSITIVE_INTEGER_PATTERN.test(decoded.beforeId)
  ) {
    return invalidCursor();
  }

  return BigInt(decoded.beforeId);
}

export function buildActivityPage<T extends { id: bigint }>(fetched: T[], limit: number) {
  const hasNextPage = fetched.length > limit;
  const items = hasNextPage ? fetched.slice(0, limit) : fetched;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasNextPage && last !== undefined ? encodeActivityCursor(last.id) : null,
  };
}
