import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalizePositiveDecimalId,
  compareCanonicalIds,
  getScopeKey,
  parseScanScopeArgs,
  ScanScopeArgumentError,
} from './scope.js';

void describe('forum scan scope', () => {
  void it('canonicalizes positive decimal IDs without Number precision loss', () => {
    assert.equal(canonicalizePositiveDecimalId('00070'), '70');
    assert.equal(canonicalizePositiveDecimalId('900719925474099312345'), '900719925474099312345');
    assert.throws(() => canonicalizePositiveDecimalId('0'), ScanScopeArgumentError);
    assert.throws(() => canonicalizePositiveDecimalId('-70'), ScanScopeArgumentError);
    assert.throws(() => canonicalizePositiveDecimalId('7.0'), ScanScopeArgumentError);
    assert.throws(() => canonicalizePositiveDecimalId(' 70'), ScanScopeArgumentError);
  });

  void it('parses TOPIC, SUBFORUM, and ALL modes with optional positive limits', () => {
    assert.deepEqual(parseScanScopeArgs(['--topic-id=0009001']), {
      mode: 'TOPIC',
      topicId: '9001',
      limitPosts: null,
    });
    assert.deepEqual(parseScanScopeArgs(['--subforum-id', '00070', '--limit-posts', '100']), {
      mode: 'SUBFORUM',
      subforumId: '70',
      limitPosts: 100,
    });
    assert.deepEqual(parseScanScopeArgs(['--all', '--limit-posts=25']), {
      mode: 'ALL',
      parentForumId: '69',
      limitPosts: 25,
    });
  });

  void it('requires exactly one mode and rejects unknown, duplicate, or invalid options', () => {
    const invalidArguments = [
      [],
      ['--all', '--topic-id=1'],
      ['--subforum-id=70', '--subforum-id=71'],
      ['--all=true'],
      ['--topic-id'],
      ['--subforum-id=0'],
      ['--all', '--limit-posts=0'],
      ['--all', '--limit-posts=1.5'],
      ['--all', `--limit-posts=${BigInt(Number.MAX_SAFE_INTEGER) + 1n}`],
      ['--all', '--unknown=value'],
      ['positional'],
    ];

    for (const arguments_ of invalidArguments) {
      assert.throws(() => parseScanScopeArgs(arguments_), ScanScopeArgumentError);
    }
  });

  void it('builds isolated deterministic scope keys', () => {
    assert.equal(getScopeKey({ mode: 'TOPIC', topicId: '9001', limitPosts: null }), 'topic-9001');
    assert.equal(
      getScopeKey({ mode: 'SUBFORUM', subforumId: '70', limitPosts: 100 }),
      'subforum-70-limit-100',
    );
    assert.equal(
      getScopeKey({ mode: 'ALL', parentForumId: '69', limitPosts: null }),
      'all-parent-69',
    );
  });

  void it('orders canonical IDs numerically, including IDs beyond Number safety', () => {
    const ids = ['90071992547409930000', '71', '90071992547409929999', '7'];
    ids.sort(compareCanonicalIds);
    assert.deepEqual(ids, ['7', '71', '90071992547409929999', '90071992547409930000']);
  });
});
