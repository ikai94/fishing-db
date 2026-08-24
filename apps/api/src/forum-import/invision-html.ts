import { load, type CheerioAPI } from 'cheerio';
import {
  canonicalizePositiveDecimalId,
  compareCanonicalIds,
  PARENT_FORUM_ID,
  SOURCE_ORIGIN,
} from './scope.js';

export interface ForumReference {
  forumId: string;
  title: string;
  url: string;
}

export interface TopicReference {
  topicId: string;
  title: string;
  url: string;
}

export interface ExtractedParentForumPage {
  parentForumId: typeof PARENT_FORUM_ID;
  title: string;
  childForums: ForumReference[];
}

export interface ExtractedForumPage {
  parentForumId: typeof PARENT_FORUM_ID;
  forumId: string;
  title: string;
  topics: TopicReference[];
  paginationUrls: string[];
}

export interface ExtractedForumPost {
  postId: string;
  memberId: string | null;
  authorText: string;
}

export interface ExtractedTopicPage {
  parentForumId: typeof PARENT_FORUM_ID;
  subforumId: string;
  topicId: string;
  title: string;
  posts: ExtractedForumPost[];
  paginationUrls: string[];
}

export type ForumHtmlStructureErrorCode =
  | 'INVALID_SOURCE_URL'
  | 'UNEXPECTED_PAGE_ID'
  | 'MISSING_PAGE_TITLE'
  | 'MISSING_BREADCRUMB'
  | 'BREADCRUMB_OUT_OF_SCOPE'
  | 'MISSING_FORUM_LIST'
  | 'INVALID_FORUM_ROW'
  | 'MISSING_TOPIC_LIST'
  | 'INVALID_TOPIC_ROW'
  | 'MISSING_POST_LIST'
  | 'INVALID_POST'
  | 'MISSING_POST_CONTENT';

export class ForumHtmlStructureError extends Error {
  constructor(
    readonly code: ForumHtmlStructureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ForumHtmlStructureError';
  }
}

const FORUM_LIST_SELECTOR = '[data-role="forums"], [data-role="forum-list"]';
const TOPIC_LIST_SELECTOR =
  '[data-role="topicList"], [data-role="topic-list"], [data-role="tableRows"], .cTopicList, .cForumTopicTable';
const BREADCRUMB_SELECTOR =
  '[data-role="breadcrumb"], [data-role="breadcrumbList"], nav[aria-label="Breadcrumb"], nav[aria-label="breadcrumb"], .ipsBreadcrumb';
const PAGE_TITLE_SELECTOR = 'h1[data-role="pageTitle"], h1.ipsType_pageTitle, h1';
const POST_SELECTOR =
  'article[data-commentid], article[data-comment-id], article[id^="elComment_"], [data-role="post"][data-post-id]';

