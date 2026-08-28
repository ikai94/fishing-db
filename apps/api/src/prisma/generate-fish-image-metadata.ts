import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { stableJson, type ForumFishIdentity } from './fish-catalog-audit.js';
import {
  buildFishImageManualReviewAudit,
  buildFishImageMetadataManifest,
  fishImageManifestSha256,
  parseOfficialFishDetailHtml,
  parseOfficialFishListHtml,
  validateFishImageMetadataManifest,
  type FishImageMetadataManifest,
  type OfficialFishEvidence,
  type OfficialFishListEntry,
} from './fish-image-metadata.js';

const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const FORUM_MANIFEST = new URL('forum69-fish.json', CATALOG_DATA);
const IMAGE_MANIFEST = new URL('fish-image-metadata.json', CATALOG_DATA);
const MANUAL_REVIEW = new URL('fish-image-manual-review.audit.json', CATALOG_DATA);
const LEGACY_MANIFEST = new URL('list-fish-metadata.json', CATALOG_DATA);
const EXPECTED_LEGACY_SHA256 = 'c39448d115651046ff63f5de13d034877badd1de5b1a3c6b470542d91ea71ed0';
const ORIGIN = 'https://rus-fishsoft.ru';

interface ForumManifest {
  fish: ForumFishIdentity[];
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      return await response.text();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  throw lastError;
}

function advertisedLetters(listPageHtml: string): string[] {
  const $ = load(listPageHtml);
  const letters = $('.abcList a')
    .map((_index, element) => {
      const href = $(element).attr('href') ?? '';
      const hash = href.startsWith('#') ? href.slice(1) : '';
      const parameters = new URLSearchParams(hash);
      if (parameters.get('to') !== 'data' || parameters.get('sc') !== 'fish_list') return null;
      return parameters.get('sort');
    })
    .get()
    .filter((letter): letter is string => typeof letter === 'string' && letter.length > 0);
  if (letters.length === 0 || new Set(letters).size !== letters.length) {
    throw new Error('Official list page has no unique advertised Fish letters');
  }
  return letters;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= values.length) return;
        const value = values[index];
        if (value === undefined) throw new Error('Concurrent input disappeared');
        results[index] = await mapper(value);
      }
    }),
  );
  return results;
}

async function captureOfficialEvidence(): Promise<OfficialFishEvidence[]> {
  const listPageHtml = await fetchText(`${ORIGIN}/list-fish.html`);
  const letters = advertisedLetters(listPageHtml);
  const listPages = await mapConcurrent(letters, 6, async (letter) => {
    const body = new URLSearchParams({
      'vars[to]': 'data',
      'vars[sc]': 'fish_list',
      'vars[sort]': letter,
    });
    return fetchText(`${ORIGIN}/ajaxcontent.html`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    });
  });
  const listEntries = listPages.flatMap(parseOfficialFishListHtml);
  return mapConcurrent<OfficialFishListEntry, OfficialFishEvidence>(
    listEntries,
    16,
    async (entry) => {
      const html = await fetchText(new URL(entry.detailPath, `${ORIGIN}/`).href);
      return parseOfficialFishDetailHtml(entry, html);
    },
  );
}

async function assertLegacyManifestUnchanged(): Promise<string> {
  const content = await readFile(LEGACY_MANIFEST, 'utf8');
  const hash = fishImageManifestSha256(content);
  if (hash !== EXPECTED_LEGACY_SHA256) {
    throw new Error(`Frozen list-fish-metadata.json hash changed: ${hash}`);
  }
  return hash;
}

async function writeArtifacts(forumFish: readonly ForumFishIdentity[]): Promise<void> {
  const official = await captureOfficialEvidence();
  const manifest = buildFishImageMetadataManifest(forumFish, official, new Date().toISOString());
  await writeManifestArtifacts(manifest);
}

async function reclassifyArtifacts(forumFish: readonly ForumFishIdentity[]): Promise<void> {
  const current = await readJson<FishImageMetadataManifest>(IMAGE_MANIFEST);
  const official = current.entries.flatMap((entry) =>
    entry.official === null ? entry.candidates : [entry.official],
  );
  const manifest = buildFishImageMetadataManifest(forumFish, official, current.source.capturedAt);
  await writeManifestArtifacts(manifest);
}

async function writeManifestArtifacts(manifest: FishImageMetadataManifest): Promise<void> {
  const manualReview = buildFishImageManualReviewAudit(manifest);
  await writeFile(IMAGE_MANIFEST, stableJson(manifest), 'utf8');
  await writeFile(MANUAL_REVIEW, stableJson(manualReview), 'utf8');
}

async function readOptionalText(url: URL): Promise<string | null> {
  try {
    return await readFile(url, 'utf8');
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function checkArtifacts(forumFish: readonly ForumFishIdentity[]): Promise<{
  manifest: FishImageMetadataManifest;
  manifestContent: string;
}> {
  const manifestContent = await readFile(IMAGE_MANIFEST, 'utf8');
  const manifest = validateFishImageMetadataManifest(
    JSON.parse(manifestContent) as unknown,
    forumFish,
  );
  if (manifestContent !== stableJson(manifest)) {
    throw new Error('fish-image-metadata.json formatting is not deterministic');
  }
  const expectedManualReview = stableJson(buildFishImageManualReviewAudit(manifest));
  const currentManualReview = await readOptionalText(MANUAL_REVIEW);
  if (currentManualReview !== null && currentManualReview !== expectedManualReview) {
    throw new Error(`Manual Fish image review is stale: ${fileURLToPath(MANUAL_REVIEW)}`);
  }
  return { manifest, manifestContent };
}

async function run(): Promise<void> {
  const check = process.argv.slice(2).includes('--check');
  const reclassify = process.argv.slice(2).includes('--reclassify');
  if (check && reclassify) throw new Error('--check and --reclassify are mutually exclusive');
  const forum = await readJson<ForumManifest>(FORUM_MANIFEST);
  const legacyManifestSha256 = await assertLegacyManifestUnchanged();
  if (reclassify) await reclassifyArtifacts(forum.fish);
  else if (!check) await writeArtifacts(forum.fish);
  const { manifest, manifestContent } = await checkArtifacts(forum.fish);
  process.stdout.write(
    stableJson({
      mode: check ? 'check' : reclassify ? 'reclassify' : 'write',
      counts: manifest.counts,
      officialEntries: manifest.source.officialEntries,
      manualReviewRows: manifest.counts.MANUAL,
      manifestSha256: fishImageManifestSha256(manifestContent),
      legacyManifestSha256,
      networkUsed: !check && !reclassify,
      imageBinariesDownloaded: false,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish image metadata generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
