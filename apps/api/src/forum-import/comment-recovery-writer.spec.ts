import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveExternalImportKey } from './identity.js';
import type { RecoveryRow } from './comment-recovery.js';
import { validateRecoveryCheckpoint } from './apply-comment-recovery.js';
import {
  APPROVED_COMMENT_PLAN_SHA256,
  APPROVED_COMMENT_REPORT_SHA256,
  APPROVED_COMMENT_DATABASE_SHA256,
  validateWriteBatch,
  recoveryRowHash,
  verifyRecoveryIntegrity,
  type RecoveryWriteCheckpoint,
} from './comment-recovery-writer.js';

const row: RecoveryRow = {
  id: 'row',
  userId: 'admin',
  contributorKey: 'contributor',
  importKey: deriveExternalImportKey('888', 1),
  fishId: 'fish',
  baitId: 'bait',
  locationId: 'location',
  weightGrams: 1000,
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: 600,
  spotPositionRaw: 'левее',
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: null,
  rawSourceText: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const item = {
  id: row.id,
  importKey: row.importKey ?? '',
  userNoteRaw: 'заметка',
  baselineSha256: recoveryRowHash(row),
  parserDisagreements: [],
};
const checkpoint: RecoveryWriteCheckpoint = {
  version: 1,
  planSha256: APPROVED_COMMENT_PLAN_SHA256,
  reportSha256: APPROVED_COMMENT_REPORT_SHA256,
  databaseSnapshotSha256: APPROVED_COMMENT_DATABASE_SHA256,
  nextIndex: 100,
  committedBatches: 1,
  updated: 100,
  replayed: 0,
};

void describe('forum comment writer preconditions', () => {
  void it('rejects altered checkpoint hashes, skipped positions and inconsistent commit counters', () => {
    validateRecoveryCheckpoint(checkpoint, 6191);
    for (const patch of [
      { planSha256: 'changed' },
      { databaseSnapshotSha256: 'changed' },
      { nextIndex: 99 },
      { nextIndex: 6200 },
      { committedBatches: 0 },
      { updated: 99 },
      { replayed: 1 },
    ]) {
      assert.throws(() => validateRecoveryCheckpoint({ ...checkpoint, ...patch }, 6191));
    }
  });
  void it('rejects held/core cases, repeated IDs and oversized batches', () => {
    validateWriteBatch([item]);
    assert.throws(() => validateWriteBatch([{ ...item, parserDisagreements: ['fishId'] }]));
    assert.throws(() => validateWriteBatch([item, item]));
    assert.throws(() => validateWriteBatch(Array.from({ length: 101 }, () => item)));
  });
  void it('requires every non-comment field and every held row to stay unchanged', () => {
    const outside = {
      ...row,
      id: 'held',
      importKey: deriveExternalImportKey('888', 2),
      userNoteRaw: 'existing',
    };
    const baseline = [row, outside];
    const after = [{ ...row, userNoteRaw: item.userNoteRaw }, outside];
    assert.equal(verifyRecoveryIntegrity(baseline, after, [item], true).commentsChanged, 1);
    for (const patch of [
      { updatedAt: new Date(1) },
      { rawSourceText: 'changed' },
      { holeDepthCm: 763 },
    ]) {
      assert.throws(() =>
        verifyRecoveryIntegrity(baseline, [{ ...after[0], ...patch }, outside], [item], true),
      );
    }
    assert.throws(() =>
      verifyRecoveryIntegrity(
        baseline,
        [after[0], { ...outside, userNoteRaw: 'overwritten' }],
        [item],
        true,
      ),
    );
    assert.throws(() => verifyRecoveryIntegrity(baseline, baseline, [item], true));
  });
});
