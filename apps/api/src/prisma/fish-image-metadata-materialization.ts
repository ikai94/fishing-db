import { createHash } from 'node:crypto';
import type { FishReconciliationEntry, ForumFishIdentity } from './fish-catalog-audit.js';
import { stableJson } from './fish-catalog-audit.js';
import type { FishImageMetadataManifest } from './fish-image-metadata.js';

export interface LiveFishImageMetadataRow {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
  forumTopicId: string | null;
  officialFishImageKey: number | null;
}

export interface FishImageReconciliationManifest {
  schemaVersion: number;
  mode: string;
  entries: FishReconciliationEntry[];
}

export interface FishImageMaterializationExpectedCounts {
  fish: number;
  owners: number;
  withOfficialFishImageKey: number;
  canonicalWithoutOfficialFishImageKey: number;
  nonOwners: number;
}

export const FISH_IMAGE_MATERIALIZATION_EXPECTED_COUNTS = {
  fish: 1_486,
  owners: 1_479,
  withOfficialFishImageKey: 1_463,
  canonicalWithoutOfficialFishImageKey: 16,
  nonOwners: 7,
} as const satisfies FishImageMaterializationExpectedCounts;

export interface FishImageMaterializationProtectedState {
  fishFingerprint: string;
  fishingBaseFishFingerprint: string;
  catchReportsFingerprint: string;
  fishingBaseFishCount: number;
  catchReportsCount: number;
}

export interface FishImageMaterializationInput {
  sources: {
    fishImageManifestSha256: string;
    fishReconciliationManifestSha256: string;
    forumManifestSha256: string;
  };
  imageManifest: FishImageMetadataManifest;
  reconciliationManifest: FishImageReconciliationManifest;
  forumFish: ForumFishIdentity[];
  liveFish: LiveFishImageMetadataRow[];
  protectedState: FishImageMaterializationProtectedState;
  expectedCounts?: FishImageMaterializationExpectedCounts;
}

export interface FishImageMetadataChange {
  fishId: string;
  fishName: string;
  before: {
    forumTopicId: string | null;
    officialFishImageKey: number | null;
  };
  after: {
    forumTopicId: string;
    officialFishImageKey: number | null;
  };
}

export interface FishImageMaterializationPlan {
  schemaVersion: 1;
  mode: 'FISH_IMAGE_METADATA_MATERIALIZATION';
  planFingerprint: string;
  counts: {
    fish: number;
    owners: number;
    withForumTopicId: { before: number; after: number };
    withOfficialFishImageKey: { before: number; after: number };
    canonicalWithoutOfficialFishImageKey: number;
    nonOwnerFishWithNullMetadata: number;
    writes: number;
  };
  preservation: FishImageMaterializationProtectedState & {
    fishIdsNamesIsActiveUnchanged: true;
    fishingBaseFishUnchanged: true;
    catchReportsUnchanged: true;
  };
  blockers: string[];
  changes: FishImageMetadataChange[];
}