export function extractEligibleChildForums(
  html: string,
  pageUrl: string,
): ExtractedParentForumPage {
  const sourceUrl = assertSourcePageUrl(pageUrl);
  assertPageEntityId(sourceUrl, 'forum', PARENT_FORUM_ID);
  const $ = load(html);
  const indexRow = extractParentIndexRow($, sourceUrl);
  if (indexRow !== null) return indexRow;
  const title = extractPageTitle($);
  const container = findParentForumList($);
  const containerElement = container.get(0);
  if (containerElement === undefined) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum has no child-forum container');
  }

  const children = new Map<string, ForumReference>();
  const rows = container.children().filter((_index, element) => {
    const row = $(element);
    return (
      row.is('.cForumRow') ||
      row.attr('data-forumid') !== undefined ||
      row.attr('data-forum-id') !== undefined
    );
  });

  rows.each((_index, element) => {
    const row = $(element);
    if (isRedirectForumRow(row.attr('data-redirect'), row.attr('data-forumtype'))) {
      return;
    }

    const declaredParent = firstDefined(
      row.attr('data-parent-forum-id'),
      row.attr('data-parentid'),
    );
    if (
      declaredParent !== undefined &&
      canonicalizeStructureId(declaredParent, 'child forum parent ID') !== PARENT_FORUM_ID
    ) {
      return;
    }

    const declaredIdValue = firstDefined(row.attr('data-forumid'), row.attr('data-forum-id'));
    const declaredId =
      declaredIdValue === undefined
        ? null
        : canonicalizeStructureId(declaredIdValue, 'child forum ID');

    const ownedLinks = row.find('a[href]').filter((_linkIndex, linkElement) => {
      return $(linkElement).parents(FORUM_LIST_SELECTOR).first().get(0) === containerElement;
    });
    const references: ForumReference[] = [];
    ownedLinks.each((_linkIndex, linkElement) => {
      const link = $(linkElement);
      const resolved = resolveContainedUrl(link.attr('href'), sourceUrl);
      if (resolved === null) {
        return;
      }
      const forumId = getForumIdFromUrl(resolved);
      if (forumId === null || (declaredId !== null && forumId !== declaredId)) {
        return;
      }
      const linkTitle = normalizeInlineText(link.text());
      if (linkTitle.length > 0) {
        references.push({ forumId, title: linkTitle, url: canonicalUrl(resolved) });
      }
    });

    const uniqueReferences = uniqueForumReferences(references);
    if (uniqueReferences.length === 0) {
      if (declaredId !== null) {
        throw structureError(
          'INVALID_FORUM_ROW',
          `Child forum row ${declaredId} has no contained forum link`,
        );
      }
      return;
    }
    if (uniqueReferences.length !== 1) {
      throw structureError('INVALID_FORUM_ROW', 'Child forum row identifies multiple forums');
    }

    addUniqueForumReference(children, uniqueReferences[0]);
  });

  if (children.size === 0) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum has no eligible direct child forums');
  }

  return {
    parentForumId: PARENT_FORUM_ID,
    title,
    childForums: [...children.values()].sort((left, right) =>
      compareCanonicalIds(left.forumId, right.forumId),
    ),
  };
}

function extractParentIndexRow($: CheerioAPI, sourceUrl: URL): ExtractedParentForumPage | null {
  const parentRows = findRootContainers($, FORUM_LIST_SELECTOR)
    .children()
    .filter((_index, element) => {
      const rawId = firstDefined($(element).attr('data-forumid'), $(element).attr('data-forum-id'));
      return (
        rawId !== undefined &&
        canonicalizeStructureId(rawId, 'forum index row ID') === PARENT_FORUM_ID
      );
    });
  if (parentRows.length === 0) return null;
  if (parentRows.length !== 1) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum index row is ambiguous');
  }

  const parentRow = parentRows.first();
  const titleLinks = parentRow.find('.ipsDataItem_title a[href]').filter((_index, element) => {
    const resolved = resolveContainedUrl($(element).attr('href'), sourceUrl);
    return resolved !== null && getForumIdFromUrl(resolved) === PARENT_FORUM_ID;
  });
  if (titleLinks.length !== 1) {
    throw structureError('MISSING_PAGE_TITLE', 'Parent forum index row has no unique title link');
  }
  const title = normalizeInlineText(titleLinks.first().text());
  if (title.length === 0) {
    throw structureError('MISSING_PAGE_TITLE', 'Parent forum index row title is empty');
  }

  const childForums = new Map<string, ForumReference>();
  const sublists = parentRow.find('.ipsDataItem_subList');
  if (sublists.length !== 1) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum index row has no unique child list');
  }
  sublists
    .first()
    .children('li')
    .children('a[href]')
    .each((_index, element) => {
      const link = $(element);
      const resolved = resolveContainedUrl(link.attr('href'), sourceUrl);
      if (resolved === null) return;
      const forumId = getForumIdFromUrl(resolved);
      const childTitle = normalizeInlineText(link.text());
      if (forumId === null || forumId === PARENT_FORUM_ID || childTitle.length === 0) return;
      addUniqueForumReference(childForums, {
        forumId,
        title: childTitle,
        url: canonicalUrl(resolved),
      });
    });
  if (childForums.size === 0) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum index row has no child forum links');
  }

  return {
    parentForumId: PARENT_FORUM_ID,
    title,
    childForums: [...childForums.values()].sort((left, right) =>
      compareCanonicalIds(left.forumId, right.forumId),
    ),
  };
}

