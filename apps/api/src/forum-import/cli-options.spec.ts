import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ForumCliArgumentError, parseForumCliOptions } from './cli-options.js';

void describe('forum import CLI options', () => {
  void it('supports each universal scan scope and local tuning options', () => {
    assert.deepEqual(parseForumCliOptions(['scan', '--topic-id=9']).scope, {
      mode: 'TOPIC',
      topicId: '9',
      limitPosts: null,
    });
    assert.deepEqual(
      parseForumCliOptions(['scan', '--subforum-id', '70', '--limit-posts=100', '--delay-ms=3000']),
      {
        command: 'scan',
        scope: { mode: 'SUBFORUM', subforumId: '70', limitPosts: 100 },
        delayMs: 3_000,
        rebaseIdentities: false,
      },
    );
    assert.equal(parseForumCliOptions(['scan', '--all']).scope.mode, 'ALL');
    assert.deepEqual(
      parseForumCliOptions(['scan', '--', '--subforum-id=70', '--limit-posts=100']).scope,
      { mode: 'SUBFORUM', subforumId: '70', limitPosts: 100 },
    );
  });

  void it('rejects invalid commands, unsafe delay values, and stage network options', () => {
    for (const arguments_ of [
      [],
      ['crawl', '--all'],
      ['scan', '--all', '--delay-ms=999'],
      ['scan', '--all', '--delay-ms=60001'],
      ['stage', '--all', '--delay-ms=2000'],
      ['scan', '--all', '--rebase-identities'],
      ['audit', '--all', '--rebase-identities'],
      ['stage', '--all', '--rebase-identities=true'],
      ['stage', '--all', '--rebase-identities', '--rebase-identities'],
      ['scan', '--all', '--cache-dir=.local-test'],
    ]) {
      assert.throws(
        () => parseForumCliOptions(arguments_),
        (error: unknown) => error instanceof ForumCliArgumentError,
      );
    }
  });

  void it('accepts the same bounded scope for offline follow-up commands', () => {
    const parsed = parseForumCliOptions(['audit', '--subforum-id=70', '--limit-posts=100']);
    assert.equal(parsed.scope.mode, 'SUBFORUM');
    assert.equal(parsed.scope.limitPosts, 100);
  });

  void it('requires an explicit stage-only flag for a pre-import identity rebase', () => {
    const parsed = parseForumCliOptions([
      'stage',
      '--subforum-id=70',
      '--limit-posts=100',
      '--rebase-identities',
    ]);

    assert.equal(parsed.rebaseIdentities, true);
    assert.equal(parsed.scope.mode, 'SUBFORUM');
  });
});