interface DesiredFishImageMetadata {
  fishId: string;
  fishName: string;
  forumTopicId: string;
  officialFishImageKey: number | null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function addDuplicateBlockers<T>(
  rows: readonly T[],
  key: (row: T) => string,
  label: string,
  blockers: string[],
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  for (const value of [...duplicates].sort(compareText)) {
    blockers.push(`${label} is duplicated: ${value}`);
  }
}

function expectedOwnerActiveState(entry: FishReconciliationEntry): boolean {
  if (entry.targetIsActive !== undefined) return entry.targetIsActive;
  if (entry.currentIsActive !== null) return entry.currentIsActive;
  return true;
}

function expectedCountBlockers(
  actual: FishImageMaterializationPlan['counts'],
  expected: FishImageMaterializationExpectedCounts,
): string[] {
  const checks: Array<[string, number, number]> = [
    ['Fish', actual.fish, expected.fish],
    ['forum topic owners', actual.owners, expected.owners],
    [
      'Fish with official image keys',
      actual.withOfficialFishImageKey.after,
      expected.withOfficialFishImageKey,
    ],
    [
      'canonical Fish without official image keys',
      actual.canonicalWithoutOfficialFishImageKey,
      expected.canonicalWithoutOfficialFishImageKey,
    ],
    ['non-owner Fish', actual.nonOwnerFishWithNullMetadata, expected.nonOwners],
  ];

  return checks
    .filter(([, actualCount, expectedCount]) => actualCount !== expectedCount)
    .map(
      ([label, actualCount, expectedCount]) =>
        `${label} count is ${String(actualCount)}; expected ${String(expectedCount)}`,
    );
}

export function fingerprintProtectedRows(rows: readonly unknown[]): string {
  return sha256(stableJson(rows));
}

export function buildFishImageMaterializationPlan(
  input: FishImageMaterializationInput,
): FishImageMaterializationPlan {
  const blockers: string[] = [];
  const expectedCounts = input.expectedCounts ?? FISH_IMAGE_MATERIALIZATION_EXPECTED_COUNTS;
  const liveFish = [...input.liveFish].sort((left, right) => compareText(left.id, right.id));
  addDuplicateBlockers(liveFish, (fish) => fish.id, 'live Fish ID', blockers);
  addDuplicateBlockers(
    liveFish,
    (fish) => fish.nameNormalized,
    'live normalized Fish name',
    blockers,
  );

  if (input.reconciliationManifest.mode !== 'APPLY_READY') {
    blockers.push('Fish reconciliation manifest is not APPLY_READY');
  }
  if (
    input.reconciliationManifest.entries.some(
      (entry) => entry.category === 'MANUAL' || entry.decision === 'MANUAL',
    )
  ) {
    blockers.push('Fish reconciliation manifest still contains MANUAL decisions');
  }

  const liveById = new Map(liveFish.map((fish) => [fish.id, fish] as const));
  const liveByExactName = new Map(liveFish.map((fish) => [fish.name, fish] as const));
  const forumByTopic = new Map(input.forumFish.map((fish) => [fish.topicId, fish] as const));
  addDuplicateBlockers(input.forumFish, (fish) => fish.topicId, 'forum topic ID', blockers);

  const ownerByTopic = new Map<
    string,
    { entry: FishReconciliationEntry; fish: LiveFishImageMetadataRow }
  >();
  const ownerTopicByFishId = new Map<string, string>();

  for (const entry of input.reconciliationManifest.entries) {
    if (entry.topicId === null || entry.category === 'REPOINT_DEACTIVATE') continue;
    if (entry.canonicalName === null) {
      blockers.push(`final topic owner ${entry.topicId} has no canonical name`);
      continue;
    }

    const fish =
      entry.currentFishId === null
        ? liveByExactName.get(entry.canonicalName)
        : liveById.get(entry.currentFishId);
    if (fish === undefined) {
      blockers.push(`final Fish owner is absent for topic ${entry.topicId}`);
      continue;
    }
    if (fish.name !== entry.canonicalName) {
      blockers.push(
        `Fish ${fish.id} name is "${fish.name}"; topic ${entry.topicId} requires "${entry.canonicalName}"`,
      );
    }
    if (fish.isActive !== expectedOwnerActiveState(entry)) {
      blockers.push(`Fish ${fish.id} active state differs for topic ${entry.topicId}`);
    }
    if (ownerByTopic.has(entry.topicId)) {
      blockers.push(`final forum topic owner is duplicated: ${entry.topicId}`);
      continue;
    }
    const previousTopic = ownerTopicByFishId.get(fish.id);
    if (previousTopic !== undefined) {
      blockers.push(`Fish ${fish.id} owns both topics ${previousTopic} and ${entry.topicId}`);
      continue;
    }
    ownerByTopic.set(entry.topicId, { entry, fish });
    ownerTopicByFishId.set(fish.id, entry.topicId);
  }

  for (const forumEntry of input.forumFish) {
    if (!ownerByTopic.has(forumEntry.topicId)) {
      blockers.push(`forum topic has no final Fish owner: ${forumEntry.topicId}`);
    }
  }
  for (const [topicId, owner] of ownerByTopic) {
    const forumEntry = forumByTopic.get(topicId);
    if (forumEntry === undefined) {
      blockers.push(`final Fish owner references an unknown forum topic: ${topicId}`);
    } else if (owner.entry.canonicalName !== forumEntry.canonicalName) {
      blockers.push(`reconciliation and forum canonical names differ for topic ${topicId}`);
    }
  }

  const desiredByFishId = new Map<string, DesiredFishImageMetadata>();
  const desiredImageKeyOwner = new Map<number, string>();
  for (const imageEntry of input.imageManifest.entries) {
    const owner = ownerByTopic.get(imageEntry.forumTopicId);
    if (owner === undefined) {
      blockers.push(`image metadata has no final Fish owner: ${imageEntry.forumTopicId}`);
      continue;
    }
    if (owner.fish.name !== imageEntry.canonicalName) {
      blockers.push(`image metadata canonical name differs for topic ${imageEntry.forumTopicId}`);
    }

    const officialFishImageKey = imageEntry.official?.imageKey ?? null;
    if (officialFishImageKey !== null) {
      if (!Number.isSafeInteger(officialFishImageKey) || officialFishImageKey <= 0) {
        blockers.push(`official Fish image key is invalid for topic ${imageEntry.forumTopicId}`);
      }
      const previousOwner = desiredImageKeyOwner.get(officialFishImageKey);
      if (previousOwner !== undefined) {
        blockers.push(
          `official Fish image key ${String(officialFishImageKey)} belongs to topics ${previousOwner} and ${imageEntry.forumTopicId}`,
        );
      } else {
        desiredImageKeyOwner.set(officialFishImageKey, imageEntry.forumTopicId);
      }
    }
    if (imageEntry.status === 'MISSING' && officialFishImageKey !== null) {
      blockers.push(`MISSING topic has an official Fish image key: ${imageEntry.forumTopicId}`);
    }
    if (imageEntry.status !== 'MISSING' && officialFishImageKey === null) {
      blockers.push(`resolved topic has no official Fish image key: ${imageEntry.forumTopicId}`);
    }

    desiredByFishId.set(owner.fish.id, {
      fishId: owner.fish.id,
      fishName: owner.fish.name,
      forumTopicId: imageEntry.forumTopicId,
      officialFishImageKey,
    });
  }

  const changes: FishImageMetadataChange[] = [];
  for (const fish of liveFish) {
    const desired = desiredByFishId.get(fish.id);
    if (desired === undefined) {
      if (fish.forumTopicId !== null || fish.officialFishImageKey !== null) {
        blockers.push(`non-owner Fish ${fish.id} already has image metadata`);
      }
      continue;
    }
    if (fish.forumTopicId !== null && fish.forumTopicId !== desired.forumTopicId) {
      blockers.push(`Fish ${fish.id} already has a different forum topic ID`);
      continue;
    }
    if (
      fish.officialFishImageKey !== null &&
      fish.officialFishImageKey !== desired.officialFishImageKey
    ) {
      blockers.push(`Fish ${fish.id} already has a different official Fish image key`);
      continue;
    }
    if (
      fish.forumTopicId !== desired.forumTopicId ||
      fish.officialFishImageKey !== desired.officialFishImageKey
    ) {
      changes.push({
        fishId: fish.id,
        fishName: fish.name,
        before: {
          forumTopicId: fish.forumTopicId,
          officialFishImageKey: fish.officialFishImageKey,
        },
        after: {
          forumTopicId: desired.forumTopicId,
          officialFishImageKey: desired.officialFishImageKey,
        },
      });
    }
  }
  changes.sort((left, right) => compareText(left.fishId, right.fishId));

  const counts: FishImageMaterializationPlan['counts'] = {
    fish: liveFish.length,
    owners: desiredByFishId.size,
    withForumTopicId: {
      before: liveFish.filter((fish) => fish.forumTopicId !== null).length,
      after: desiredByFishId.size,
    },
    withOfficialFishImageKey: {
      before: liveFish.filter((fish) => fish.officialFishImageKey !== null).length,
      after: [...desiredByFishId.values()].filter((fish) => fish.officialFishImageKey !== null)
        .length,
    },
    canonicalWithoutOfficialFishImageKey: [...desiredByFishId.values()].filter(
      (fish) => fish.officialFishImageKey === null,
    ).length,
    nonOwnerFishWithNullMetadata: liveFish.length - desiredByFishId.size,
    writes: changes.length,
  };
  blockers.push(...expectedCountBlockers(counts, expectedCounts));

  const metadataBefore = liveFish.map((fish) => ({
    fishId: fish.id,
    forumTopicId: fish.forumTopicId,
    officialFishImageKey: fish.officialFishImageKey,
  }));
  const planFingerprint = sha256(
    stableJson({
      schemaVersion: 1,
      mode: 'FISH_IMAGE_METADATA_MATERIALIZATION',
      sources: input.sources,
      protectedState: input.protectedState,
      metadataBefore,
      targetCounts: counts,
      changes,
    }),
  );

  return {
    schemaVersion: 1,
    mode: 'FISH_IMAGE_METADATA_MATERIALIZATION',
    planFingerprint,
    counts,
    preservation: {
      ...input.protectedState,
      fishIdsNamesIsActiveUnchanged: true,
      fishingBaseFishUnchanged: true,
      catchReportsUnchanged: true,
    },
    blockers: [...new Set(blockers)].sort(compareText),
    changes,
  };
}