export function extractForumPage(
  html: string,
  pageUrl: string,
  expectedForumId: string,
): ExtractedForumPage {
  const forumId = canonicalizeStructureId(expectedForumId, 'expected forum ID');
  if (forumId === PARENT_FORUM_ID) {
    throw structureError('BREADCRUMB_OUT_OF_SCOPE', 'A child forum ID is required');
  }

  const sourceUrl = assertSourcePageUrl(pageUrl);
  assertPageEntityId(sourceUrl, 'forum', forumId);
  const $ = load(html);
  const title = extractPageTitle($);
  assertDirectChildBreadcrumb($, sourceUrl, forumId);

  const containers = findRootContainers($, TOPIC_LIST_SELECTOR);
  if (containers.length === 0) {
    throw structureError('MISSING_TOPIC_LIST', 'Forum page has no topic-list container');
  }

  const topics = new Map<string, TopicReference>();
  containers.each((_containerIndex, containerElement) => {
    const container = $(containerElement);
    container
      .children()
      .filter((_rowIndex, element) => {
        const row = $(element);
        return (
          row.attr('data-topic-id') !== undefined ||
          row.attr('data-topicid') !== undefined ||
          row.attr('data-rowid') !== undefined ||
          row.is('.cTopicRow, .ipsDataItem')
        );
      })
      .each((_rowIndex, rowElement) => {
        const row = $(rowElement);
        const declaredIdValue = firstDefined(
          row.attr('data-topic-id'),
          row.attr('data-topicid'),
          row.attr('data-rowid'),
        );
        const declaredId =
          declaredIdValue === undefined
            ? null
            : canonicalizeStructureId(declaredIdValue, 'topic row ID');

        const roleTitleLinks = row.find('a[data-role="title"][href]');
        const explicitTitleLinks =
          roleTitleLinks.length > 0
            ? roleTitleLinks
            : row.find('.ipsDataItem_title a[href]').first();
        const ownedLinks = explicitTitleLinks.length > 0 ? explicitTitleLinks : row.find('a[href]');
        const topicLinks: TopicReference[] = [];
        ownedLinks.each((_linkIndex, linkElement) => {
          const link = $(linkElement);
          const resolved = resolveContainedUrl(link.attr('href'), sourceUrl);
          if (resolved === null) {
            return;
          }
          const topicId = getTopicIdFromUrl(resolved);
          if (topicId === null || (declaredId !== null && topicId !== declaredId)) {
            return;
          }
          const linkTitle = normalizeInlineText(link.text());
          if (linkTitle.length > 0) {
            topicLinks.push({ topicId, title: linkTitle, url: canonicalUrl(resolved) });
          }
        });

        const uniqueReferences = uniqueTopicReferences(topicLinks);
        if (uniqueReferences.length !== 1) {
          throw structureError(
            'INVALID_TOPIC_ROW',
            declaredId === null
              ? 'Topic row does not identify exactly one contained topic'
              : `Topic row ${declaredId} does not identify exactly one contained topic`,
          );
        }
        addUniqueTopicReference(topics, uniqueReferences[0]);
      });
  });

  return {
    parentForumId: PARENT_FORUM_ID,
    forumId,
    title,
    topics: [...topics.values()].sort((left, right) =>
      compareCanonicalIds(left.topicId, right.topicId),
    ),
    paginationUrls: extractPaginationUrls($, sourceUrl, 'forum', forumId),
  };
}

