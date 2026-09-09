import { readFile } from 'node:fs/promises';
import { normalizeCatalogName } from '../catalog/catalog-normalization.js';
import type { OfficialRecordSourceRow } from './records-source.js';

type CatalogFish = {
  id: string;
  nameNormalized: string;
  forumTopicId: string | null;
  officialFishImageKey: number | null;
};
type CatalogBase = { id: string; nameNormalized: string };
type MappingEntry = { forumTopicId?: unknown; official?: { imageKey?: unknown } | null };
type LocalMappingEntry = { forumTopicId?: unknown; imageKey?: unknown };
type ForumMappingEntry = {
  topicId?: unknown;
  canonicalNameNormalized?: unknown;
  aliases?: Array<{ nameNormalized?: unknown }>;
};

export type OfficialFishMapping = {
  byImageKey: ReadonlyMap<number, string>;
  byNameNormalized: ReadonlyMap<string, string>;
};

export type ResolvedOfficialRecordRow = OfficialRecordSourceRow & {
  fishId: string;
  fishingBaseId: string | null;
};

let mappingPromise: Promise<OfficialFishMapping> | undefined;

async function loadMapping(): Promise<OfficialFishMapping> {
  const metadataPath = new URL(
    '../../prisma/catalog-data/fish-image-metadata.json',
    import.meta.url,
  );
  const localMappingsPath = new URL(
    '../../prisma/catalog-data/fish-image-local-mappings-20260909.json',
    import.meta.url,
  );
  const forumMappingPath = new URL('../../prisma/catalog-data/forum69-fish.json', import.meta.url);
  const [document, localDocument, forumDocument] = (
    await Promise.all([
      readFile(metadataPath, 'utf8'),
      readFile(localMappingsPath, 'utf8'),
      readFile(forumMappingPath, 'utf8'),
    ])
  ).map((value) => JSON.parse(value) as { entries?: unknown; mappings?: unknown; fish?: unknown });
  if (!Array.isArray(document.entries)) throw new Error('Official Fish mapping is invalid');
  if (!Array.isArray(localDocument.mappings)) {
    throw new Error('Approved local Fish mapping is invalid');
  }
  if (!Array.isArray(forumDocument.fish)) {
    throw new Error('Reviewed forum Fish mapping is invalid');
  }
  const byImageKey = new Map<number, string>();
  const byNameNormalized = new Map<string, string>();
  const ambiguousNames = new Set<string>();
  const addMapping = (imageKey: number, topicId: string) => {
    const existing = byImageKey.get(imageKey);
    if (existing !== undefined && existing !== topicId) {
      throw new Error(`Conflicting official Fish image key ${imageKey}`);
    }
    byImageKey.set(imageKey, topicId);
  };
  for (const raw of document.entries as MappingEntry[]) {
    const imageKey = raw.official?.imageKey;
    const topicId = raw.forumTopicId;
    if (typeof imageKey !== 'number' || typeof topicId !== 'string') continue;
    addMapping(imageKey, topicId);
  }
  for (const raw of localDocument.mappings as LocalMappingEntry[]) {
    if (typeof raw.imageKey !== 'number' || typeof raw.forumTopicId !== 'string') {
      throw new Error('Approved local Fish mapping entry is invalid');
    }
    addMapping(raw.imageKey, raw.forumTopicId);
  }
  for (const raw of forumDocument.fish as ForumMappingEntry[]) {
    if (
      typeof raw.topicId !== 'string' ||
      typeof raw.canonicalNameNormalized !== 'string' ||
      !Array.isArray(raw.aliases)
    ) {
      throw new Error('Reviewed forum Fish mapping entry is invalid');
    }
    const names = [
      raw.canonicalNameNormalized,
      ...raw.aliases.map((alias) => alias.nameNormalized),
    ];
    for (const name of names) {
      if (typeof name !== 'string') throw new Error('Reviewed forum Fish alias is invalid');
      const existing = byNameNormalized.get(name);
      if (existing !== undefined && existing !== raw.topicId) {
        ambiguousNames.add(name);
        byNameNormalized.delete(name);
      } else if (!ambiguousNames.has(name)) {
        byNameNormalized.set(name, raw.topicId);
      }
    }
  }
  return { byImageKey, byNameNormalized };
}

export function resolveOfficialRecordRows(
  rows: readonly OfficialRecordSourceRow[],
  fish: readonly CatalogFish[],
  bases: readonly CatalogBase[],
  officialMapping: OfficialFishMapping,
): ResolvedOfficialRecordRow[] {
  const fishByTopic = new Map(
    fish.filter((row) => row.forumTopicId !== null).map((row) => [row.forumTopicId, row]),
  );
  const fishByImage = new Map(
    fish
      .filter((row) => row.officialFishImageKey !== null)
      .map((row) => [row.officialFishImageKey, row]),
  );
  const fishByName = new Map(fish.map((row) => [row.nameNormalized, row]));
  const baseByName = new Map(bases.map((row) => [row.nameNormalized, row]));
  const resolved: ResolvedOfficialRecordRow[] = [];
  const seenFish = new Set<string>();

  for (const row of rows) {
    const normalizedName = normalizeCatalogName(row.fishName).nameNormalized;
    const topicByImage = officialMapping.byImageKey.get(row.imageKey);
    const topicByName = officialMapping.byNameNormalized.get(normalizedName);
    if (topicByImage !== undefined && topicByName !== undefined && topicByImage !== topicByName) {
      throw new Error(`Official Fish source identifiers disagree for ${row.fishName}`);
    }
    const topicId = topicByImage ?? topicByName;
    if (topicId === undefined) throw new Error(`Unknown official Fish image key ${row.imageKey}`);
    const byTopic = fishByTopic.get(topicId);
    const byImage = fishByImage.get(row.imageKey);
    const byName = fishByName.get(normalizedName);
    if (byTopic === undefined) {
      if (byImage !== undefined || byName !== undefined) {
        throw new Error(`Official Fish mapping conflict for ${row.fishName}`);
      }
      continue;
    }
    if (
      (byImage !== undefined && byImage.id !== byTopic.id) ||
      (byName !== undefined && byName.id !== byTopic.id)
    ) {
      throw new Error(`Official Fish identifiers disagree for ${row.fishName}`);
    }
    if (byTopic.officialFishImageKey !== row.imageKey) {
      throw new Error(`Catalog image key disagrees for ${row.fishName}`);
    }
    if (seenFish.has(byTopic.id)) throw new Error(`Duplicate official record for ${row.fishName}`);
    seenFish.add(byTopic.id);
    resolved.push({
      ...row,
      fishId: byTopic.id,
      fishingBaseId: baseByName.get(normalizeCatalogName(row.waterbody).nameNormalized)?.id ?? null,
    });
  }
  return resolved;
}

export async function getOfficialFishMapping(): Promise<OfficialFishMapping> {
  mappingPromise ??= loadMapping();
  return mappingPromise;
}
