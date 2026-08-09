const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CURSOR_LENGTH = 1_024;

export interface CatchReportCursor {
  createdAt: Date;
  id: string;
}

export interface CatchReportCursorWhere {
  OR: [{ createdAt: { lt: Date } }, { createdAt: Date; id: { lt: string } }];
}

export interface CatchReportPage<T> {
  items: T[];
  nextCursor: string | null;
}

export class InvalidCatchReportCursorError extends Error {
  constructor() {
    super('Invalid CatchReport cursor');
    this.name = 'InvalidCatchReportCursorError';
  }
}

function invalidCursor(): never {
  throw new InvalidCatchReportCursorError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function encodeCatchReportCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCatchReportCursor(value: string): CatchReportCursor {
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || !BASE64URL_PATTERN.test(value)) {
    return invalidCursor();
  }

  const buffer = Buffer.from(value, 'base64url');

  if (buffer.toString('base64url') !== value) {
    return invalidCursor();
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    return invalidCursor();
  }

  if (!isRecord(decoded) || Object.keys(decoded).length !== 2) {
    return invalidCursor();
  }

  const createdAtValue = decoded.createdAt;
  const id = decoded.id;

  if (typeof createdAtValue !== 'string' || typeof id !== 'string' || !UUID_V4_PATTERN.test(id)) {
    return invalidCursor();
  }

  const createdAt = new Date(createdAtValue);

  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== createdAtValue) {
    return invalidCursor();
  }

  return { createdAt, id };
}

export function catchReportCursorWhere(cursor: CatchReportCursor): CatchReportCursorWhere {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

export function buildCatchReportPage<T extends { createdAt: Date; id: string }>(
  fetchedItems: T[],
  limit: number,
): CatchReportPage<T> {
  const hasNextPage = fetchedItems.length > limit;
  const items = hasNextPage ? fetchedItems.slice(0, limit) : fetchedItems;
  const lastItem = items.at(-1);

  return {
    items,
    nextCursor: hasNextPage && lastItem !== undefined ? encodeCatchReportCursor(lastItem) : null,
  };
}
