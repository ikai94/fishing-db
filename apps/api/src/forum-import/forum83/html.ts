import { load, type CheerioAPI } from 'cheerio';
import type { TechnicalForumPost } from '../candidate-types.js';
import { canonicalizeExternalNumericId } from '../identity.js';
import { getForumIdFromUrl, getTopicIdFromUrl } from '../invision-html.js';
import { compareCanonicalIds } from '../scope.js';
import { FORUM83_ID, FORUM83_SOURCE_ORIGIN } from './constants.js';

export interface Forum83TopicReference {
  topicId: string;
  title: string;
  url: string;
}

export interface Forum83IndexPage {
  forumId: typeof FORUM83_ID;
  title: string;
  topics: Forum83TopicReference[];
  paginationUrls: string[];
}

export interface Forum83TopicPage {
  forumId: typeof FORUM83_ID;
  topicId: string;
  title: string;
  posts: TechnicalForumPost[];
  paginationUrls: string[];
}

export class Forum83HtmlError extends Error {
  readonly code = 'FORUM83_HTML_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83HtmlError';
  }
}

const TOPIC_LIST_SELECTOR =
  '[data-role="topicList"], [data-role="topic-list"], [data-role="tableRows"], .cTopicList, .cForumTopicTable';
const POST_SELECTOR =
  'article[data-commentid], article[data-comment-id], article[id^="elComment_"], [data-role="post"][data-post-id]';

export function forum83Url(): string {
  return new URL(
    `/forum/index.php?/forum/${FORUM83_ID}-\u043e\u0431\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u0435-\u0432\u043e\u0434\u043e\u0435\u043c\u043e\u0432-\u0440\u0440/`,
    FORUM83_SOURCE_ORIGIN,
  ).href;
}

export function forum83TopicUrl(topicId: string): string {
  const canonical = canonicalizeExternalNumericId(topicId);
  return new URL(`/forum/index.php?/topic/${canonical}/`, FORUM83_SOURCE_ORIGIN).href;
}

export function extractForum83IndexPage(html: string, pageUrl: string): Forum83IndexPage {
  const sourceUrl = sourcePageUrl(pageUrl);
  if (getForumIdFromUrl(sourceUrl) !== FORUM83_ID) invalid('Index URL is not forum 83');
  const query = load(html);
  const title = pageTitle(query);
  const topics = new Map<string, Forum83TopicReference>();
  const containers = query(TOPIC_LIST_SELECTOR).filter(
    (_index, element) => query(element).parents(TOPIC_LIST_SELECTOR).length === 0,
  );
  if (containers.length === 0) invalid('Forum 83 page has no topic-list container');

  containers.each((_containerIndex, containerElement) => {
    query(containerElement)
      .children()
      .filter((_rowIndex, element) => {
        const row = query(element);
        return (
          row.attr('data-topic-id') !== undefined ||
          row.attr('data-topicid') !== undefined ||
          row.attr('data-rowid') !== undefined ||
          row.is('.cTopicRow, .ipsDataItem')
        );
      })
      .each((_rowIndex, rowElement) => {
        const row = query(rowElement);
        const rawDeclaredId =
          row.attr('data-topic-id') ?? row.attr('data-topicid') ?? row.attr('data-rowid');
        const declaredId =
          rawDeclaredId === undefined ? null : canonicalizeExternalNumericId(rawDeclaredId);
        const link = row.find('a[data-role="title"][href], .ipsDataItem_title a[href]').first();
        const resolved = containedUrl(link.attr('href'), sourceUrl);
        const topicId = resolved === null ? null : getTopicIdFromUrl(resolved);
        const topicTitle = normalizeInlineText(link.text());
        if (
          resolved === null ||
          topicId === null ||
          (declaredId !== null && declaredId !== topicId) ||
          topicTitle.length === 0
        ) {
          invalid(`Forum 83 topic row ${declaredId ?? '(unknown)'} is invalid`);
        }
        const reference = { topicId, title: topicTitle, url: canonicalUrl(resolved) };
        const existing = topics.get(topicId);
        if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(reference)) {
          invalid(`Forum 83 topic ${topicId} appears with conflicting metadata`);
        }
        topics.set(topicId, existing ?? reference);
      });
  });

  return {
    forumId: FORUM83_ID,
    title,
    topics: [...topics.values()].sort((left, right) =>
      compareCanonicalIds(left.topicId, right.topicId),
    ),
    paginationUrls: paginationUrls(query, sourceUrl, 'forum', FORUM83_ID),
  };
}

