import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { forum83ScopeKey, Forum83ScopeArgumentError, parseForum83Scope } from './scope.js';

void describe('forum83 scan scope', () => {
  void it('keeps forum83 ALL separate from forum69 and supports bounded topics', () => {
    assert.deepEqual(parseForum83Scope(['--all']), {
      mode: 'ALL',
      forumId: '83',
      limitPosts: null,
    });
    assert.deepEqual(parseForum83Scope(['--topic-id=000357', '--limit-posts=8']), {
      mode: 'TOPIC',
      topicId: '357',
      limitPosts: 8,
    });
    assert.equal(
      forum83ScopeKey({ mode: 'ALL', forumId: '83', limitPosts: null }),
      'forum83-all-forum-83',
    );
    assert.equal(
      forum83ScopeKey({ mode: 'TOPIC', topicId: '357', limitPosts: 8 }),
      'forum83-topic-357-limit-8',
    );
  });

  void it('rejects forum69 subforum semantics and invalid combinations', () => {
    for (const arguments_ of [
      [],
      ['--all', '--topic-id=357'],
      ['--subforum-id=70'],
      ['--all=true'],
      ['--topic-id=0'],
      ['--topic-id=357', '--limit-posts=0'],
    ]) {
      assert.throws(() => parseForum83Scope(arguments_), Forum83ScopeArgumentError);
    }
  });
});
