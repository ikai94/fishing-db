import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getRecordsWeek } from './records-week.js';

void describe('records week', () => {
  void it('switches exactly on Sunday 22:00 Europe/Moscow', () => {
    assert.equal(
      getRecordsWeek(new Date('2026-09-06T18:59:59.999Z')).startsAt.toISOString(),
      '2026-08-30T19:00:00.000Z',
    );
    assert.equal(
      getRecordsWeek(new Date('2026-09-06T19:00:00.000Z')).startsAt.toISOString(),
      '2026-09-06T19:00:00.000Z',
    );
    assert.equal(
      getRecordsWeek(new Date('2026-09-09T12:00:00.000Z')).endsAt.toISOString(),
      '2026-09-13T19:00:00.000Z',
    );
  });
});
