import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ForumLocalStore, readJsonFile, sha256Hex } from './cache.js';
import { ForumCheckpointError } from './checkpoint.js';
import type { ForumHtmlResponse, ForumHttpCounters } from './http-client.js';
import { extractEligibleChildForums, extractForumPage, extractTopicPage } from './invision-html.js';
import {
  forumUrl,
  readTechnicalPosts,
  scanForum,
  ForumScannerError,
  topicUrl,
  type ForumScannerHttpClient,
  type TechnicalScanManifest,
} from './scanner.js';
import type { ScanScope } from './scope.js';

const PARENT_HTML = fixture('parent-forum-69.html');
const SUBFORUM_HTML = fixture('subforum-70-page-1.html');
const TOPIC_HTML = fixture('topic-9001-page-1.html');
const PARENT_REQUEST_URL = forumUrl('69');
const PARENT_FINAL_URL = 'https://rus-fishsoft.ru/forum/index.php?/forum/69-fish-discussions/';
const SUBFORUM_FINAL_URL = 'https://rus-fishsoft.ru/forum/index.php?/forum/70-a-b/';
const TOPIC_FINAL_URL = 'https://rus-fishsoft.ru/forum/index.php?/topic/9001-sanitized-fish-one/';
const DISCOVERY = extractEligibleChildForums(PARENT_HTML, PARENT_FINAL_URL);
const FORUM_70_URL = required(DISCOVERY.childForums.find(({ forumId }) => forumId === '70')?.url);
const FORUM_71_URL = required(DISCOVERY.childForums.find(({ forumId }) => forumId === '71')?.url);
const SUBFORUM_PAGE = extractForumPage(SUBFORUM_HTML, SUBFORUM_FINAL_URL, '70');
const FORUM_70_PAGE_2_URL = required(SUBFORUM_PAGE.paginationUrls[0]);
const FORUM_70_PAGE_3_URL = required(SUBFORUM_PAGE.paginationUrls[1]);
const DISCOVERED_TOPIC_9001_URL = required(
  SUBFORUM_PAGE.topics.find(({ topicId }) => topicId === '9001')?.url,
);
const TOPIC_PAGE = extractTopicPage(TOPIC_HTML, TOPIC_FINAL_URL, {
  expectedTopicId: '9001',
  expectedSubforumId: '70',
});
const TOPIC_9001_PAGE_2_URL = required(TOPIC_PAGE.paginationUrls[0]);
const TOPIC_9001_PAGE_3_URL = required(TOPIC_PAGE.paginationUrls[1]);

const temporaryRoots: string[] = [];

