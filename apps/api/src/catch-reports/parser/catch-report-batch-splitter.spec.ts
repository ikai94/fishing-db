import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  duplicateIndexesByCandidate,
  splitCatchReportBatchSource,
} from './catch-report-batch-splitter.js';

void describe('CatchReport batch line splitter', () => {
  void it('treats every non-empty physical line as an exact independent candidate', () => {
    const candidates = splitCatchReportBatchSource('  первая  \r\n\t\rвторая\n\nтретья');

    assert.deepEqual(candidates, [
      { index: 0, sourceLine: 1, rawSourceText: '  первая  ' },
      { index: 1, sourceLine: 3, rawSourceText: 'вторая' },
      { index: 2, sourceLine: 5, rawSourceText: 'третья' },
    ]);
  });

  void it('marks exact strings as duplicates without normalizing or removing them', () => {
    const candidates = splitCatchReportBatchSource('Налим\nНалим \nНалим\nналим');
    const duplicates = duplicateIndexesByCandidate(candidates);

    assert.deepEqual(duplicates.get(0), [2]);
    assert.equal(duplicates.has(1), false);
    assert.deepEqual(duplicates.get(2), [0]);
    assert.equal(duplicates.has(3), false);
    assert.equal(candidates.length, 4);
  });
});
