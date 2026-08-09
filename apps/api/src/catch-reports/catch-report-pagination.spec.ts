import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCatchReportPage,
  catchReportCursorWhere,
  decodeCatchReportCursor,
  encodeCatchReportCursor,
  InvalidCatchReportCursorError,
} from './catch-report-pagination.js';

const FIRST_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_ID = '10000000-0000-4000-8000-000000000002';
const THIRD_ID = '10000000-0000-4000-8000-000000000003';
const CREATED_AT = new Date('2026-08-09T10:20:30.123Z');

void describe('CatchReport pagination', () => {
  void it('round-trips an opaque base64url cursor', () => {
    const encoded = encodeCatchReportCursor({ createdAt: CREATED_AT, id: SECOND_ID });

    assert.match(encoded, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeCatchReportCursor(encoded), {
      createdAt: CREATED_AT,
      id: SECOND_ID,
    });
  });

  void it('rejects malformed, non-canonical, and structurally invalid cursors', () => {
    const invalidCursors = [
      '',
      'not+a+base64url+cursor',
      Buffer.from('{', 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: 'not-a-date', id: FIRST_ID }), 'utf8').toString(
        'base64url',
      ),
      Buffer.from(
        JSON.stringify({ createdAt: CREATED_AT.toISOString(), id: 'not-a-uuid' }),
        'utf8',
      ).toString('base64url'),
      Buffer.from(
        JSON.stringify({ createdAt: CREATED_AT.toISOString(), id: FIRST_ID, extra: true }),
        'utf8',
      ).toString('base64url'),
    ];

    for (const cursor of invalidCursors) {
      assert.throws(
        () => decodeCatchReportCursor(cursor),
        (error: unknown) => error instanceof InvalidCatchReportCursorError,
      );
    }
  });

  void it('builds the equal-timestamp tie-breaker predicate using id', () => {
    assert.deepEqual(catchReportCursorWhere({ createdAt: CREATED_AT, id: SECOND_ID }), {
      OR: [{ createdAt: { lt: CREATED_AT } }, { createdAt: CREATED_AT, id: { lt: SECOND_ID } }],
    });
  });

  void it('uses limit plus one to expose a next cursor without returning the extra row', () => {
    const fetched = [
      { id: THIRD_ID, createdAt: CREATED_AT },
      { id: SECOND_ID, createdAt: CREATED_AT },
      { id: FIRST_ID, createdAt: CREATED_AT },
    ];

    const page = buildCatchReportPage(fetched, 2);

    assert.deepEqual(page.items, fetched.slice(0, 2));
    assert.deepEqual(decodeCatchReportCursor(page.nextCursor ?? ''), {
      createdAt: CREATED_AT,
      id: SECOND_ID,
    });
  });

  void it('returns a null cursor when there is no extra row', () => {
    const fetched = [{ id: FIRST_ID, createdAt: CREATED_AT }];

    assert.deepEqual(buildCatchReportPage(fetched, 2), {
      items: fetched,
      nextCursor: null,
    });
  });
});
