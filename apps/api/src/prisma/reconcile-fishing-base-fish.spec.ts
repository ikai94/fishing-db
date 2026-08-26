import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APPROVED_RECONCILIATION_PRE_STATE,
  FishingBaseFishReconciliationError,
  parseReconciliationCliOptions,
} from './reconcile-fishing-base-fish.js';

void describe('FishingBaseFish reconciliation CLI', () => {
  void it('requires an explicit safe mode and a dry-run fingerprint for apply', () => {
    assert.deepEqual(parseReconciliationCliOptions(['--dry-run']), { mode: 'dry-run' });
    assert.deepEqual(
      parseReconciliationCliOptions(['--apply', `--expected-fingerprint=${'a'.repeat(64)}`]),
      { mode: 'apply', expectedFingerprint: 'a'.repeat(64) },
    );

    for (const args of [
      [],
      ['--apply'],
      ['--dry-run', '--apply'],
      ['--apply', '--expected-fingerprint=not-a-hash'],
    ]) {
      assert.throws(() => parseReconciliationCliOptions(args), FishingBaseFishReconciliationError);
    }
  });

  void it('pins the approved pre-state and final counts', () => {
    assert.deepEqual(APPROVED_RECONCILIATION_PRE_STATE, {
      currentMemberships: 5_369,
      keep: 3_203,
      add: 27,
      remove: 2_166,
      currentCatchReports: 3_355,
      validCatchReports: 3_194,
      invalidImportedCatchReports: 161,
      invalidNativeCatchReports: 0,
      finalCatchReports: 3_194,
    });
  });
});