after(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

void describe('universal forum scanner', () => {
  void it('scans one verified topic and follows only that topic pagination', async () => {
    const store = await temporaryStore();
    const http = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(topicUrl('9001'), TOPIC_HTML, TOPIC_FINAL_URL),
      response(
        TOPIC_9001_PAGE_2_URL,
        topicPageHtml('70', '9001', [{ postId: '1003', memberId: '42', text: 'Page two' }]),
      ),
      response(
        TOPIC_9001_PAGE_3_URL,
        topicPageHtml('70', '9001', [{ postId: '1004', memberId: null, text: 'Page three' }]),
      ),
    ]);
    http.counters.robotsStatus = 'PARSED_200';
    http.counters.effectiveDelayMs = 3_000;

    const manifest = await scanForum(
      { mode: 'TOPIC', topicId: '9001', limitPosts: null },
      http,
      store,
    );

    assert.equal(manifest.complete, true);
    assert.equal(manifest.truncated, false);
    assert.deepEqual(manifest.scannedSubforumIds, ['70']);
    assert.deepEqual(manifest.topicIds, ['9001']);
    assert.deepEqual(manifest.postIds, ['1001', '1002', '1003', '1004']);
    assert.equal(manifest.http.robotsStatus, 'PARSED_200');
    assert.equal(manifest.http.effectiveDelayMs, 3_000);
    assert.deepEqual(http.calls, [
      PARENT_REQUEST_URL,
      topicUrl('9001'),
      TOPIC_9001_PAGE_2_URL,
      TOPIC_9001_PAGE_3_URL,
    ]);
  });

  void it('rejects topic mode when the topic breadcrumb leaves discovered children', async () => {
    const store = await temporaryStore();
    const http = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(
        topicUrl('9999'),
        topicPageHtml('72', '9999', [{ postId: '1999', memberId: '42', text: 'Out' }]),
      ),
    ]);

    await assert.rejects(
      () => scanForum({ mode: 'TOPIC', topicId: '9999', limitPosts: null }, http, store),
      (error: unknown) => hasScannerCode(error, 'TOPIC_OUT_OF_SCOPE'),
    );
  });

  void it('scans one child subforum and applies a deterministic global post limit', async () => {
    const store = await temporaryStore();
    const emptyForumPage = forumPageHtml('70', []);
    const http = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(FORUM_70_URL, SUBFORUM_HTML, SUBFORUM_FINAL_URL),
      response(FORUM_70_PAGE_2_URL, emptyForumPage),
      response(FORUM_70_PAGE_3_URL, emptyForumPage),
      response(DISCOVERED_TOPIC_9001_URL, TOPIC_HTML, TOPIC_FINAL_URL),
    ]);

    const manifest = await scanForum(
      { mode: 'SUBFORUM', subforumId: '70', limitPosts: 1 },
      http,
      store,
    );

    assert.equal(manifest.truncated, true);
    assert.deepEqual(manifest.scannedSubforumIds, ['70']);
    assert.deepEqual(manifest.topicIds, ['9001', '9002']);
    assert.deepEqual(manifest.postIds, ['1001']);
    assert.equal(http.calls.includes(FORUM_71_URL), false);
    assert.equal(http.calls.includes(DISCOVERED_TOPIC_9001_URL), true);
  });

  void it('discovers and scans every eligible direct child in ALL mode', async () => {
    const store = await temporaryStore();
    const http = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(FORUM_70_URL, forumPageHtml('70', ['9001'])),
      response(FORUM_71_URL, forumPageHtml('71', ['9101'])),
      response(
        topicUrl('9001'),
        topicPageHtml('70', '9001', [{ postId: '2001', memberId: '42', text: 'First child' }]),
      ),
      response(
        topicUrl('9101'),
        topicPageHtml('71', '9101', [{ postId: '2101', memberId: '43', text: 'Second child' }]),
      ),
    ]);

    const manifest = await scanForum(
      { mode: 'ALL', parentForumId: '69', limitPosts: null },
      http,
      store,
    );

    assert.equal(manifest.complete, true);
    assert.equal(manifest.truncated, false);
    assert.deepEqual(manifest.eligibleSubforumIds, ['70', '71']);
    assert.deepEqual(manifest.scannedSubforumIds, ['70', '71']);
    assert.deepEqual(manifest.topicIds, ['9001', '9101']);
    assert.deepEqual(manifest.postIds, ['2001', '2101']);
    assert.deepEqual(http.calls, [
      PARENT_REQUEST_URL,
      FORUM_70_URL,
      FORUM_71_URL,
      topicUrl('9001'),
      topicUrl('9101'),
    ]);
  });

  void it('resumes an incomplete checkpoint without rescanning completed child pages', async () => {
    const store = await temporaryStore();
    const scope: ScanScope = { mode: 'SUBFORUM', subforumId: '70', limitPosts: null };
    const firstHttp = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(FORUM_70_URL, forumPageHtml('70', ['9001'])),
      failure(topicUrl('9001'), 'simulated interruption'),
    ]);
    firstHttp.counters.cacheHits = 1;
    firstHttp.counters.cacheMisses = 2;
    firstHttp.counters.challenges = 1;
    firstHttp.counters.robotsStatus = 'PARSED_200';
    firstHttp.counters.effectiveDelayMs = 3_000;

    await assert.rejects(() => scanForum(scope, firstHttp, store), /simulated interruption/);

    const interruptedManifest = await readJsonFile<TechnicalScanManifest>(
      join(store.outputDirectory('subforum-70'), 'technical', 'scan.json'),
    );
    assert.equal(interruptedManifest?.complete, false);
    assert.deepEqual(interruptedManifest?.completedPageUrls, [PARENT_REQUEST_URL, FORUM_70_URL]);
    assert.equal(interruptedManifest?.http.networkRequests, 3);
    assert.equal(interruptedManifest?.http.cacheHits, 1);
    assert.equal(interruptedManifest?.http.cacheMisses, 2);
    assert.equal(interruptedManifest?.http.challenges, 1);
    assert.equal(interruptedManifest?.http.robotsStatus, 'PARSED_200');
    assert.equal(interruptedManifest?.http.effectiveDelayMs, 3_000);

    const resumedHttp = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(
        topicUrl('9001'),
        topicPageHtml('70', '9001', [{ postId: '3001', memberId: '42', text: 'Resumed' }]),
      ),
    ]);
    const manifest = await scanForum(scope, resumedHttp, store);

    assert.equal(manifest.complete, true);
    assert.deepEqual(manifest.postIds, ['3001']);
    assert.deepEqual(resumedHttp.calls, [PARENT_REQUEST_URL, topicUrl('9001')]);
  });

  void it('stops an incomplete resume when eligible-child discovery drifts', async () => {
    const store = await temporaryStore();
    const scope: ScanScope = { mode: 'SUBFORUM', subforumId: '70', limitPosts: null };
    const firstHttp = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      failure(FORUM_70_URL, 'simulated interruption'),
    ]);
    await assert.rejects(() => scanForum(scope, firstHttp, store), /simulated interruption/);

    const changedParent = parentPageHtml(['70']);
    const resumedHttp = fakeHttp([response(PARENT_REQUEST_URL, changedParent, PARENT_FINAL_URL)]);
    await assert.rejects(
      () => scanForum(scope, resumedHttp, store),
      (error: unknown) => error instanceof ForumCheckpointError && error.code === 'SCOPE_DRIFT',
    );
    assert.deepEqual(resumedHttp.calls, [PARENT_REQUEST_URL]);
  });

  void it('stops when a stable post ID is reassigned to another member', async () => {
    const store = await temporaryStore();
    const scope: ScanScope = { mode: 'TOPIC', topicId: '9001', limitPosts: null };
    const firstHttp = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(
        topicUrl('9001'),
        topicPageHtml('70', '9001', [{ postId: '4001', memberId: '42', text: 'Stable' }]),
      ),
    ]);
    await scanForum(scope, firstHttp, store);

    const changedIdentityHttp = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(
        topicUrl('9001'),
        topicPageHtml('70', '9001', [{ postId: '4001', memberId: '43', text: 'Stable' }]),
      ),
    ]);
    await assert.rejects(
      () => scanForum(scope, changedIdentityHttp, store),
      (error: unknown) => hasScannerCode(error, 'IDENTITY_DRIFT'),
    );
  });

  void it('pins the first source snapshot and reports later source changes', async () => {
    const store = await temporaryStore();
    const scope: ScanScope = { mode: 'TOPIC', topicId: '9001', limitPosts: null };
    await scanForum(
      scope,
      fakeHttp([
        response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
        response(
          topicUrl('9001'),
          topicPageHtml('70', '9001', [{ postId: '5001', memberId: '42', text: 'Pinned source' }]),
        ),
      ]),
      store,
    );

    const changed = await scanForum(
      scope,
      fakeHttp([
        response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
        response(
          topicUrl('9001'),
          topicPageHtml('70', '9001', [{ postId: '5001', memberId: '42', text: 'Edited source' }]),
        ),
      ]),
      store,
    );

    assert.deepEqual(changed.sourceChangedPostIds, ['5001']);
    assert.equal((await readTechnicalPosts(store, ['5001']))[0]?.bodyText, 'Pinned source');
  });

  void it('invalidates a completed manifest before starting a rerun', async () => {
    const store = await temporaryStore();
    const scope: ScanScope = { mode: 'TOPIC', topicId: '9001', limitPosts: null };
    await scanForum(
      scope,
      fakeHttp([
        response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
        response(
          topicUrl('9001'),
          topicPageHtml('70', '9001', [{ postId: '6001', memberId: '42', text: 'Complete' }]),
        ),
      ]),
      store,
    );

    await assert.rejects(
      scanForum(
        scope,
        fakeHttp([
          response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
          failure(topicUrl('9001'), 'rerun interrupted'),
        ]),
        store,
      ),
      /rerun interrupted/u,
    );
    const manifest = await readJsonFile<TechnicalScanManifest>(
      join(store.outputDirectory('topic-9001'), 'technical', 'scan.json'),
    );
    assert.equal(manifest?.complete, false);
  });

  void it('applies a post limit to page 2 before page 10', async () => {
    const store = await temporaryStore();
    const pageTwo = 'https://rus-fishsoft.ru/forum/index.php?/topic/9001/page/2/';
    const pageTen = 'https://rus-fishsoft.ru/forum/index.php?/topic/9001/page/10/';
    const firstPage = topicPageHtml('70', '9001', [
      { postId: '7001', memberId: '42', text: 'First page' },
    ]).replace(
      '</h1>',
      `</h1><nav data-role="pagination"><a href="${pageTen}">10</a><a href="${pageTwo}">2</a></nav>`,
    );
    const http = fakeHttp([
      response(PARENT_REQUEST_URL, PARENT_HTML, PARENT_FINAL_URL),
      response(topicUrl('9001'), firstPage),
      response(
        pageTwo,
        topicPageHtml('70', '9001', [{ postId: '7002', memberId: '42', text: 'Second page' }]),
      ),
      response(
        pageTen,
        topicPageHtml('70', '9001', [{ postId: '7010', memberId: '42', text: 'Tenth page' }]),
      ),
    ]);

    const manifest = await scanForum(
      { mode: 'TOPIC', topicId: '9001', limitPosts: 2 },
      http,
      store,
    );
    assert.deepEqual(manifest.postIds, ['7001', '7002']);
    assert.equal(http.calls.includes(pageTen), false);
  });
});

