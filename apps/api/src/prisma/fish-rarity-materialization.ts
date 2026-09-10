import { createHash } from 'node:crypto';
import { stableJson } from './fish-catalog-audit.js';

export interface FishRarityManifest {
  schemaVersion: 1;
  version: '2026-09-10';
  mode: 'SET_RAREST_FISH';
  expectedFishCount: 1_471;
  fish: string[];
}

export interface LiveFishRarityRow {
  id: string;
  name: string;
  isRarest: boolean;
}

export interface FishRarityChange extends LiveFishRarityRow {
  desiredIsRarest: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateFishRarityManifest(value: unknown): FishRarityManifest {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 5 ||
    value.schemaVersion !== 1 ||
    value.version !== '2026-09-10' ||
    value.mode !== 'SET_RAREST_FISH' ||
    value.expectedFishCount !== 1_471 ||
    !Array.isArray(value.fish) ||
    value.fish.length !== 295 ||
    value.fish.some(
      (name) => typeof name !== 'string' || name.length === 0 || name.trim() !== name,
    ) ||
    new Set(value.fish).size !== value.fish.length
  ) {
    throw new Error('Fish rarity manifest is invalid');
  }

  const fish = value.fish as string[];
  if (stableJson([...fish].sort()) !== stableJson(fish)) {
    throw new Error('Fish rarity names are not sorted');
  }
  return value as unknown as FishRarityManifest;
}

export function buildFishRarityMaterializationPlan(input: {
  manifestSha256: string;
  manifest: FishRarityManifest;
  liveFish: readonly LiveFishRarityRow[];
}) {
  const targetNames = new Set(input.manifest.fish);
  const blockers: string[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  for (const fish of input.liveFish) {
    if (seenIds.has(fish.id)) blockers.push(`duplicate live Fish ID: ${fish.id}`);
    if (seenNames.has(fish.name)) blockers.push(`duplicate live Fish name: ${fish.name}`);
    seenIds.add(fish.id);
    seenNames.add(fish.name);
  }

  if (input.liveFish.length !== input.manifest.expectedFishCount) {
    blockers.push(
      `Fish count is ${String(input.liveFish.length)}; expected ${String(input.manifest.expectedFishCount)}`,
    );
  }

  for (const name of input.manifest.fish) {
    if (!seenNames.has(name)) blockers.push(`manifest Fish is missing: ${name}`);
  }

  const changes: FishRarityChange[] = input.liveFish
    .filter((fish) => fish.isRarest !== targetNames.has(fish.name))
    .map((fish) => ({ ...fish, desiredIsRarest: targetNames.has(fish.name) }))
    .sort((left, right) => compareText(left.name, right.name));
  const rareBefore = input.liveFish.filter((fish) => fish.isRarest).length;
  const rareAfter = input.liveFish.filter((fish) => targetNames.has(fish.name)).length;
  const planBody = {
    schemaVersion: 1,
    mode: 'FISH_RARITY_MATERIALIZATION',
    manifestSha256: input.manifestSha256,
    manifestVersion: input.manifest.version,
    counts: {
      fish: input.liveFish.length,
      rareBefore,
      rareAfter,
      notRareAfter: input.liveFish.length - rareAfter,
      writes: changes.length,
    },
    blockers: [...new Set(blockers)].sort(),
    changes,
  };
  const planFingerprint = createHash('sha256').update(stableJson(planBody)).digest('hex');

  return { ...planBody, planFingerprint };
}