export function extractTopicPage(
  html: string,
  pageUrl: string,
  options: { expectedTopicId: string; expectedSubforumId?: string },
): ExtractedTopicPage {
  const topicId = canonicalizeStructureId(options.expectedTopicId, 'expected topic ID');
  const sourceUrl = assertSourcePageUrl(pageUrl);
  assertPageEntityId(sourceUrl, 'topic', topicId);
  const $ = load(html);
  const title = extractPageTitle($);
  const subforumId = extractTopicSubforumId($, sourceUrl);

  if (
    options.expectedSubforumId !== undefined &&
    subforumId !== canonicalizeStructureId(options.expectedSubforumId, 'expected subforum ID')
  ) {
    throw structureError(
      'BREADCRUMB_OUT_OF_SCOPE',
      `Topic belongs to subforum ${subforumId}, not ${options.expectedSubforumId}`,
    );
  }

  const postElements = $(POST_SELECTOR).filter((_index, element) => {
    return $(element).parents(POST_SELECTOR).length === 0;
  });
  if (postElements.length === 0) {
    throw structureError('MISSING_POST_LIST', 'Topic page has no stable post elements');
  }

  const posts = new Map<string, ExtractedForumPost>();
  postElements.each((_index, element) => {
    const article = $(element);
    const postId = extractPostId($, article, sourceUrl);
    const content = article
      .find(
        '[data-role="commentContent"], [data-role="post-content"], .cPost_contentWrap > .ipsType_richText, .cPost_contentWrap .ipsType_richText',
      )
      .first();
    if (content.length === 0) {
      throw structureError('MISSING_POST_CONTENT', `Post ${postId} has no author-text container`);
    }

    const extracted: ExtractedForumPost = {
      postId,
      memberId: extractMemberId($, article, sourceUrl),
      authorText: extractAuthorText($, content),
    };
    const existing = posts.get(postId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(extracted)) {
      throw structureError('INVALID_POST', `Post ${postId} appears with conflicting content`);
    }
    posts.set(postId, existing ?? extracted);
  });

  return {
    parentForumId: PARENT_FORUM_ID,
    subforumId,
    topicId,
    title,
    posts: [...posts.values()].sort((left, right) =>
      compareCanonicalIds(left.postId, right.postId),
    ),
    paginationUrls: extractPaginationUrls($, sourceUrl, 'topic', topicId),
  };
}

export function getForumIdFromUrl(value: string | URL): string | null {
  return getEntityIdFromUrl(value, 'forum');
}

export function getTopicIdFromUrl(value: string | URL): string | null {
  return getEntityIdFromUrl(value, 'topic');
}

function findParentForumList($: CheerioAPI) {
  const roots = findRootContainers($, FORUM_LIST_SELECTOR);
  const explicitlyBound = roots.filter((_index, element) => {
    const container = $(element);
    const value = firstDefined(
      container.attr('data-parent-forum-id'),
      container.attr('data-forum-id'),
    );
    return (
      value !== undefined &&
      canonicalizeStructureId(value, 'forum-list parent ID') === PARENT_FORUM_ID
    );
  });

  if (explicitlyBound.length === 1) {
    return explicitlyBound.first();
  }
  if (explicitlyBound.length > 1 || roots.length !== 1) {
    throw structureError('MISSING_FORUM_LIST', 'Parent forum child container is ambiguous');
  }
  return roots.first();
}

function findRootContainers($: CheerioAPI, selector: string) {
  return $(selector).filter((_index, element) => $(element).parents(selector).length === 0);
}

function assertDirectChildBreadcrumb($: CheerioAPI, sourceUrl: URL, expectedForumId: string): void {
  const ids = extractBreadcrumbForumIds($, sourceUrl);
  const parentIndex = ids.lastIndexOf(PARENT_FORUM_ID);
  if (parentIndex === -1) {
    throw structureError('BREADCRUMB_OUT_OF_SCOPE', 'Child forum breadcrumb omits parent forum 69');
  }

  const descendants = ids.slice(parentIndex + 1);
  if (descendants.length > 1 || (descendants.length === 1 && descendants[0] !== expectedForumId)) {
    throw structureError(
      'BREADCRUMB_OUT_OF_SCOPE',
      `Forum ${expectedForumId} is not a direct child of parent forum 69`,
    );
  }
}

function extractTopicSubforumId($: CheerioAPI, sourceUrl: URL): string {
  const ids = extractBreadcrumbForumIds($, sourceUrl);
  const parentIndex = ids.lastIndexOf(PARENT_FORUM_ID);
  if (parentIndex === -1 || ids.length !== parentIndex + 2) {
    throw structureError(
      'BREADCRUMB_OUT_OF_SCOPE',
      'Topic breadcrumb does not identify one direct child of parent forum 69',
    );
  }

  const subforumId = ids[parentIndex + 1];
  if (subforumId === undefined || subforumId === PARENT_FORUM_ID) {
    throw structureError('BREADCRUMB_OUT_OF_SCOPE', 'Topic child forum ID is invalid');
  }
  return subforumId;
}

