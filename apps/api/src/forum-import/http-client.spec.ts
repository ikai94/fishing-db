import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { ForumLocalStore } from './cache.js';
import { ForumHttpClient, ForumHttpError } from './http-client.js';

const ORIGIN = 'https://rus-fishsoft.ru';
const PAGE = `${ORIGIN}/forum/index.php?/topic/123-example/`;

function response(
  body: string | null,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
}

async function store(): Promise<ForumLocalStore> {
  return new ForumLocalStore(await mkdtemp(join(tmpdir(), 'forum-http-')));
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

void describe('ForumHttpClient', () => {
  void it('checks robots, remains serial, and conditionally reuses the shared cache', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const sleeps: number[] = [];
    let pageRequests = 0;
    const fetchImplementation: typeof fetch = (input, init) => {
      const url = requestUrl(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url.endsWith('/robots.txt')) {
        return Promise.resolve(response('User-agent: *\nAllow: /\nCrawl-delay: 3'));
      }
      pageRequests += 1;
      if (pageRequests === 1) {
        return Promise.resolve(response('<html>forum</html>', 200, { etag: '"one"' }));
      }
      assert.equal(headers.get('if-none-match'), '"one"');
      return Promise.resolve(response(null, 304));
    };
    let now = 0;
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 2_000,
      fetchImplementation,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
      now: () => now,
    });

    assert.equal((await client.getHtml(PAGE)).fromCache, false);
    assert.equal((await client.getHtml(PAGE)).revalidated, true);
    assert.equal(requests.length, 3);
    assert.deepEqual(sleeps, [3_000, 3_000]);
    assert.equal(client.counters.robotsStatus, 'PARSED_200');
    assert.equal(client.counters.effectiveDelayMs, 3_000);
  });

  void it('records the configured delay when a missing robots file allows crawling', async () => {
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_500,
      fetchImplementation: (input) =>
        Promise.resolve(
          requestUrl(input).endsWith('/robots.txt')
            ? response('', 404)
            : response('<html>ok</html>'),
        ),
      sleep: () => Promise.resolve(),
    });

    assert.equal(client.counters.robotsStatus, 'NOT_CHECKED');
    assert.equal(client.counters.effectiveDelayMs, 1_500);
    await client.getHtml(PAGE);
    assert.equal(client.counters.robotsStatus, 'ALLOW_404');
    assert.equal(client.counters.effectiveDelayMs, 1_500);
  });

  void it('stops when robots disallows the target', async () => {
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: () => Promise.resolve(response('User-agent: *\nDisallow: /forum/')),
      sleep: () => Promise.resolve(),
    });

    await assert.rejects(
      client.getHtml(PAGE),
      (error: unknown) => error instanceof ForumHttpError && error.code === 'ROBOTS_DISALLOWED',
    );
  });

  void it('honors one Retry-After and stops on a repeated rate limit', async () => {
    let requests = 0;
    const sleeps: number[] = [];
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: (input) => {
        if (requestUrl(input).endsWith('/robots.txt')) {
          return Promise.resolve(response('', 404));
        }
        requests += 1;
        return Promise.resolve(response('', 429, { 'retry-after': '2' }));
      },
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
    });

    await assert.rejects(
      client.getHtml(PAGE),
      (error: unknown) => error instanceof ForumHttpError && error.code === 'RATE_LIMITED',
    );
    assert.equal(requests, 2);
    assert.equal(sleeps.includes(2_000), true);
  });

  void it('rejects challenge bodies and cross-origin redirects', async () => {
    for (const fetchImplementation of [
      ((input: Parameters<typeof fetch>[0]) =>
        Promise.resolve(
          requestUrl(input).endsWith('/robots.txt')
            ? response('', 404)
            : response('<div class="cf-chl-widget">wait</div>'),
        )) as typeof fetch,
      ((input: Parameters<typeof fetch>[0]) =>
        Promise.resolve(
          requestUrl(input).endsWith('/robots.txt')
            ? response('', 404)
            : response('', 302, { location: 'https://example.com/' }),
        )) as typeof fetch,
    ]) {
      const client = new ForumHttpClient(await store(), {
        sourceOrigin: ORIGIN,
        userAgent: 'fishing-db-forum-scanner/1',
        delayMs: 1_000,
        fetchImplementation,
        sleep: () => Promise.resolve(),
      });
      await assert.rejects(client.getHtml(PAGE), ForumHttpError);
    }
  });

  void it('reports the exact challenge marker without weakening the gate', async () => {
    for (const [marker, body] of [
      ['cf-chl-', '<div class="cf-chl-widget">wait</div>'],
      ['cloudflare ray', '<footer>Cloudflare Ray ID: sanitized</footer>'],
      ['attention required!', '<title>Attention Required!</title>'],
      ['captcha-container', '<div class="captcha-container">wait</div>'],
      ['g-recaptcha', '<div class="g-recaptcha">wait</div>'],
      ['hcaptcha', '<script src="/hcaptcha/api.js"></script>'],
    ] as const) {
      const client = new ForumHttpClient(await store(), {
        sourceOrigin: ORIGIN,
        userAgent: 'fishing-db-forum-scanner/1',
        delayMs: 1_000,
        fetchImplementation: (input) =>
          Promise.resolve(
            requestUrl(input).endsWith('/robots.txt') ? response('', 404) : response(body),
          ),
        sleep: () => Promise.resolve(),
      });

      await assert.rejects(
        client.getHtml(PAGE),
        (error: unknown) =>
          error instanceof ForumHttpError &&
          error.code === 'CHALLENGE_DETECTED' &&
          error.message.includes(`marker "${marker}"`) &&
          error.message.includes('pageApp=missing, pageController=missing, commentId=missing'),
      );
    }
  });

  void it('allows an embedded reCAPTCHA marker only in a real IPS topic document', async () => {
    const body = `
      <body data-pageApp='forums' data-pageController='topic'>
        <div data-commentid='123'>Sanitized post</div>
        <div class='g-recaptcha'>Guest form</div>
      </body>
    `;
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: (input) =>
        Promise.resolve(
          requestUrl(input).endsWith('/robots.txt') ? response('', 404) : response(body),
        ),
      sleep: () => Promise.resolve(),
    });

    assert.equal((await client.getHtml(PAGE)).body, body);
    assert.equal(client.counters.challenges, 0);
  });

  void it('rechecks robots before following a same-origin redirect', async () => {
    const requested: string[] = [];
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: (input) => {
        const url = requestUrl(input);
        requested.push(url);
        if (url.endsWith('/robots.txt')) {
          return Promise.resolve(response('User-agent: *\nDisallow: /blocked/'));
        }
        return Promise.resolve(response('', 302, { location: `${ORIGIN}/blocked/page/` }));
      },
      sleep: () => Promise.resolve(),
    });

    await assert.rejects(
      client.getHtml(`${ORIGIN}/allowed/page/`),
      (error: unknown) => error instanceof ForumHttpError && error.code === 'ROBOTS_DISALLOWED',
    );
    assert.deepEqual(requested, [`${ORIGIN}/robots.txt`, `${ORIGIN}/allowed/page/`]);
  });

  void it('stops streamed bodies at the configured byte limit', async () => {
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      maximumBodyBytes: 4,
      fetchImplementation: (input) =>
        Promise.resolve(
          requestUrl(input).endsWith('/robots.txt') ? response('', 404) : response('12345'),
        ),
      sleep: () => Promise.resolve(),
    });

    await assert.rejects(
      client.getHtml(PAGE),
      (error: unknown) => error instanceof ForumHttpError && error.code === 'RESPONSE_TOO_LARGE',
    );
  });

  void it('treats a challenge returned as robots.txt as a hard stop', async () => {
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: () =>
        Promise.resolve(response('<div class="g-recaptcha">blocked</div>')),
      sleep: () => Promise.resolve(),
    });

    await assert.rejects(
      client.getHtml(PAGE),
      (error: unknown) => error instanceof ForumHttpError && error.code === 'CHALLENGE_DETECTED',
    );
  });

  void it('serializes concurrent callers and initializes robots only once', async () => {
    const requested: string[] = [];
    const client = new ForumHttpClient(await store(), {
      sourceOrigin: ORIGIN,
      userAgent: 'fishing-db-forum-scanner/1',
      delayMs: 1_000,
      fetchImplementation: (input) => {
        const url = requestUrl(input);
        requested.push(url);
        return Promise.resolve(
          url.endsWith('/robots.txt')
            ? response('User-agent: *\nAllow: /')
            : response('<html>ok</html>'),
        );
      },
      sleep: () => Promise.resolve(),
    });

    await Promise.all([
      client.getHtml(`${ORIGIN}/forum/first/`),
      client.getHtml(`${ORIGIN}/forum/second/`),
    ]);
    assert.deepEqual(requested, [
      `${ORIGIN}/robots.txt`,
      `${ORIGIN}/forum/first/`,
      `${ORIGIN}/forum/second/`,
    ]);
  });
});
