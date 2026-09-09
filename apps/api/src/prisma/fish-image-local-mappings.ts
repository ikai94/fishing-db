export interface FishImageLocalMapping {
  forumTopicId: string;
  canonicalFish: string;
  imageKey: number;
  fileName: string;
  sha256: string;
}

export interface FishImageLocalMappingManifest {
  schemaVersion: 1;
  mode: 'APPROVED_LOCAL_FISH_IMAGE_MAPPINGS';
  sourceDirectory: 'apps/api/.local/fish-images/source';
  mappings: FishImageLocalMapping[];
}

interface FishImageMetadataEntryLike {
  forumTopicId: string;
  canonicalName: string;
  status: string;
  official: { imageKey: number } | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return (
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key))
  );
}

export function validateFishImageLocalMappingManifest(
  value: unknown,
): FishImageLocalMappingManifest {
  if (
    !isObject(value) ||
    !exactKeys(value, ['schemaVersion', 'mode', 'sourceDirectory', 'mappings']) ||
    value.schemaVersion !== 1 ||
    value.mode !== 'APPROVED_LOCAL_FISH_IMAGE_MAPPINGS' ||
    value.sourceDirectory !== 'apps/api/.local/fish-images/source' ||
    !Array.isArray(value.mappings)
  ) {
    throw new Error('local Fish image mapping manifest header is invalid');
  }

  const mappings: FishImageLocalMapping[] = [];
  const topicIds = new Set<string>();
  const names = new Set<string>();
  const imageKeys = new Set<number>();
  let previousTopicId: bigint | null = null;

  for (const [index, mapping] of value.mappings.entries()) {
    if (
      !isObject(mapping) ||
      !exactKeys(mapping, ['forumTopicId', 'canonicalFish', 'imageKey', 'fileName', 'sha256']) ||
      typeof mapping.forumTopicId !== 'string' ||
      !/^[1-9]\d*$/u.test(mapping.forumTopicId) ||
      typeof mapping.canonicalFish !== 'string' ||
      mapping.canonicalFish.trim() !== mapping.canonicalFish ||
      mapping.canonicalFish.length === 0 ||
      typeof mapping.imageKey !== 'number' ||
      !Number.isSafeInteger(mapping.imageKey) ||
      mapping.imageKey <= 0 ||
      mapping.fileName !== `${String(mapping.imageKey)}.png` ||
      typeof mapping.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(mapping.sha256)
    ) {
      throw new Error(`local Fish image mapping ${String(index)} is invalid`);
    }

    const topicId = BigInt(mapping.forumTopicId);
    if (previousTopicId !== null && topicId <= previousTopicId) {
      throw new Error('local Fish image mappings are not ordered by forum topic ID');
    }
    previousTopicId = topicId;
    if (topicIds.has(mapping.forumTopicId)) throw new Error('duplicate local mapping topic ID');
    if (names.has(mapping.canonicalFish)) throw new Error('duplicate local mapping Fish name');
    if (imageKeys.has(mapping.imageKey)) throw new Error('duplicate local mapping image key');
    topicIds.add(mapping.forumTopicId);
    names.add(mapping.canonicalFish);
    imageKeys.add(mapping.imageKey);
    mappings.push(mapping as unknown as FishImageLocalMapping);
  }

  return { ...value, mappings } as unknown as FishImageLocalMappingManifest;
}

export function fishImageLocalKeyByTopicId(
  manifest: FishImageLocalMappingManifest,
): ReadonlyMap<string, number> {
  return new Map(manifest.mappings.map((mapping) => [mapping.forumTopicId, mapping.imageKey]));
}

export function validateFishImageLocalMappingsAgainstMetadata(
  manifest: FishImageLocalMappingManifest,
  entries: readonly FishImageMetadataEntryLike[],
): void {
  const entryByTopicId = new Map(entries.map((entry) => [entry.forumTopicId, entry]));
  const officialKeys = new Set(
    entries.flatMap((entry) => (entry.official === null ? [] : [entry.official.imageKey])),
  );

  for (const mapping of manifest.mappings) {
    const entry = entryByTopicId.get(mapping.forumTopicId);
    if (
      entry === undefined ||
      entry.canonicalName !== mapping.canonicalFish ||
      entry.status !== 'MISSING' ||
      entry.official !== null
    ) {
      throw new Error(
        `local Fish image mapping target differs from missing metadata: ${mapping.forumTopicId}`,
      );
    }
    if (officialKeys.has(mapping.imageKey)) {
      throw new Error(
        `local Fish image key is already assigned by official metadata: ${String(mapping.imageKey)}`,
      );
    }
  }
}