function extractBreadcrumbForumIds($: CheerioAPI, sourceUrl: URL): string[] {
  const breadcrumb = $(BREADCRUMB_SELECTOR).first();
  if (breadcrumb.length === 0) {
    throw structureError('MISSING_BREADCRUMB', 'Page has no recognizable breadcrumb');
  }

  const ids: string[] = [];
  breadcrumb.find('a[href]').each((_index, element) => {
    const href = $(element).attr('href');
    const resolved = resolveContainedUrl(href, sourceUrl);
    if (resolved === null) {
      if (looksLikeAbsoluteHttpUrl(href)) {
        throw structureError('BREADCRUMB_OUT_OF_SCOPE', 'Breadcrumb leaves the source origin');
      }
      return;
    }
    const forumId = getForumIdFromUrl(resolved);
    if (forumId !== null && ids.at(-1) !== forumId) {
      ids.push(forumId);
    }
  });
  return ids;
}

function extractPostId($: CheerioAPI, article: ReturnType<CheerioAPI>, sourceUrl: URL): string {
  const candidates = new Set<string>();
  for (const value of [
    article.attr('data-commentid'),
    article.attr('data-comment-id'),
    article.attr('data-post-id'),
  ]) {
    if (value !== undefined) {
      candidates.add(canonicalizeStructureId(value, 'post ID'));
    }
  }

  const elementId = article.attr('id');
  const elementMatch = elementId?.match(/(?:elComment_|comment-|post-)(\d+)$/i);
  if (elementMatch?.[1] !== undefined) {
    candidates.add(canonicalizeStructureId(elementMatch[1], 'post ID'));
  }

  if (candidates.size === 0) {
    article
      .find('a[data-role="shareComment"], a[data-role="post-permalink"]')
      .each((_index, element) => {
        const resolved = resolveContainedUrl($(element).attr('href'), sourceUrl);
        const value = resolved?.searchParams.get('comment');
        if (value !== null && value !== undefined && /^\d+$/.test(value)) {
          candidates.add(canonicalizeStructureId(value, 'post permalink ID'));
        }
      });
  }

  if (candidates.size !== 1) {
    throw structureError(
      'INVALID_POST',
      'Post element does not identify exactly one numeric post ID',
    );
  }
  return [...candidates][0];
}

function extractMemberId(
  $: CheerioAPI,
  article: ReturnType<CheerioAPI>,
  sourceUrl: URL,
): string | null {
  const authorArea = article
    .find(
      '.cAuthorPane, [data-role="commentAuthor"], [data-role="post-author"], .ipsComment_author',
    )
    .first();
  if (authorArea.length === 0) {
    return null;
  }

  const ids = new Set<string>();
  authorArea.find('a[href]').each((_index, element) => {
    const resolved = resolveContainedUrl($(element).attr('href'), sourceUrl);
    const memberId = resolved === null ? null : getProfileIdFromUrl(resolved);
    if (memberId !== null) {
      ids.add(memberId);
    }
  });

  if (ids.size > 1) {
    throw structureError('INVALID_POST', 'Post author area identifies multiple member IDs');
  }
  return ids.size === 0 ? null : [...ids][0];
}

