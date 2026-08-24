import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  extractEligibleChildForums,
  extractForumPage,
  extractTopicPage,
  ForumHtmlStructureError,
  getForumIdFromUrl,
  getTopicIdFromUrl,
} from './invision-html.js';

const PARENT_HTML = fixture('parent-forum-69.html');
const PARENT_INDEX_HTML = fixture('parent-forum-69-index.html');
const SUBFORUM_HTML = fixture('subforum-70-page-1.html');
const TOPIC_HTML = fixture('topic-9001-page-1.html');
const PARENT_URL = 'https://rus-fishsoft.ru/forum/index.php?/forum/69-fish-discussions/';
const SUBFORUM_URL = 'https://rus-fishsoft.ru/forum/index.php?/forum/70-a-b/';
const TOPIC_URL = 'https://rus-fishsoft.ru/forum/index.php?/topic/9001-sanitized-fish-one/';

void describe('Invision forum HTML extraction', () => {
  void it('discovers only eligible direct child forums and sorts numeric IDs stably', () => {
    const page = extractEligibleChildForums(PARENT_HTML, PARENT_URL);

    assert.equal(page.parentForumId, '69');
    assert.equal(page.title, 'Fish discussions');
    assert.deepEqual(
      page.childForums.map(({ forumId, title }) => ({ forumId, title })),
      [
        { forumId: '70', title: 'A–B' },
        { forumId: '71', title: 'C–D' },
      ],
    );
    assert.equal(
      page.childForums.some(({ forumId }) => forumId === '700'),
      false,
    );
    assert.equal(
      page.childForums.some(({ forumId }) => forumId === '72'),
      false,
    );
    assert.equal(
      page.childForums.some(({ forumId }) => forumId === '73'),
      false,
    );
  });

  void it('discovers children from the unique parent row on a multi-category IPS index', () => {
    const page = extractEligibleChildForums(PARENT_INDEX_HTML, PARENT_URL);

    assert.equal(page.title, 'Sanitized fish parent');
    assert.deepEqual(
      page.childForums.map(({ forumId, title }) => ({ forumId, title })),
      [
        { forumId: '70', title: 'Sanitized A–B' },
        { forumId: '71', title: 'Sanitized C–D' },
      ],
    );
  });

  void it('extracts forum pagination and deduplicated topics in numeric order', () => {
    const page = extractForumPage(SUBFORUM_HTML, SUBFORUM_URL, '00070');

    assert.equal(page.forumId, '70');
    assert.equal(page.parentForumId, '69');
    assert.deepEqual(
      page.topics.map(({ topicId, title }) => ({ topicId, title })),
      [
        { topicId: '9001', title: 'Sanitized fish one' },
        { topicId: '9002', title: 'Sanitized fish two' },
      ],
    );
    assert.deepEqual(page.paginationUrls, [
      'https://rus-fishsoft.ru/forum/index.php?/forum/70-a-b/page/2/',
      'https://rus-fishsoft.ru/forum/index.php?/forum/70-a-b/page/3/',
    ]);
  });

  void it('extracts multiple stable posts, profile URL identities, and clean author text', () => {
    const page = extractTopicPage(TOPIC_HTML, TOPIC_URL, {
      expectedTopicId: '09001',
      expectedSubforumId: '070',
    });

    assert.equal(page.subforumId, '70');
    assert.equal(page.topicId, '9001');
    assert.deepEqual(page.posts, [
      {
        postId: '1001',
        memberId: '42',
        authorText: [
          'Fish: sanitized carp',
          'Base: sanitized lake',
          'Location: number 1',
          '6,00 left edge',
          'cast from the hill 6.76',
        ].join('\n'),
      },
      {
        postId: '1002',
        memberId: null,
        authorText: ['Second observation', 'Depth 12,22', 'left of tackle box'].join('\n'),
      },
    ]);
    assert.equal(page.posts[0]?.authorText.includes('Quoted catch'), false);
    assert.equal(page.posts[0]?.authorText.includes('Signature catch'), false);
    assert.equal(page.posts[0]?.authorText.includes('Reaction metadata'), false);
    assert.equal(page.posts[0]?.authorText.includes('Edited metadata'), false);
    assert.deepEqual(page.paginationUrls, [
      'https://rus-fishsoft.ru/forum/index.php?/topic/09001-sanitized-fish-one/page/2/',
      'https://rus-fishsoft.ru/forum/index.php?/topic/9001-sanitized-fish-one/page/3/',
    ]);
  });

  void it('fails closed for foreign origins and nested or mismatched breadcrumb scope', () => {
    assert.throws(
      () =>
        extractEligibleChildForums(
          PARENT_HTML,
          'https://unrelated.example/forum/index.php?/forum/69-fish-discussions/',
        ),
      (error: unknown) => hasStructureCode(error, 'INVALID_SOURCE_URL'),
    );

    const nestedForumHtml = `
      <nav data-role="breadcrumb">
        <a href="/forum/index.php?/forum/69-parent/">Parent</a>
        <a href="/forum/index.php?/forum/70-child/">Child</a>
      </nav>
      <h1>Nested</h1>
      <ol data-role="tableRows"></ol>
    `;
    assert.throws(
      () =>
        extractForumPage(
          nestedForumHtml,
          'https://rus-fishsoft.ru/forum/index.php?/forum/71-nested/',
          '71',
        ),
      (error: unknown) => hasStructureCode(error, 'BREADCRUMB_OUT_OF_SCOPE'),
    );

    assert.throws(
      () =>
        extractTopicPage(TOPIC_HTML, TOPIC_URL, {
          expectedTopicId: '9001',
          expectedSubforumId: '71',
        }),
      (error: unknown) => hasStructureCode(error, 'BREADCRUMB_OUT_OF_SCOPE'),
    );
  });

  void it('rejects an external topic row instead of emitting an out-of-origin URL', () => {
    const html = `
      <nav data-role="breadcrumb">
        <a href="/forum/index.php?/forum/69-parent/">Parent</a>
      </nav>
      <h1>Child</h1>
      <ol data-role="tableRows">
        <li data-rowid="9001">
          <a href="https://unrelated.example/topic/9001-external/">External topic</a>
        </li>
      </ol>
    `;
    assert.throws(
      () => extractForumPage(html, SUBFORUM_URL, '70'),
      (error: unknown) => hasStructureCode(error, 'INVALID_TOPIC_ROW'),
    );
  });

  void it('recognizes modern and legacy numeric forum/topic URL families only on source origin', () => {
    assert.equal(getForumIdFromUrl('/forum/index.php?showforum=00070'), '70');
    assert.equal(getTopicIdFromUrl('/forum/index.php?/topic/0009001-name/'), '9001');
    assert.equal(getForumIdFromUrl('https://unrelated.example/forum/70-name/'), null);
    assert.equal(getTopicIdFromUrl('/forum/index.php?/profile/9001-name/'), null);
  });
});

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function hasStructureCode(error: unknown, code: string): boolean {
  return error instanceof ForumHtmlStructureError && error.code === code;
}
