import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ForumLocalStore, writeJsonAtomic } from './cache.js';
import { ForumPipelineError, runForumCli } from './cli.js';

void describe('forum pipeline CLI', () => {
  void it('reads deterministic audit and review artifacts without network or database access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cli-'));
    const store = new ForumLocalStore(root);
    const output = store.outputDirectory('topic-9');
    await writeJsonAtomic(join(output, 'audit', 'audit.json'), {
      version: 1,
      candidatesExtracted: 2,
    });
    await writeJsonAtomic(join(output, 'review', 'review.json'), {
      version: 1,
      unresolved: [],
      multiCandidatePosts: [],
      usableSample: [],
      noCatchDataSample: [],
    });

    assert.deepEqual(await runForumCli(['audit', '--topic-id=9'], {}, store), {
      version: 1,
      candidatesExtracted: 2,
    });
    const review = await runForumCli(['review', '--topic-id=9'], {}, store);
    assert.equal(
      (review as { technicalPostsFile: string }).technicalPostsFile,
      join(output, 'review', 'posts.jsonl'),
    );
  });

  void it('fails stage before opening a database when its scan artifact is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cli-'));
    const store = new ForumLocalStore(root);
    await assert.rejects(
      runForumCli(['stage', '--topic-id=9'], {}, store),
      (error: unknown) => error instanceof ForumPipelineError && error.code === 'ARTIFACT_INVALID',
    );
  });

  void it('blocks staging when a later crawl changed a pinned source post', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum-cli-'));
    const store = new ForumLocalStore(root);
    await writeJsonAtomic(join(store.outputDirectory('topic-9'), 'technical', 'scan.json'), {
      version: 1,
      scope: { mode: 'TOPIC', topicId: '9', limitPosts: null },
      scopeKey: 'topic-9',
      parentForumId: '69',
      discoveryFingerprint: 'fixture',
      eligibleSubforumIds: ['70'],
      scannedSubforumIds: ['70'],
      topicIds: ['9'],
      postIds: ['10'],
      sourceChangedPostIds: ['10'],
      discoveredPageUrls: [],
      completedPageUrls: [],
      complete: true,
      truncated: false,
      http: {
        networkRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        revalidated: 0,
        retries: 0,
        rateLimits: 0,
        challenges: 0,
        robotsStatus: 'PARSED_200',
        effectiveDelayMs: 2_000,
      },
    });

    for (const arguments_ of [
      ['stage', '--topic-id=9'],
      ['stage', '--topic-id=9', '--rebase-identities'],
    ]) {
      await assert.rejects(
        runForumCli(arguments_, {}, store),
        (error: unknown) => error instanceof ForumPipelineError && error.code === 'IDENTITY_DRIFT',
      );
    }
  });

  void it('rejects partial recovery scopes before opening the database or network', async () => {
    for (const arguments_ of [
      ['recover-fish-catalog', '--topic-id=9', '--dry-run'],
      ['recover-fish-catalog', '--subforum-id=70', '--dry-run'],
      ['recover-fish-catalog', '--all', '--limit-posts=100', '--dry-run'],
    ]) {
      await assert.rejects(
        runForumCli(arguments_, {}, new ForumLocalStore('/missing-offline-recovery-cache')),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'FORUM_FISH_CATALOG_RECOVERY_BLOCKED',
      );
    }
  });
});
