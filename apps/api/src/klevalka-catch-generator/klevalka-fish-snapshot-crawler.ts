import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from 'cheerio';
import { parseKlevalkaHtml } from './klevalka-catch-generator.js';

export const KLEVALKA_CRAWLER_VERSION = 'authenticated-fish-all-v1';
export const KLEVALKA_ORIGIN = 'https://klevalka.org';
export const KLEVALKA_FISH_INDEX_URL = `${KLEVALKA_ORIGIN}/fish`;
export const KLEVALKA_DEFAULT_REQUEST_DELAY_MS = 2_000;
export const KLEVALKA_MINIMUM_REQUEST_DELAY_MS = 1_000;

const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export interface KlevalkaFishDiscovery {
  sourceId: number;
  discoveredNames: string[];
  allUrl: string;
  relativePath: string;
}

export interface ValidatedFishSnapshot {
  sourceId: number;
  name: string;
  status: 'ROWS' | 'EMPTY_CONFIRMED';
  discoveryNameMatch: boolean;
  rowCount: number;
  minimumInt: number | null;
  maximumInt: number | null;
}

export interface KlevalkaSnapshotManifestEntry extends ValidatedFishSnapshot {
  discoveredNames: string[];
  sourceUrl: string;
  path: string;
  sha256: string;
  bytes: number;
}

export interface KlevalkaSnapshotManifestFailure {
  sourceId: number;
  discoveredNames: string[];
  sourceUrl: string;
  path: string;
  code: 'FETCH_FAILED' | 'VALIDATION_FAILED';
  message: string;
}

export interface KlevalkaSnapshotManifest {
  schemaVersion: 1;
  crawlerVersion: string;
  origin: string;
  sourceMode: 'ALL';
  discovery: {
    url: string;
    fishCount: number;
    fishListSha256: string;
  };
  requestDelayMs: number;
  selectedFishCount: number;
  savedFishCount: number;
  failedFishCount: number;
  attemptedFishCount: number;
  complete: boolean;
  pages: KlevalkaSnapshotManifestEntry[];
  failures: KlevalkaSnapshotManifestFailure[];
}

