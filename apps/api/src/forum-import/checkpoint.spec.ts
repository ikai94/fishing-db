import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import {
  assertNoScopeDrift,
  completeQueueItem,
  createCheckpoint,
  enqueue,
  ForumCheckpointError,
  loadCheckpoint,
  saveCheckpoint,
} from './checkpoint.js';

void describe('forum scan checkpoints', () => {
  void it('sorts work deterministically and keeps scopes isolated', async () => {
    const scope = { mode: 'SUBFORUM', subforumId: '70', limitPosts: null } as const;
    const checkpoint = createCheckpoint(
      scope,
      'one',
      ['72', '70'],
      [
        { kind: 'TOPIC_PAGE', subforumId: '70', topicId: '11', url: 'https://source/topic/11' },
        { kind: 'SUBFORUM_PAGE', subforumId: '70', url: 'https://source/forum/70' },
        { kind: 'TOPIC_PAGE', subforumId: '70', topicId: '2', url: 'https://source/topic/2' },
      ],
    );
    assert.deepEqual(checkpoint.eligibleSubforumIds, ['70', '72']);
    assert.deepEqual(
      checkpoint.pending.map((item) => item.url),
      ['https://source/forum/70', 'https://source/topic/2', 'https://source/topic/11'],
    );

    const root = await mkdtemp(join(tmpdir(), 'forum-checkpoint-'));
    const path = join(root, 'checkpoint.json');
    await saveCheckpoint(path, checkpoint);
    assert.deepEqual(await loadCheckpoint(path, scope), checkpoint);
    await assert.rejects(
      loadCheckpoint(path, { mode: 'TOPIC', topicId: '2', limitPosts: null }),
      (error: unknown) => error instanceof ForumCheckpointError && error.code === 'SCOPE_MISMATCH',
    );
  });

  void it('detects changed parent discovery while preserving pending work', () => {
    const checkpoint = createCheckpoint(
      { mode: 'ALL', parentForumId: '69', limitPosts: null },
      'one',
      ['70', '71'],
      [],
    );
    assert.throws(
      () => assertNoScopeDrift(checkpoint, 'two', ['70', '71']),
      (error: unknown) => error instanceof ForumCheckpointError && error.code === 'SCOPE_DRIFT',
    );
    assert.throws(
      () => assertNoScopeDrift(checkpoint, 'one', ['70', '72']),
      (error: unknown) => error instanceof ForumCheckpointError && error.code === 'SCOPE_DRIFT',
    );
  });

  void it('deduplicates enqueued and completed URLs', () => {
    const checkpoint = createCheckpoint(
      { mode: 'TOPIC', topicId: '2', limitPosts: null },
      'one',
      ['70'],
      [],
    );
    const item = {
      kind: 'TOPIC_PAGE',
      subforumId: '70',
      topicId: '2',
      url: 'https://source/topic/2',
    } as const;
    enqueue(checkpoint, [item, item]);
    assert.equal(checkpoint.pending.length, 1);
    completeQueueItem(checkpoint, item);
    enqueue(checkpoint, [item]);
    assert.equal(checkpoint.pending.length, 0);
    assert.equal(checkpoint.pagesScanned, 1);
  });

  void it('orders pagination numerically instead of lexicographically', () => {
    const checkpoint = createCheckpoint(
      { mode: 'TOPIC', topicId: '2', limitPosts: 1 },
      'one',
      ['70'],
      [
        {
          kind: 'TOPIC_PAGE',
          subforumId: '70',
          topicId: '2',
          url: 'https://source/topic/2/page/10/',
        },
        {
          kind: 'TOPIC_PAGE',
          subforumId: '70',
          topicId: '2',
          url: 'https://source/topic/2/page/2/',
        },
      ],
    );

    assert.deepEqual(
      checkpoint.pending.map((item) => item.url),
      ['https://source/topic/2/page/2/', 'https://source/topic/2/page/10/'],
    );
  });
});