function extractAuthorText($: CheerioAPI, content: ReturnType<CheerioAPI>): string {
  const clone = content.clone();
  clone
    .find(
      [
        'blockquote',
        '.ipsQuote',
        '[data-ipsquote]',
        '[data-role="quote"]',
        '.cSignature',
        '.ipsComment_signature',
        '[data-role="signature"]',
        '.ipsReact',
        '.ipsReaction',
        '[data-role="reactions"]',
        '[data-role="reaction"]',
        '.cPost_editHistory',
        '.ipsComment_meta',
        '[data-role="editHistory"]',
        '[data-role="edit-history"]',
        '[data-excludequote]',
        '[data-role="moderator-note"]',
        'script',
        'style',
        'noscript',
      ].join(', '),
    )
    .remove();

  const boundary = '\uE000';
  clone.find('br').replaceWith(boundary);
  clone.find('p, div, li, ul, ol, pre, section, article, h1, h2, h3, h4, h5, h6').append(boundary);

  return clone
    .text()
    .replaceAll('\u00a0', ' ')
    .replace(/[\t\n\r\f\v ]+/g, ' ')
    .replace(new RegExp(` *${boundary}+ *`, 'g'), '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function extractPaginationUrls(
  $: CheerioAPI,
  sourceUrl: URL,
  entity: 'forum' | 'topic',
  expectedId: string,
): string[] {
  const urls = new Set<string>();
  $('[data-role="pagination"], .ipsPagination')
    .find('a[href]')
    .each((_index, element) => {
      const resolved = resolveContainedUrl($(element).attr('href'), sourceUrl);
      if (resolved !== null && getEntityIdFromUrl(resolved, entity) === expectedId) {
        urls.add(canonicalUrl(resolved));
      }
    });

  return [...urls].sort((left, right) => {
    const pageDifference = getPageNumber(left) - getPageNumber(right);
    return pageDifference === 0 ? left.localeCompare(right) : pageDifference;
  });
}

function extractPageTitle($: CheerioAPI): string {
  const title = normalizeInlineText($(PAGE_TITLE_SELECTOR).first().text());
  if (title.length === 0) {
    throw structureError('MISSING_PAGE_TITLE', 'Page has no recognizable title');
  }
  return title;
}

function assertSourcePageUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw structureError('INVALID_SOURCE_URL', 'Page URL is malformed');
  }
  if (
    parsed.origin !== SOURCE_ORIGIN ||
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw structureError('INVALID_SOURCE_URL', 'Page URL is outside the configured source origin');
  }
  return parsed;
}

function assertPageEntityId(sourceUrl: URL, entity: 'forum' | 'topic', expectedId: string): void {
  if (getEntityIdFromUrl(sourceUrl, entity) !== expectedId) {
    throw structureError(
      'UNEXPECTED_PAGE_ID',
      `Page URL does not identify expected ${entity} ${expectedId}`,
    );
  }
}

function getEntityIdFromUrl(value: string | URL, entity: 'forum' | 'topic'): string | null {
  let parsed: URL;
  try {
    parsed = typeof value === 'string' ? new URL(value, SOURCE_ORIGIN) : value;
  } catch {
    return null;
  }
  if (
    parsed.origin !== SOURCE_ORIGIN ||
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return null;
  }

  const legacyParameter = entity === 'forum' ? 'showforum' : 'showtopic';
  const legacyValue = parsed.searchParams.get(legacyParameter);
  if (legacyValue !== null && /^\d+$/.test(legacyValue)) {
    return canonicalizeStructureId(legacyValue, `${entity} URL ID`);
  }

  const family = entity === 'forum' ? 'forums?' : 'topics?';
  const pattern = new RegExp(`/${family}/(\\d+)(?=[^0-9]|$)`, 'gi');
  const combined = `${parsed.pathname}${parsed.search}`;
  let match: RegExpExecArray | null;
  let lastId: string | null = null;
  while ((match = pattern.exec(combined)) !== null) {
    const rawId = match[1];
    if (rawId !== undefined) {
      lastId = canonicalizeStructureId(rawId, `${entity} URL ID`);
    }
  }
  return lastId;
}

function getProfileIdFromUrl(url: URL): string | null {
  const legacyValue = url.searchParams.get('showuser');
  if (legacyValue !== null && /^\d+$/.test(legacyValue)) {
    return canonicalizeStructureId(legacyValue, 'member profile ID');
  }

  const match = `${url.pathname}${url.search}`.match(/\/profiles?\/(\d+)(?=[^0-9]|$)/i);
  return match?.[1] === undefined ? null : canonicalizeStructureId(match[1], 'member profile ID');
}