export interface CrawlKlevalkaFishSnapshotsOptions {
  workspaceRoot: string;
  cookieHeader: string;
  maximumFish?: number;
  requestDelayMs?: number;
  fetchImplementation?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\u00a0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizedName(value: string): string {
  return normalizeText(value).toLocaleLowerCase('ru-RU');
}

function linkPath(href: string): string | null {
  try {
    const url = new URL(href, KLEVALKA_ORIGIN);
    return url.origin === KLEVALKA_ORIGIN ? url.pathname : null;
  } catch {
    return null;
  }
}

export function isAuthenticatedKlevalkaHtml(html: string): boolean {
  const document = load(html);
  return document('a[href]')
    .toArray()
    .some((link) => linkPath(document(link).attr('href') ?? '') === '/login/off');
}

export function fishSnapshotRelativePath(sourceId: number): string {
  if (!Number.isSafeInteger(sourceId) || sourceId < 1)
    throw new TypeError('Klevalka Fish source ID must be a positive safe integer');
  return `fish/${sourceId.toString().padStart(8, '0')}.html`;
}

export function discoverKlevalkaFish(html: string): KlevalkaFishDiscovery[] {
  if (!isAuthenticatedKlevalkaHtml(html)) {
    throw new Error('Klevalka Fish index is unauthenticated');
  }
  const document = load(html);
  const byId = new Map<number, KlevalkaFishDiscovery>();
  for (const link of document('#fish_tabs a[href]').toArray()) {
    const name = normalizeText(document(link).text());
    const path = linkPath(document(link).attr('href') ?? '');
    const match = path === null ? null : /^\/fish\/detail\/(\d+)\/?$/u.exec(path);
    if (match === null || name.length === 0) continue;
    const sourceId = Number(match[1]);
    if (!Number.isSafeInteger(sourceId) || sourceId < 1) continue;
    const existing = byId.get(sourceId);
    if (existing !== undefined) {
      if (!existing.discoveredNames.includes(name)) {
        existing.discoveredNames.push(name);
        existing.discoveredNames.sort((left, right) => left.localeCompare(right, 'ru'));
      }
      continue;
    }
    byId.set(sourceId, {
      sourceId,
      discoveredNames: [name],
      allUrl: `${KLEVALKA_ORIGIN}/fish/detail/${sourceId}/all`,
      relativePath: fishSnapshotRelativePath(sourceId),
    });
  }
  if (byId.size === 0) throw new Error('Klevalka Fish index contains no Fish detail links');
  return [...byId.values()].sort((left, right) => left.sourceId - right.sourceId);
}

export function validateKlevalkaFishSnapshot(
  html: string,
  expected: Pick<KlevalkaFishDiscovery, 'sourceId' | 'discoveredNames' | 'relativePath'>,
): ValidatedFishSnapshot {
  if (!isAuthenticatedKlevalkaHtml(html)) {
    throw new Error(`Klevalka Fish ${expected.sourceId} page is unauthenticated`);
  }
  const page = parseKlevalkaHtml(html, expected.relativePath);
  if (page.sourceMode !== 'ALL') {
    throw new Error(
      `Klevalka Fish ${expected.sourceId} page is ${page.sourceMode} mode; ALL is required`,
    );
  }
  const document = load(html);
  const sourceRowCount = document('table#founds_items td.item_total').length;
  const emptyConfirmed =
    sourceRowCount === 0 &&
    document('table#founds_items').length === 0 &&
    normalizeText(document('body').text()).includes(
      'Прискорбно, но поправимо... по данному запросу ничего не найдено.',
    );
  const unexpectedIssues = page.issues.filter(
    (issue) => !(emptyConfirmed && issue.code === 'SOURCE_TABLE_MISSING'),
  );
  if (unexpectedIssues.length > 0) {
    throw new Error(
      `Klevalka Fish ${expected.sourceId} page is invalid: ${unexpectedIssues.map((issue) => issue.code).join(', ')}`,
    );
  }
  if (page.fishNameRaw === null)
    throw new Error(`Klevalka Fish ${expected.sourceId} page has no name`);
  if (sourceRowCount !== page.rows.length) {
    throw new Error(
      `Klevalka Fish ${expected.sourceId} adapter row count ${page.rows.length} does not match source INT cell count ${sourceRowCount}`,
    );
  }
  const changeBestFishIds = [...html.matchAll(/\/fish\/detail\/(\d+)\/['"]?\s*\+\s*stype/gu)].map(
    (match) => Number(match[1]),
  );
  if (
    changeBestFishIds.length !== 1 ||
    !Number.isSafeInteger(changeBestFishIds[0]) ||
    changeBestFishIds[0] !== expected.sourceId
  ) {
    throw new Error(`Klevalka Fish ${expected.sourceId} page does not prove its source ID`);
  }
  const ints = page.rows.map((row) => row.int);
  if (ints.some((value) => value === null)) {
    throw new Error(`Klevalka Fish ${expected.sourceId} page contains an invalid INT`);
  }
  const validInts = ints as number[];
  return {
    sourceId: expected.sourceId,
    name: page.fishNameRaw,
    status: emptyConfirmed ? 'EMPTY_CONFIRMED' : 'ROWS',
    discoveryNameMatch: expected.discoveredNames.some(
      (discoveredName) => normalizedName(discoveredName) === normalizedName(page.fishNameRaw ?? ''),
    ),
    rowCount: page.rows.length,
    minimumInt: validInts.length === 0 ? null : Math.min(...validInts),
    maximumInt: validInts.length === 0 ? null : Math.max(...validInts),
  };
}

function validateCookieHeader(value: string): string {
  const cookieHeader = value.trim();
  if (cookieHeader.length === 0 || /[\r\n]/u.test(cookieHeader) || !cookieHeader.includes('=')) {
    throw new Error('External Klevalka cookie must be a non-empty single-line Cookie header');
  }
  return cookieHeader;
}

export function parseExternalCookieFile(content: string): string {
  const lines = content.split(/\r?\n/gu);
  const netscapeRows = lines
    .filter((line) => line.length > 0 && (!line.startsWith('#') || line.startsWith('#HttpOnly_')))
    .map((line) => line.replace(/^#HttpOnly_/u, '').split('\t'))
    .filter((columns) => columns.length >= 7);
  if (netscapeRows.length > 0) {
    const cookies = netscapeRows
      .filter((columns) => {
        const domain = (columns[0] ?? '').replace(/^\./u, '').toLocaleLowerCase('en-US');
        return domain === 'klevalka.org' || domain.endsWith('.klevalka.org');
      })
      .map((columns) => `${columns[5] ?? ''}=${columns.slice(6).join('\t')}`)
      .filter((cookie) => !cookie.startsWith('='));
    if (cookies.length === 0) throw new Error('Cookie file contains no Klevalka cookies');
    return validateCookieHeader(cookies.join('; '));
  }
  const rawLines = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (rawLines.length !== 1) {
    throw new Error('Raw Cookie header file must contain exactly one non-empty line');
  }
  return validateCookieHeader(rawLines[0] ?? '');
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (value === null) return null;
  if (/^\d+$/u.test(value.trim())) return Math.min(Number(value.trim()) * 1_000, 60_000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.min(Math.max(0, timestamp - Date.now()), 60_000);
}

class ConservativeHtmlClient {
  private lastRequestStartedAt = 0;

  constructor(
    private readonly cookieHeader: string,
    private readonly requestDelayMs: number,
    private readonly fetchImplementation: typeof fetch,
    private readonly sleep: (milliseconds: number) => Promise<void>,
  ) {}

  async get(url: string): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.getOnce(url);
      } catch (error: unknown) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS) await this.sleep(this.requestDelayMs * attempt);
      }
    }
    throw lastError;
  }

  private async getOnce(initialUrl: string): Promise<string> {
    let currentUrl = new URL(initialUrl);
    if (currentUrl.origin !== KLEVALKA_ORIGIN) throw new Error('Refusing non-Klevalka request URL');
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const remainingDelay = this.lastRequestStartedAt + this.requestDelayMs - Date.now();
      if (remainingDelay > 0) await this.sleep(remainingDelay);
      this.lastRequestStartedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.fetchImplementation(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'ru,en;q=0.8',
            cookie: this.cookieHeader,
            'user-agent':
              'Mozilla/5.0 (compatible; fishing-db-klevalka-snapshot/1.0; one-time authenticated archive)',
          },
        });
      } finally {
        clearTimeout(timeout);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (location === null) throw new Error(`HTTP ${response.status} redirect has no Location`);
        currentUrl = new URL(location, currentUrl);
        if (currentUrl.origin !== KLEVALKA_ORIGIN) {
          throw new Error('Refusing to send Klevalka authentication to a cross-origin redirect');
        }
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = retryAfterMilliseconds(response.headers.get('retry-after'));
          if (retryAfter !== null) await this.sleep(retryAfter);
        }
        throw new Error(`Klevalka request failed with HTTP ${response.status}`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new Error('Klevalka response exceeds the maximum snapshot size');
      }
      const html = await response.text();
      if (Buffer.byteLength(html, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new Error('Klevalka response exceeds the maximum snapshot size');
      }
      return html;
    }
    throw new Error('Klevalka request exceeded the redirect limit');
  }
}

