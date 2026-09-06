const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_GROUP_KEY_LENGTH = 8_192;

export interface SpotGroupIdentity {
  locationId: string;
  holeDepthCm: number | null;
  normalizedSpotKey: string | null;
}

export class InvalidSpotGroupKeyError extends Error {
  constructor() {
    super('Invalid spot group key');
    this.name = 'InvalidSpotGroupKeyError';
  }
}

function invalid(): never {
  throw new InvalidSpotGroupKeyError();
}

export function encodeSpotGroupKey(identity: SpotGroupIdentity): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      locationId: identity.locationId,
      holeDepthCm: identity.holeDepthCm,
      normalizedSpotKey: identity.normalizedSpotKey,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeSpotGroupKey(value: string): SpotGroupIdentity {
  if (value.length === 0 || value.length > MAX_GROUP_KEY_LENGTH || !BASE64URL_PATTERN.test(value)) {
    return invalid();
  }

  const buffer = Buffer.from(value, 'base64url');
  if (buffer.toString('base64url') !== value) return invalid();

  let decoded: unknown;
  try {
    decoded = JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    return invalid();
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return invalid();
  const item = decoded as Record<string, unknown>;
  if (
    Object.keys(item).length !== 4 ||
    item.v !== 1 ||
    typeof item.locationId !== 'string' ||
    !UUID_V4_PATTERN.test(item.locationId) ||
    (item.holeDepthCm !== null &&
      (typeof item.holeDepthCm !== 'number' ||
        !Number.isInteger(item.holeDepthCm) ||
        item.holeDepthCm < 1 ||
        item.holeDepthCm > 2_147_483_647)) ||
    (item.normalizedSpotKey !== null &&
      (typeof item.normalizedSpotKey !== 'string' ||
        item.normalizedSpotKey.length === 0 ||
        item.normalizedSpotKey.length > 4_000)) ||
    (item.holeDepthCm === null && item.normalizedSpotKey === null)
  ) {
    return invalid();
  }

  return {
    locationId: item.locationId.toLowerCase(),
    holeDepthCm: item.holeDepthCm,
    normalizedSpotKey: item.normalizedSpotKey,
  };
}
