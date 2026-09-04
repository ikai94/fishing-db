import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildActivityPage,
  decodeActivityCursor,
  encodeActivityCursor,
  InvalidActivityCursorError,
} from './activity-pagination.js';

void describe('ActivityEvent pagination', () => {
  void it('round-trips a versioned bigint cursor', () => {
    const cursor = encodeActivityCursor(9_007_199_254_740_993n);
    assert.equal(decodeActivityCursor(cursor), 9_007_199_254_740_993n);
  });

  void it('rejects malformed, zero, and unsupported-version cursors', () => {
    for (const value of [
      '',
      'not+base64url',
      Buffer.from(JSON.stringify({ v: 1, beforeId: '0' })).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 2, beforeId: '1' })).toString('base64url'),
    ]) {
      assert.throws(() => decodeActivityCursor(value), InvalidActivityCursorError);
    }
  });

  void it('uses the final returned id for the next page', () => {
    const page = buildActivityPage([{ id: 3n }, { id: 2n }, { id: 1n }], 2);
    assert.deepEqual(page.items, [{ id: 3n }, { id: 2n }]);
    assert.equal(decodeActivityCursor(page.nextCursor ?? ''), 2n);
  });
});