interface FakeEntry {
  url: string;
  body?: string;
  finalUrl?: string;
  error?: Error;
}

class FakeHttpClient implements ForumScannerHttpClient {
  readonly counters: ForumHttpCounters = {
    networkRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    revalidated: 0,
    retries: 0,
    rateLimits: 0,
    challenges: 0,
    robotsStatus: 'NOT_CHECKED',
    effectiveDelayMs: 2_000,
  };
  readonly calls: string[] = [];
  private readonly entries: Map<string, FakeEntry>;

  constructor(entries: readonly FakeEntry[]) {
    this.entries = new Map(entries.map((entry) => [entry.url, entry]));
  }

  getHtml(url: string): Promise<ForumHtmlResponse> {
    this.calls.push(url);
    this.counters.networkRequests += 1;
    const entry = this.entries.get(url);
    if (entry === undefined) {
      return Promise.reject(new Error(`Unexpected fake HTTP request: ${url}`));
    }
    if (entry.error !== undefined) {
      return Promise.reject(entry.error);
    }

    const body = required(entry.body);
    return Promise.resolve({
      body,
      bodySha256: sha256Hex(body),
      finalUrl: entry.finalUrl ?? url,
      fromCache: false,
      revalidated: false,
    });
  }
}

function fakeHttp(entries: readonly FakeEntry[]): FakeHttpClient {
  return new FakeHttpClient(entries);
}

