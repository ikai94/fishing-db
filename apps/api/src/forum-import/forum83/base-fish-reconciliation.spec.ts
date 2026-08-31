import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  Forum83BaseFishReconciliationError,
  parseForum83BaseFishReconciliationOptions,
} from './base-fish-reconciliation.js';
import {
  FORUM83_REVIEWED_DECISIONS_SHA256,
  loadForum83ReviewedDecisions,
} from './reviewed-decisions.js';

void describe('forum83 reviewed BaseFish reconciliation', () => {
  void it('pins the reviewed artifact and exact decision counts', () => {
    assert.match(FORUM83_REVIEWED_DECISIONS_SHA256, /^[a-f0-9]{64}$/u);
    const decisions = loadForum83ReviewedDecisions();
    assert.equal(decisions.locationMappings.length, 6);
    assert.equal(decisions.baitMappings.length, 15);
    assert.equal(decisions.embeddedBaseMappings.length, 1);
    assert.equal(decisions.fishMappings.length, 2);
    assert.equal(decisions.baseFishAdditions.length, 7);
    assert.equal(decisions.baseFishRejections.length, 14);
    assert.equal(decisions.rejectedBaitRaw.length, 4);
  });

  void it('requires dry-run or a fingerprint-guarded apply', () => {
    assert.deepEqual(parseForum83BaseFishReconciliationOptions(['--dry-run']), {
      mode: 'dry-run',
    });
    assert.deepEqual(parseForum83BaseFishReconciliationOptions(['--', '--dry-run']), {
      mode: 'dry-run',
    });
    assert.deepEqual(
      parseForum83BaseFishReconciliationOptions([
        '--apply',
        `--expected-fingerprint=${'a'.repeat(64)}`,
      ]),
      { mode: 'apply', expectedFingerprint: 'a'.repeat(64) },
    );
    for (const args of [[], ['--apply'], ['--dry-run', '--apply']]) {
      assert.throws(
        () => parseForum83BaseFishReconciliationOptions(args),
        Forum83BaseFishReconciliationError,
      );
    }
  });
});