function resolveContainedUrl(value: string | undefined, sourceUrl: URL): URL | null {
  if (value === undefined || value.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value, sourceUrl);
  } catch {
    return null;
  }
  if (
    parsed.origin !== SOURCE_ORIGIN ||
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return null;
  }
  parsed.hash = '';
  return parsed;
}

function canonicalUrl(url: URL): string {
  const canonical = new URL(url);
  canonical.hash = '';
  return canonical.href;
}

function getPageNumber(value: string): number {
  const url = new URL(value);
  const queryPage = url.searchParams.get('page');
  if (queryPage !== null && /^\d+$/.test(queryPage)) {
    const page = Number(queryPage);
    return Number.isSafeInteger(page) ? page : Number.MAX_SAFE_INTEGER;
  }
  const pathMatch = `${url.pathname}${url.search}`.match(/\/page\/(\d+)(?=[^0-9]|$)/i);
  if (pathMatch?.[1] !== undefined) {
    const page = Number(pathMatch[1]);
    return Number.isSafeInteger(page) ? page : Number.MAX_SAFE_INTEGER;
  }
  return 1;
}

function normalizeInlineText(value: string): string {
  return value.replaceAll('\u00a0', ' ').replace(/\s+/g, ' ').trim();
}

function canonicalizeStructureId(value: string, label: string): string {
  try {
    return canonicalizePositiveDecimalId(value, label);
  } catch {
    throw structureError('UNEXPECTED_PAGE_ID', `${label} is not a positive decimal integer`);
  }
}

function uniqueForumReferences(references: readonly ForumReference[]): ForumReference[] {
  const byId = new Map<string, ForumReference>();
  for (const reference of references) {
    const existing = byId.get(reference.forumId);
    if (existing !== undefined && existing.title !== reference.title) {
      throw structureError(
        'INVALID_FORUM_ROW',
        `Forum ${reference.forumId} has conflicting titles`,
      );
    }
    if (existing === undefined || reference.url.localeCompare(existing.url) < 0) {
      byId.set(reference.forumId, reference);
    }
  }
  return [...byId.values()];
}

function uniqueTopicReferences(references: readonly TopicReference[]): TopicReference[] {
  const byId = new Map<string, TopicReference>();
  for (const reference of references) {
    const existing = byId.get(reference.topicId);
    if (existing !== undefined && existing.title !== reference.title) {
      throw structureError(
        'INVALID_TOPIC_ROW',
        `Topic ${reference.topicId} has conflicting titles`,
      );
    }
    if (existing === undefined || reference.url.localeCompare(existing.url) < 0) {
      byId.set(reference.topicId, reference);
    }
  }
  return [...byId.values()];
}

function addUniqueForumReference(
  references: Map<string, ForumReference>,
  reference: ForumReference,
): void {
  const existing = references.get(reference.forumId);
  if (existing !== undefined && existing.title !== reference.title) {
    throw structureError('INVALID_FORUM_ROW', `Forum ${reference.forumId} has conflicting rows`);
  }
  if (existing === undefined || reference.url.localeCompare(existing.url) < 0) {
    references.set(reference.forumId, reference);
  }
}

function addUniqueTopicReference(
  references: Map<string, TopicReference>,
  reference: TopicReference,
): void {
  const existing = references.get(reference.topicId);
  if (existing !== undefined && existing.title !== reference.title) {
    throw structureError('INVALID_TOPIC_ROW', `Topic ${reference.topicId} has conflicting rows`);
  }
  if (existing === undefined || reference.url.localeCompare(existing.url) < 0) {
    references.set(reference.topicId, reference);
  }
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined);
}

function isRedirectForumRow(redirect: string | undefined, forumType: string | undefined): boolean {
  return (
    redirect === 'true' || redirect === '1' || forumType?.toLocaleLowerCase('en-US') === 'redirect'
  );
}

function looksLikeAbsoluteHttpUrl(value: string | undefined): boolean {
  return value !== undefined && /^https?:\/\//i.test(value);
}

function structureError(
  code: ForumHtmlStructureErrorCode,
  message: string,
): ForumHtmlStructureError {
  return new ForumHtmlStructureError(code, message);
}
