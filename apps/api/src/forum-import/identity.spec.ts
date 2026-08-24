import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalizeExternalNumericId,
  deriveExternalContributorKey,
  deriveExternalImportKey,
} from './identity.js';

void describe('rus-fishsoft external identities', () => {
  void it('canonicalizes positive decimal IDs without Number conversion', () => {
    assert.equal(canonicalizeExternalNumericId('000123'), '123');
    assert.equal(
      canonicalizeExternalNumericId('999999999999999999999999999999999999'),
      '999999999999999999999999999999999999',
    );
  });

  void it('rejects non-decimal and nonpositive IDs', () => {
    for (const value of ['', '0', '-1', '+1', ' 1', '1 ', '1e2', '0x10', '12.3']) {
      assert.throws(() => canonicalizeExternalNumericId(value), value);
    }
  });

  void it('derives opaque keys from the versioned source identity payloads', () => {
    assert.equal(
      deriveExternalContributorKey('000123'),
      'external:rus-fishsoft:member:v1:2b6c2447c56067a7607dde943df7dbcdfb64c4fcb26811e5d07170e6e49dce5a',
    );
    assert.equal(
      deriveExternalImportKey('000456', 2),
      'external:rus-fishsoft:observation:v1:a2417e7331cf7d8faaeee37fb544e1063c033cb4590a5bc492731a5d9d456284',
    );
  });

  void it('keeps candidate ordinals distinct and validates them', () => {
    assert.notEqual(deriveExternalImportKey('456', 1), deriveExternalImportKey('456', 2));

    for (const ordinal of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => deriveExternalImportKey('456', ordinal), RangeError);
    }
  });
});
