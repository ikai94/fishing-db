import robotsParser from 'robots-parser';
import { ForumLocalStore, sha256Hex, type HttpCacheEntry } from './cache.js';

interface RobotsPolicy {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
}

const parseRobots = robotsParser as unknown as (url: string, source: string) => RobotsPolicy;

export type ForumHttpErrorCode =
  | 'BLOCKED'
  | 'CHALLENGE_DETECTED'
  | 'HTTP_ERROR'
  | 'INVALID_CONTENT'
  | 'RATE_LIMITED'
  | 'REDIRECT_OUTSIDE_SOURCE'
  | 'ROBOTS_DISALLOWED'
  | 'ROBOTS_UNAVAILABLE'
  | 'RESPONSE_TOO_LARGE';

export class ForumHttpError extends Error {
  constructor(
    readonly code: ForumHttpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ForumHttpError';
  }
}

export interface ForumHttpClientOptions {
  sourceOrigin: string;
  userAgent: string;
  delayMs: number;
  timeoutMs?: number;
  maximumBodyBytes?: number;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export interface ForumHtmlResponse {
  body: string;
  bodySha256: string;
  finalUrl: string;
  fromCache: boolean;
  revalidated: boolean;
}

export interface ForumHttpCounters {
  networkRequests: number;
  cacheHits: number;
  cacheMisses: number;
  revalidated: number;
  retries: number;
  rateLimits: number;
  challenges: number;
  robotsStatus: 'NOT_CHECKED' | 'PARSED_200' | 'ALLOW_404';
  effectiveDelayMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAXIMUM_BODY_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 5 * 60_000;
const CHALLENGE_MARKERS = [
  { label: 'cf-chl-', pattern: /cf-chl-/iu },
  { label: 'cloudflare ray', pattern: /cloudflare\s+ray/iu },
  { label: 'attention required!', pattern: /attention required!/iu },
  { label: 'captcha-container', pattern: /captcha-container/iu },
  { label: 'hcaptcha', pattern: /hcaptcha/iu },
] as const;
const EMBEDDED_RECAPTCHA_PATTERN = /g-recaptcha/iu;

type ByteStreamReadResult = { done: true; value?: undefined } | { done: false; value: Uint8Array };

function isByteStreamReadResult(value: unknown): value is ByteStreamReadResult {
  if (typeof value !== 'object' || value === null || !('done' in value)) return false;
  if (value.done === true) return true;
  return value.done === false && 'value' in value && value.value instanceof Uint8Array;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (value === null) return null;
  if (/^\d+$/u.test(value.trim())) return Number(value.trim()) * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status >= 500;
}

function findChallengeMarker(source: string): string | null {
  const strongMarker = CHALLENGE_MARKERS.find(({ pattern }) => pattern.test(source));
  if (strongMarker !== undefined) return strongMarker.label;
  if (EMBEDDED_RECAPTCHA_PATTERN.test(source) && !looksLikeInvisionTopicDocument(source)) {
    return 'g-recaptcha';
  }
  return null;
}

function looksLikeInvisionTopicDocument(source: string): boolean {
  const bodyTag = /<body\b[^>]*>/iu.exec(source)?.[0];
  return (
    bodyTag !== undefined &&
    /\bdata-pageapp\s*=\s*(['"])forums\1/iu.test(bodyTag) &&
    /\bdata-pagecontroller\s*=\s*(['"])topic\1/iu.test(bodyTag) &&
    /\bdata-commentid\s*=/iu.test(source)
  );
}

function describeChallengeContext(source: string): string {
  const bodyTag = /<body\b[^>]*>/iu.exec(source)?.[0] ?? '';
  const pageApp = extractHtmlAttribute(bodyTag, 'data-pageapp');
  const pageController = extractHtmlAttribute(bodyTag, 'data-pagecontroller');
  const hasCommentId = /\bdata-commentid\s*=/iu.test(source);
  return `pageApp=${pageApp ?? 'missing'}, pageController=${pageController ?? 'missing'}, commentId=${hasCommentId ? 'present' : 'missing'}`;
}

function extractHtmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(['"])([^'"]*)\\1`, 'iu').exec(tag);
  return match?.[2] ?? null;
}

export class ForumHttpClient {
  private readonly origin: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maximumBodyBytes: number;
  private robots: RobotsPolicy | null = null;
  private effectiveDelayMs: number;
  private lastRequestAt: number | null = null;
  private requestQueue: Promise<void> = Promise.resolve();
  readonly counters: ForumHttpCounters = {
    networkRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    revalidated: 0,
    retries: 0,
    rateLimits: 0,
    challenges: 0,
    robotsStatus: 'NOT_CHECKED',
    effectiveDelayMs: 0,
  };

  constructor(
    private readonly store: ForumLocalStore,
    private readonly options: ForumHttpClientOptions,
  ) {
    this.origin = new URL(options.sourceOrigin).origin;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maximumBodyBytes = options.maximumBodyBytes ?? DEFAULT_MAXIMUM_BODY_BYTES;
    this.effectiveDelayMs = options.delayMs;
    this.counters.effectiveDelayMs = options.delayMs;
  }

  private async initializeRobots(): Promise<void> {
    const robotsUrl = new URL('/robots.txt', this.origin).href;
    const response = await this.fetchWithPolicy(robotsUrl, new Headers(), true);

    if (response.status === 404) {
      await response.body?.cancel();
      this.robots = parseRobots(robotsUrl, '');
      this.counters.robotsStatus = 'ALLOW_404';
      return;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ForumHttpError('ROBOTS_UNAVAILABLE', `robots.txt returned HTTP ${response.status}`);
    }

    const source = await this.readBoundedText(response);
    const challengeMarker = findChallengeMarker(source);
    if (challengeMarker !== null) {
      this.counters.challenges += 1;
      throw new ForumHttpError(
        'CHALLENGE_DETECTED',
        `Challenge response marker "${challengeMarker}" detected at ${robotsUrl} (${describeChallengeContext(source)})`,
      );
    }
    this.robots = parseRobots(robotsUrl, source);
    this.counters.robotsStatus = 'PARSED_200';
    const crawlDelay = this.robots.getCrawlDelay(this.options.userAgent);
    if (crawlDelay !== undefined && Number.isFinite(crawlDelay) && crawlDelay >= 0) {
      this.effectiveDelayMs = Math.max(this.effectiveDelayMs, crawlDelay * 1_000);
    }
    this.counters.effectiveDelayMs = this.effectiveDelayMs;
  }

  async getHtml(url: string): Promise<ForumHtmlResponse> {
    const operation = this.requestQueue.then(
      () => this.getHtmlSerial(url),
      () => this.getHtmlSerial(url),
    );
    this.requestQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async getHtmlSerial(url: string): Promise<ForumHtmlResponse> {
    const canonicalUrl = new URL(url).href;
    this.assertSameOrigin(canonicalUrl);
    if (this.robots === null) await this.initializeRobots();
    if (this.robots?.isAllowed(canonicalUrl, this.options.userAgent) === false) {
      throw new ForumHttpError('ROBOTS_DISALLOWED', `robots.txt disallows ${canonicalUrl}`);
    }

    const cached = await this.store.readHttp(canonicalUrl);
    const headers = new Headers({
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ru,en;q=0.5',
    });
    if (cached?.metadata.etag !== null && cached?.metadata.etag !== undefined) {
      headers.set('if-none-match', cached.metadata.etag);
    }
    if (cached?.metadata.lastModified !== null && cached?.metadata.lastModified !== undefined) {
      headers.set('if-modified-since', cached.metadata.lastModified);
    }

    const response = await this.fetchWithPolicy(canonicalUrl, headers, false);
    if (response.status === 304) {
      if (cached === null) {
        throw new ForumHttpError('HTTP_ERROR', 'Received 304 without a cached response');
      }
      this.counters.cacheHits += 1;
      this.counters.revalidated += 1;
      return {
        body: cached.body,
        bodySha256: cached.metadata.bodySha256,
        finalUrl: cached.metadata.finalUrl,
        fromCache: true,
        revalidated: true,
      };
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ForumHttpError('HTTP_ERROR', `${canonicalUrl} returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/html\b/iu.test(contentType)) {
      await response.body?.cancel();
      throw new ForumHttpError(
        'INVALID_CONTENT',
        `${canonicalUrl} returned unexpected content type ${contentType || '(missing)'}`,
      );
    }
    const body = await this.readBoundedText(response);
    const challengeMarker = findChallengeMarker(body);
    if (challengeMarker !== null) {
      this.counters.challenges += 1;
      throw new ForumHttpError(
        'CHALLENGE_DETECTED',
        `Challenge response marker "${challengeMarker}" detected at ${canonicalUrl} (${describeChallengeContext(body)})`,
      );
    }

    const entry: HttpCacheEntry = {
      metadata: {
        schemaVersion: 1,
        url: canonicalUrl,
        finalUrl: response.url || canonicalUrl,
        contentType,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        bodySha256: sha256Hex(body),
      },
      body,
    };
    await this.store.writeHttp(entry);
    this.counters.cacheMisses += 1;
    return {
      body,
      bodySha256: entry.metadata.bodySha256,
      finalUrl: entry.metadata.finalUrl,
      fromCache: false,
      revalidated: false,
    };
  }

  private async fetchWithPolicy(
    initialUrl: string,
    headers: Headers,
    robotsRequest: boolean,
  ): Promise<Response> {
    let rateLimitSeen = false;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.fetchFollowingSafeRedirects(initialUrl, headers, robotsRequest);

        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          throw new ForumHttpError('BLOCKED', `${initialUrl} returned HTTP ${response.status}`);
        }
        if (response.status === 429) {
          this.counters.rateLimits += 1;
          if (rateLimitSeen) {
            await response.body?.cancel();
            throw new ForumHttpError('RATE_LIMITED', `Repeated HTTP 429 from ${initialUrl}`);
          }
          rateLimitSeen = true;
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'), this.now());
          if (retryAfter === null || retryAfter > MAX_RETRY_AFTER_MS) {
            await response.body?.cancel();
            throw new ForumHttpError(
              'RATE_LIMITED',
              `HTTP 429 from ${initialUrl} has no acceptable Retry-After`,
            );
          }
          this.counters.retries += 1;
          await response.body?.cancel();
          await this.sleep(retryAfter);
          continue;
        }
        if (!retryableStatus(response.status) || attempt === MAX_ATTEMPTS) return response;
        this.counters.retries += 1;
        await response.body?.cancel();
        await this.sleep(2 ** attempt * 1_000);
      } catch (error: unknown) {
        if (error instanceof ForumHttpError) throw error;
        lastError = error;
        if (attempt === MAX_ATTEMPTS) break;
        this.counters.retries += 1;
        await this.sleep(2 ** attempt * 1_000);
      }
    }

    const detail = lastError instanceof Error ? lastError.message : 'request failed';
    throw new ForumHttpError(
      robotsRequest ? 'ROBOTS_UNAVAILABLE' : 'HTTP_ERROR',
      `${initialUrl}: ${detail}`,
    );
  }

  private async fetchFollowingSafeRedirects(
    initialUrl: string,
    headers: Headers,
    robotsRequest: boolean,
  ): Promise<Response> {
    let currentUrl = initialUrl;

    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      await this.waitForTurn();
      this.counters.networkRequests += 1;
      const response = await this.fetchImplementation(currentUrl, {
        headers: {
          ...Object.fromEntries(headers.entries()),
          'user-agent': this.options.userAgent,
        },
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || location === null) return response;
      const nextUrl = new URL(location, currentUrl).href;
      this.assertSameOrigin(nextUrl);
      if (!robotsRequest && this.robots?.isAllowed(nextUrl, this.options.userAgent) === false) {
        await response.body?.cancel();
        throw new ForumHttpError(
          'ROBOTS_DISALLOWED',
          `robots.txt disallows redirect target ${nextUrl}`,
        );
      }
      await response.body?.cancel();
      currentUrl = nextUrl;
    }

    throw new ForumHttpError('HTTP_ERROR', `Too many redirects from ${initialUrl}`);
  }

  private assertSameOrigin(url: string): void {
    if (new URL(url).origin !== this.origin) {
      throw new ForumHttpError('REDIRECT_OUTSIDE_SOURCE', `URL is outside ${this.origin}: ${url}`);
    }
  }

  private async waitForTurn(): Promise<void> {
    const now = this.now();
    if (this.lastRequestAt !== null) {
      const remaining = this.effectiveDelayMs - (now - this.lastRequestAt);
      if (remaining > 0) await this.sleep(remaining);
    }
    this.lastRequestAt = this.now();
  }

  private async readBoundedText(response: Response): Promise<string> {
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && Number(declaredLength) > this.maximumBodyBytes) {
      throw new ForumHttpError('RESPONSE_TOO_LARGE', 'Response exceeds configured size limit');
    }
    if (response.body === null) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const result: unknown = await reader.read();
      if (!isByteStreamReadResult(result)) {
        await reader.cancel();
        throw new ForumHttpError('INVALID_CONTENT', 'Response body stream is invalid');
      }
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > this.maximumBodyBytes) {
        await reader.cancel();
        throw new ForumHttpError('RESPONSE_TOO_LARGE', 'Response exceeds configured size limit');
      }
      chunks.push(result.value);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }
}
