import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeSpotGroupKey,
  encodeSpotGroupKey,
  InvalidSpotGroupKeyError,
} from './spot-group-key.js';

const IDENTITY = {
  locationId: '30000000-0000-4000-8000-000000000001',
  holeDepthCm: null,
  normalizedSpotKey: 'у блокнота',
} as const;

void describe('spot group key', () => {
  void it('round-trips a versioned nullable identity without changing its spot text', () => {
    assert.deepEqual(decodeSpotGroupKey(encodeSpotGroupKey(IDENTITY)), IDENTITY);
    const maximumUnicodeIdentity = { ...IDENTITY, normalizedSpotKey: '🎯'.repeat(1_000) };
    assert.deepEqual(
      decodeSpotGroupKey(encodeSpotGroupKey(maximumUnicodeIdentity)),
      maximumUnicodeIdentity,
    );
  });

  void it('rejects missing identities, malformed encodings and unknown versions', () => {
    const invalid = [
      '',
      'not+base64url',
      Buffer.from(JSON.stringify({ ...IDENTITY, v: 2 })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          v: 1,
          locationId: IDENTITY.locationId,
          holeDepthCm: null,
          normalizedSpotKey: null,
        }),
      ).toString('base64url'),
    ];
    for (const value of invalid) {
      assert.throws(() => decodeSpotGroupKey(value), InvalidSpotGroupKeyError);
    }
  });
});