export function extractForum83TopicPage(
  html: string,
  pageUrl: string,
  expectedTopicId: string,
): Forum83TopicPage {
  const topicId = canonicalizeExternalNumericId(expectedTopicId);
  const sourceUrl = sourcePageUrl(pageUrl);
  if (getTopicIdFromUrl(sourceUrl) !== topicId) invalid(`URL is not topic ${topicId}`);
  const query = load(html);
  const breadcrumbForums: string[] = [];
  query('.ipsBreadcrumb, [data-role="breadcrumbList"]')
    .first()
    .find('a[href]')
    .each((_index, element) => {
      const resolved = containedUrl(query(element).attr('href'), sourceUrl);
      const forumId = resolved === null ? null : getForumIdFromUrl(resolved);
      if (forumId !== null && breadcrumbForums.at(-1) !== forumId) breadcrumbForums.push(forumId);
    });
  if (breadcrumbForums.at(-1) !== FORUM83_ID) {
    invalid(`Topic ${topicId} is not directly in forum 83`);
  }
  const title = pageTitle(query);
  const posts = new Map<string, TechnicalForumPost>();
  const articles = query(POST_SELECTOR).filter(
    (_index, element) => query(element).parents(POST_SELECTOR).length === 0,
  );
  if (articles.length === 0) invalid(`Topic ${topicId} has no stable posts`);

  articles.each((_index, element) => {
    const article = query(element);
    const postId = extractPostId(article);
    const content = article
      .find(
        '[data-role="commentContent"], [data-role="post-content"], .cPost_contentWrap > .ipsType_richText, .cPost_contentWrap .ipsType_richText',
      )
      .first();
    if (content.length === 0) invalid(`Post ${postId} has no author content`);
    const record: TechnicalForumPost = {
      subforumId: FORUM83_ID,
      topicId,
      postId,
      memberId: extractMemberId(query, article, sourceUrl),
      topicTitle: title,
      bodyText: extractAuthorText(query, content),
    };
    const existing = posts.get(postId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(record)) {
      invalid(`Post ${postId} appears with conflicting content`);
    }
    posts.set(postId, existing ?? record);
  });

  return {
    forumId: FORUM83_ID,
    topicId,
    title,
    posts: [...posts.values()].sort((left, right) =>
      compareCanonicalIds(left.postId, right.postId),
    ),
    paginationUrls: paginationUrls(query, sourceUrl, 'topic', topicId),
  };
}

function extractPostId(article: ReturnType<CheerioAPI>): string {
  const values = new Set<string>();
  for (const value of [
    article.attr('data-commentid'),
    article.attr('data-comment-id'),
    article.attr('data-post-id'),
  ]) {
    if (value !== undefined) values.add(canonicalizeExternalNumericId(value));
  }
  const idMatch = article.attr('id')?.match(/(?:elComment_|comment-|post-)(\d+)$/iu)?.[1];
  if (idMatch !== undefined) values.add(canonicalizeExternalNumericId(idMatch));
  if (values.size !== 1) invalid('Post element has no unique numeric ID');
  return [...values][0] ?? invalid('Post element has no numeric ID');
}