function fishListSha256(fish: readonly KlevalkaFishDiscovery[]): string {
  return sha256(
    JSON.stringify(
      fish.map(({ sourceId, discoveredNames, allUrl, relativePath }) => [
        sourceId,
        discoveredNames,
        allUrl,
        relativePath,
      ]),
    ),
  );
}

function validateManifest(value: unknown): KlevalkaSnapshotManifest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid crawler manifest');
  const manifest = value as Partial<KlevalkaSnapshotManifest>;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.crawlerVersion !== KLEVALKA_CRAWLER_VERSION ||
    manifest.origin !== KLEVALKA_ORIGIN ||
    manifest.sourceMode !== 'ALL' ||
    !Array.isArray(manifest.pages)
  ) {
    throw new Error('Existing crawler manifest is incompatible');
  }
  return manifest as KlevalkaSnapshotManifest;
}

async function readManifest(path: string): Promise<KlevalkaSnapshotManifest | null> {
  try {
    return validateManifest(JSON.parse(await readFile(path, 'utf8')) as unknown);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.part`;
  await unlink(temporaryPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
  await rename(temporaryPath, path);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function crawlKlevalkaFishSnapshots(
  options: CrawlKlevalkaFishSnapshotsOptions,
): Promise<{ manifest: KlevalkaSnapshotManifest; fetched: number; reused: number }> {
  const requestDelayMs = options.requestDelayMs ?? KLEVALKA_DEFAULT_REQUEST_DELAY_MS;
  if (!Number.isSafeInteger(requestDelayMs) || requestDelayMs < KLEVALKA_MINIMUM_REQUEST_DELAY_MS) {
    throw new TypeError(
      `requestDelayMs must be an integer of at least ${KLEVALKA_MINIMUM_REQUEST_DELAY_MS}`,
    );
  }
  if (
    options.maximumFish !== undefined &&
    (!Number.isSafeInteger(options.maximumFish) || options.maximumFish < 1)
  ) {
    throw new TypeError('maximumFish must be a positive safe integer');
  }
  const cookieHeader = validateCookieHeader(options.cookieHeader);
  await mkdir(options.workspaceRoot, { recursive: true });
  const client = new ConservativeHtmlClient(
    cookieHeader,
    requestDelayMs,
    options.fetchImplementation ?? fetch,
    options.sleep ?? delay,
  );
  const indexHtml = await client.get(KLEVALKA_FISH_INDEX_URL);
  const discovered = discoverKlevalkaFish(indexHtml);
  const discoverySha256 = fishListSha256(discovered);
  const selected = discovered.slice(0, options.maximumFish);
  const manifestPath = join(options.workspaceRoot, 'manifest.json');
  const existingManifest = await readManifest(manifestPath);
  if (existingManifest !== null && existingManifest.discovery.fishListSha256 !== discoverySha256) {
    throw new Error('Klevalka Fish discovery changed; resume into a new external workspace');
  }
  const entries = new Map(
    (existingManifest?.pages ?? []).map((entry) => [entry.sourceId, entry] as const),
  );
  const failures = new Map(
    (existingManifest?.failures ?? []).map((failure) => [failure.sourceId, failure] as const),
  );
  let fetched = 0;
  let reused = 0;

  const buildManifest = (): KlevalkaSnapshotManifest => {
    const pages = [...entries.values()].sort((left, right) => left.sourceId - right.sourceId);
    const failedPages = [...failures.values()].sort(
      (left, right) => left.sourceId - right.sourceId,
    );
    const attemptedFishCount = pages.length + failedPages.length;
    return {
      schemaVersion: 1,
      crawlerVersion: KLEVALKA_CRAWLER_VERSION,
      origin: KLEVALKA_ORIGIN,
      sourceMode: 'ALL',
      discovery: {
        url: KLEVALKA_FISH_INDEX_URL,
        fishCount: discovered.length,
        fishListSha256: discoverySha256,
      },
      requestDelayMs,
      selectedFishCount: selected.length,
      savedFishCount: pages.length,
      failedFishCount: failedPages.length,
      attemptedFishCount,
      complete: selected.length === discovered.length && attemptedFishCount === selected.length,
      pages,
      failures: failedPages,
    };
  };

  const recordFailure = async (
    fish: KlevalkaFishDiscovery,
    code: KlevalkaSnapshotManifestFailure['code'],
    error: unknown,
  ): Promise<void> => {
    failures.set(fish.sourceId, {
      sourceId: fish.sourceId,
      discoveredNames: fish.discoveredNames,
      sourceUrl: fish.allUrl,
      path: fish.relativePath,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    await atomicWrite(manifestPath, stableJson(buildManifest()));
  };

  for (const fish of selected) {
    const absolutePath = join(options.workspaceRoot, fish.relativePath);
    const previous = entries.get(fish.sourceId);
    if (await fileExists(absolutePath)) {
      const html = await readFile(absolutePath, 'utf8');
      const checksum = sha256(html);
      if (
        previous !== undefined &&
        (previous.path !== fish.relativePath || previous.sha256 !== checksum)
      ) {
        throw new Error(`Existing snapshot metadata or checksum changed for Fish ${fish.sourceId}`);
      }
      const validated = validateKlevalkaFishSnapshot(html, fish);
      entries.set(fish.sourceId, {
        ...validated,
        discoveredNames: fish.discoveredNames,
        sourceUrl: fish.allUrl,
        path: fish.relativePath,
        sha256: checksum,
        bytes: Buffer.byteLength(html, 'utf8'),
      });
      failures.delete(fish.sourceId);
      reused += 1;
    } else {
      if (previous !== undefined) {
        throw new Error(`Manifest snapshot file is missing for Fish ${fish.sourceId}`);
      }
      let html: string;
      try {
        html = await client.get(fish.allUrl);
      } catch (error: unknown) {
        await recordFailure(fish, 'FETCH_FAILED', error);
        continue;
      }
      let validated: ValidatedFishSnapshot;
      try {
        validated = validateKlevalkaFishSnapshot(html, fish);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('page is unauthenticated')) {
          throw error;
        }
        await recordFailure(fish, 'VALIDATION_FAILED', error);
        continue;
      }
      await atomicWrite(absolutePath, html);
      entries.set(fish.sourceId, {
        ...validated,
        discoveredNames: fish.discoveredNames,
        sourceUrl: fish.allUrl,
        path: fish.relativePath,
        sha256: sha256(html),
        bytes: Buffer.byteLength(html, 'utf8'),
      });
      failures.delete(fish.sourceId);
      fetched += 1;
    }
    await atomicWrite(manifestPath, stableJson(buildManifest()));
  }

  const manifest = buildManifest();
  await atomicWrite(manifestPath, stableJson(manifest));
  return { manifest, fetched, reused };
}
