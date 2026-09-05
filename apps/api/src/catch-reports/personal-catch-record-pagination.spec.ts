import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodePersonalCatchRecordCursor,
  encodePersonalCatchRecordCursor,
  InvalidPersonalCatchRecordCursorError,
} from './personal-catch-record-pagination.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';

void describe('personal catch record pagination', () => {
  void it('round-trips the versioned Fish ordering tuple', () => {
    const encoded = encodePersonalCatchRecordCursor({
      fishNameNormalized: 'карась',
      fishId: FISH_ID,
    });

    assert.deepEqual(decodePersonalCatchRecordCursor(encoded), {
      version: 1,
      fishNameNormalized: 'карась',
      fishId: FISH_ID,
    });
  });

  void it('rejects malformed, non-canonical and unsupported cursors', () => {
    const unsupported = Buffer.from(
      JSON.stringify({ version: 2, fishNameNormalized: 'карась', fishId: FISH_ID }),
    ).toString('base64url');

    for (const value of ['', '***', `${unsupported}=`, unsupported]) {
      assert.throws(
        () => decodePersonalCatchRecordCursor(value),
        InvalidPersonalCatchRecordCursorError,
      );
    }
  });
});