function extractMemberId(
  query: CheerioAPI,
  article: ReturnType<CheerioAPI>,
  sourceUrl: URL,
): string | null {
  const ids = new Set<string>();
  article
    .find(
      '.cAuthorPane, [data-role="commentAuthor"], [data-role="post-author"], .ipsComment_author',
    )
    .first()
    .find('a[href]')
    .each((_index, element) => {
      const resolved = containedUrl(query(element).attr('href'), sourceUrl);
      const match = resolved?.href.match(/\/profile\/(\d+)(?:-|\/|$)/iu)?.[1];
      if (match !== undefined) ids.add(canonicalizeExternalNumericId(match));
    });
  if (ids.size > 1) invalid('Post author area identifies multiple members');
  return ids.size === 0 ? null : ([...ids][0] ?? null);
}

function extractAuthorText(query: CheerioAPI, content: ReturnType<CheerioAPI>): string {
  const clone = content.clone();
  clone
    .find(
      'blockquote, .ipsQuote, [data-ipsquote], [data-role="quote"], .cSignature, .ipsComment_signature, [data-role="signature"], .ipsReact, .ipsReaction, [data-role="reactions"], [data-role="reaction"], .cPost_editHistory, .ipsComment_meta, [data-role="editHistory"], [data-role="edit-history"], [data-excludequote], script, style, noscript',
    )
    .remove();
  const line = '\uE000';
  const paragraph = '\uE001';
  clone.find('br').replaceWith(line);
  clone.find('p, li, pre, section, h1, h2, h3, h4, h5, h6').append(paragraph);
  clone.find('div').append(line);
  return clone
    .text()
    .replaceAll('\u00a0', ' ')
    .replace(/[\t\r\f\v ]+/gu, ' ')
    .replace(new RegExp(` *${line}+ *`, 'gu'), '\n')
    .replace(new RegExp(` *${paragraph}+ *`, 'gu'), '\n\n')
    .split('\n')
    .map((value) => value.trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function paginationUrls(
  query: CheerioAPI,
  sourceUrl: URL,
  entity: 'forum' | 'topic',
  expectedId: string,
): string[] {
  const urls = new Set<string>();
  query('[data-role="pagination"], .ipsPagination')
    .find('a[href]')
    .each((_index, element) => {
      const resolved = containedUrl(query(element).attr('href'), sourceUrl);
      if (resolved === null) return;
      const id = entity === 'forum' ? getForumIdFromUrl(resolved) : getTopicIdFromUrl(resolved);
      if (id === expectedId) urls.add(canonicalUrl(resolved));
    });
  urls.delete(canonicalUrl(sourceUrl));
  return [...urls].sort((left, right) => paginationPage(left) - paginationPage(right));
}

function paginationPage(value: string): number {
  const match = new URL(value).href.match(/\/page\/(\d+)(?:\/|$)/iu)?.[1];
  return match === undefined ? 1 : Number(match);
}

function pageTitle(query: CheerioAPI): string {
  const title = normalizeInlineText(
    query('h1[data-role="pageTitle"], h1.ipsType_pageTitle, h1').first().text(),
  );
  if (title.length === 0) invalid('Page title is missing');
  return title;
}

function sourcePageUrl(value: string): URL {
  const url = new URL(value, FORUM83_SOURCE_ORIGIN);
  if (url.origin !== new URL(FORUM83_SOURCE_ORIGIN).origin) invalid('URL leaves rus-fishsoft');
  return url;
}

function containedUrl(value: string | undefined, sourceUrl: URL): URL | null {
  if (value === undefined || value.startsWith('#') || value.startsWith('javascript:')) return null;
  const url = new URL(value, sourceUrl);
  return url.origin === sourceUrl.origin ? url : null;
}

function canonicalUrl(value: URL): string {
  value.hash = '';
  return value.href;
}

function normalizeInlineText(value: string): string {
  return value.replaceAll('\u00a0', ' ').replace(/\s+/gu, ' ').trim();
}

function invalid(message: string): never {
  throw new Forum83HtmlError(message);
}
