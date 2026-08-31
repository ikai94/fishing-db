import { readFileSync } from 'node:fs';
import { normalizeCatalogName } from '../../catalog/catalog-normalization.js';
import { sha256Hex } from '../cache.js';
import { canonicalizeExternalNumericId } from '../identity.js';
import { FORUM83_ID, FORUM83_SOURCE } from './constants.js';

export interface Forum83TopicBinding {
  topicId: string;
  topicTitle: string;
  baseName: string;
  resolution: 'EXACT' | 'REVIEWED';
}

export interface Forum83TopicMap {
  version: 1;
  source: typeof FORUM83_SOURCE;
  forumId: typeof FORUM83_ID;
  topics: Forum83TopicBinding[];
}

interface FishingCatalogFile {
  schemaVersion: 1;
  bases: Array<{ name: string }>;
}

const TOPIC_MAP_URL = new URL(
  '../../../prisma/catalog-data/forum83-topic-base-map.json',
  import.meta.url,
);
const FISHING_CATALOG_URL = new URL(
  '../../../prisma/catalog-data/fishing-catalog.json',
  import.meta.url,
);

export class Forum83TopicMapError extends Error {
  readonly code = 'FORUM83_TOPIC_MAP_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83TopicMapError';
  }
}

export function loadForum83TopicMap(): {
  map: Forum83TopicMap;
  source: string;
  sha256: string;
} {
  const source = readFileSync(TOPIC_MAP_URL, 'utf8');
  const map = JSON.parse(source) as Forum83TopicMap;
  const catalog = JSON.parse(readFileSync(FISHING_CATALOG_URL, 'utf8')) as FishingCatalogFile;
  validateTopicMap(map, catalog);
  return { map, source, sha256: sha256Hex(source) };
}

export function bindingByTopicId(map: Forum83TopicMap): Map<string, Forum83TopicBinding> {
  return new Map(map.topics.map((binding) => [binding.topicId, binding]));
}

function validateTopicMap(map: Forum83TopicMap, catalog: FishingCatalogFile): void {
  if (
    map.version !== 1 ||
    map.source !== FORUM83_SOURCE ||
    map.forumId !== FORUM83_ID ||
    !Array.isArray(map.topics)
  ) {
    invalid('Header is invalid');
  }
  const topicIds = new Set<string>();
  const normalizedBases = new Set<string>();
  const catalogBases = new Set(
    catalog.bases.map(({ name }) => normalizeCatalogName(name).nameNormalized),
  );

  for (const binding of map.topics) {
    const topicId = canonicalizeExternalNumericId(binding.topicId);
    if (topicId !== binding.topicId || topicIds.has(topicId)) {
      invalid(`Duplicate or noncanonical topic ID ${binding.topicId}`);
    }
    topicIds.add(topicId);
    if (binding.topicTitle.trim() !== binding.topicTitle || binding.topicTitle.length === 0) {
      invalid(`Topic ${topicId} has an invalid title`);
    }
    if (binding.resolution !== 'EXACT' && binding.resolution !== 'REVIEWED') {
      invalid(`Topic ${topicId} has an invalid resolution`);
    }
    const normalizedBase = normalizeCatalogName(binding.baseName).nameNormalized;
    if (!catalogBases.has(normalizedBase) || normalizedBases.has(normalizedBase)) {
      invalid(`Topic ${topicId} has a missing or duplicate canonical Base`);
    }
    normalizedBases.add(normalizedBase);
    const normalizedTitle = normalizeCatalogName(binding.topicTitle).nameNormalized;
    if (binding.resolution === 'EXACT' && normalizedTitle !== normalizedBase) {
      invalid(`Topic ${topicId} is marked EXACT but differs from its Base`);
    }
    if (binding.resolution === 'REVIEWED' && normalizedTitle === normalizedBase) {
      invalid(`Topic ${topicId} is marked REVIEWED but is already exact`);
    }
  }

  if (topicIds.size !== 77 || normalizedBases.size !== 77 || catalogBases.size !== 77) {
    invalid('Topic/Base coverage must be exactly 77 one-to-one bindings');
  }
  for (const base of catalogBases) {
    if (!normalizedBases.has(base)) invalid(`Canonical Base is not covered: ${base}`);
  }
}

function invalid(message: string): never {
  throw new Forum83TopicMapError(message);
}
