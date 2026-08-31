import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ForumLocalStore } from '../cache.js';
import type { ForumHtmlResponse, ForumHttpCounters } from '../http-client.js';
import { forum83TopicUrl, forum83Url } from './html.js';
import { readForum83TechnicalPosts, scanForum83 } from './scanner.js';
import { FORUM83_LOCAL_ROOT } from './store.js';
import { loadForum83TopicMap } from './topic-map.js';

const temporaryRoots: string[] = [];

after(async () => {
  for (const root of temporaryRoots) await rm(root, { recursive: true, force: true });
});

void describe('forum83 direct-topic scanner', () => {
  void it('uses a physically separate default local root', () => {
    assert.match(FORUM83_LOCAL_ROOT.pathname, /\/rus-fishsoft\/forum83\/$/u);
  });

  void it('validates all 77 direct topics before a bounded topic scan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forum83-scanner-'));
    temporaryRoots.push(root);
    const store = new ForumLocalStore(root);
    const http = fakeHttp([
      response(forum83Url(), approvedIndexHtml()),
      response(
        forum83TopicUrl('357'),
        topicHtml(
          '357',
          'Ахтуба',
          '510',
          '42',
          'Белый амур 14,557 кг. Поймана на Ахтуба: Степной оазис, Помидоры.',
        ),
      ),
    ]);
    const manifest = await scanForum83(
      { mode: 'TOPIC', topicId: '357', limitPosts: 1 },
      http,
      store,
    );

    assert.equal(manifest.topicsDiscovered, 77);
    assert.deepEqual(manifest.scannedTopicIds, ['357']);
    assert.deepEqual(manifest.postIds, ['510']);
    assert.equal(manifest.complete, true);
    assert.equal(manifest.truncated, false);
    assert.deepEqual(http.calls, [forum83Url(), forum83TopicUrl('357')]);
    assert.deepEqual(await readForum83TechnicalPosts(store, ['510']), [
      {
        subforumId: '83',
        topicId: '357',
        postId: '510',
        memberId: '42',
        topicTitle: 'Ахтуба',
        bodyText: 'Белый амур 14,557 кг. Поймана на Ахтуба: Степной оазис, Помидоры.',
      },
    ]);
  });
});

function approvedIndexHtml(): string {
  const rows = loadForum83TopicMap()
    .map.topics.map(
      ({ topicId, topicTitle }) => `
        <li class="ipsDataItem" data-rowid="${topicId}">
          <h4 class="ipsDataItem_title">
            <a data-role="title" href="${forum83TopicUrl(topicId)}">${topicTitle}</a>
          </h4>
        </li>`,
    )
    .join('');
  return `<html><body><h1 class="ipsType_pageTitle">Обсуждение водоемов РР</h1><ol data-role="tableRows">${rows}</ol></body></html>`;
}

function topicHtml(
  topicId: string,
  title: string,
  postId: string,
  memberId: string,
  body: string,
): string {
  return `
    <html><body>
      <nav class="ipsBreadcrumb"><a href="/forum/index.php?/forum/67-root/">Root</a><a href="/forum/index.php?/forum/83-water/">Forum 83</a></nav>
      <h1 class="ipsType_pageTitle">${title}</h1>
      <article id="elComment_${postId}">
        <aside class="cAuthorPane"><a href="/forum/index.php?/profile/${memberId}-member/">Member</a></aside>
        <div class="cPost_contentWrap"><div data-role="commentContent"><p>${body}</p></div></div>
      </article>
      <a href="/forum/index.php?/topic/${topicId}/">Permalink</a>
    </body></html>`;
}

function response(url: string, body: string): ForumHtmlResponse {
  return { body, bodySha256: 'fixture', finalUrl: url, fromCache: false, revalidated: false };
}

function fakeHttp(entries: readonly ForumHtmlResponse[]) {
  const byUrl = new Map(entries.map((entry) => [entry.finalUrl, entry]));
  const calls: string[] = [];
  const counters: ForumHttpCounters = {
    networkRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    revalidated: 0,
    retries: 0,
    rateLimits: 0,
    challenges: 0,
    robotsStatus: 'PARSED_200',
    effectiveDelayMs: 2_000,
  };
  return {
    calls,
    counters,
    getHtml(url: string) {
      calls.push(url);
      const entry = byUrl.get(url);
      if (entry === undefined) throw new Error(`Unexpected URL ${url}`);
      return Promise.resolve(entry);
    },
  };
}