function response(url: string, body: string, finalUrl = url): FakeEntry {
  return { url, body, finalUrl };
}

function failure(url: string, message: string): FakeEntry {
  return { url, error: new Error(message) };
}

async function temporaryStore(): Promise<ForumLocalStore> {
  const root = await mkdtemp(join(tmpdir(), 'fishing-db-forum-scanner-'));
  temporaryRoots.push(root);
  return new ForumLocalStore(root);
}

function parentPageHtml(childIds: readonly string[]): string {
  return `
    <h1 data-role="pageTitle">Sanitized fish discussions</h1>
    <ol data-role="forums" data-parent-forum-id="69">
      ${childIds
        .map(
          (forumId) => `
            <li class="cForumRow" data-forumid="${forumId}" data-parent-forum-id="69">
              <a href="/forum/index.php?/forum/${forumId}/">Child ${forumId}</a>
            </li>`,
        )
        .join('')}
    </ol>`;
}

function forumPageHtml(forumId: string, topicIds: readonly string[]): string {
  return `
    <nav data-role="breadcrumb">
      <a href="/forum/index.php?/forum/69/">Parent</a>
      <span>Child ${forumId}</span>
    </nav>
    <h1 data-role="pageTitle">Child ${forumId}</h1>
    <ol data-role="tableRows">
      ${topicIds
        .map(
          (topicId) => `
            <li data-rowid="${topicId}">
              <a href="/forum/index.php?/topic/${topicId}/">Topic ${topicId}</a>
            </li>`,
        )
        .join('')}
    </ol>`;
}

function topicPageHtml(
  forumId: string,
  topicId: string,
  posts: ReadonlyArray<{ postId: string; memberId: string | null; text: string }>,
): string {
  return `
    <nav data-role="breadcrumb">
      <a href="/forum/index.php?/forum/69/">Parent</a>
      <a href="/forum/index.php?/forum/${forumId}/">Child ${forumId}</a>
    </nav>
    <h1 data-role="pageTitle">Topic ${topicId}</h1>
    ${posts
      .map(
        ({ postId, memberId, text }) => `
          <article id="elComment_${postId}" data-commentid="${postId}">
            <aside class="cAuthorPane">
              ${
                memberId === null
                  ? '<span>Display name only</span>'
                  : `<a href="/forum/index.php?/profile/${memberId}-member/">Member</a>`
              }
            </aside>
            <div data-role="commentContent"><p>${text}</p></div>
          </article>`,
      )
      .join('')}`;
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Required test fixture value is missing');
  }
  return value;
}

function hasScannerCode(error: unknown, code: string): boolean {
  return error instanceof ForumScannerError && error.code === code;
}
