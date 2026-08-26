import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeFishCatchAggregateCursor,
  encodeFishCatchAggregateCursor,
  InvalidFishCatchAggregateCursorError,
  type FishCatchAggregateCursor,
} from './fish-catch-aggregate-pagination.js';

const CURSOR: FishCatchAggregateCursor = {
  baseNameNormalized: 'ахтуба',
  baseId: '60000000-0000-4000-8000-000000000001',
  locationNumber: 7,
  locationId: '70000000-0000-4000-8000-000000000001',
  intensity: 18,
  baitNameNormalized: 'мотыль',
  baitId: '50000000-0000-4000-8000-000000000001',
};

void describe('Fish catch aggregate cursor', () => {
  void it('round-trips the complete aggregate ordering tuple', () => {
    assert.deepEqual(
      decodeFishCatchAggregateCursor(encodeFishCatchAggregateCursor(CURSOR)),
      CURSOR,
    );
  });

  void it('rejects malformed and incomplete cursors', () => {
    for (const value of [
      '',
      'not-json',
      Buffer.from(JSON.stringify({ ...CURSOR, intensity: 0 })).toString('base64url'),
      Buffer.from(JSON.stringify({ ...CURSOR, baitId: undefined })).toString('base64url'),
      Buffer.from(JSON.stringify({ ...CURSOR, extra: true })).toString('base64url'),
    ]) {
      assert.throws(
        () => decodeFishCatchAggregateCursor(value),
        InvalidFishCatchAggregateCursorError,
      );
    }
  });
});
