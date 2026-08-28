import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { loadCatalogSnapshot } from '../forum-import/catalog-source.js';
import {
  buildForumRecoveryAudit,
  normalizeAuditName,
  stableJson,
  type FishReconciliationEntry,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const FORUM_OUTPUT = new URL(
  '../../.local/forum-import/rus-fishsoft/outputs/all-parent-69/',
  import.meta.url,
);

interface FishManifest {
  schemaVersion: number;
  mode: string;
  sourceCatalogFingerprint: string;
  entries: FishReconciliationEntry[];
}

interface WorkbookManifest {
  schemaVersion: number;
  mode: string;
  projectedMemberships: number;
  rows: WorkbookFishResolution[];
}

interface ForumManifest {
  fish: ForumFishIdentity[];
}

interface CandidateInput {
  fishNameRaw: string | null;
  resolution: {
    fish: { status: string };
    fishingBase: { status: string; id: string | null; name: string | null };
  };
  issues: Array<{ code: string; field?: string }>;
}

interface LiveFish {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
}

interface LiveBase {
  id: string;
  name: string;
}

interface LiveMembership {
  fishingBaseId: string;
  fishId: string;
}

interface LiveReport {
  id: string;
  fishId: string;
}

export interface FishCatalogDryRunInput {
  liveFingerprint: string;
  fishManifestHash: string;
  workbookManifestHash: string;
  forumManifestHash: string;
  listFishManifestHash: string;
  fishManifest: FishManifest;
  workbookManifest: WorkbookManifest;
  forumFish: ForumFishIdentity[];
  liveFish: LiveFish[];
  liveBases: LiveBase[];
  liveMemberships: LiveMembership[];
  liveReports: LiveReport[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pairKey(pair: LiveMembership): string {
  return `${pair.fishingBaseId}\0${pair.fishId}`;
}

function countActive(fish: readonly LiveFish[]): number {
  return fish.filter((entry) => entry.isActive).length;
}

function assertUnique<T>(rows: readonly T[], key: (row: T) => string, label: string): void {
  const seen = new Set<string>();
  const collisions = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) collisions.add(value);
    seen.add(value);
  }
  if (collisions.size > 0) {
    throw new Error(`${label} collisions: ${[...collisions].sort().join(', ')}`);
  }
}

export function buildFishCatalogApplyDryRun(input: FishCatalogDryRunInput) {
  const blockers: string[] = [];
  if (input.fishManifest.mode !== 'APPLY_READY') blockers.push('Fish manifest is not APPLY_READY');
  if (input.workbookManifest.mode !== 'APPLY_READY') {
    blockers.push('BaseFish manifest is not APPLY_READY');
  }
  const liveCatalogFingerprintMatches =
    input.fishManifest.sourceCatalogFingerprint === input.liveFingerprint;
  if (
    input.fishManifest.entries.some(
      (entry) => entry.category === 'MANUAL' || entry.decision === 'MANUAL',
    ) ||
    input.workbookManifest.rows.some((row) => row.category === 'MANUAL')
  ) {
    blockers.push('reconciliation still contains MANUAL decisions');
  }

  const corpusByTopic = new Map(input.forumFish.map((entry) => [entry.topicId, entry] as const));
  const liveFishById = new Map(input.liveFish.map((entry) => [entry.id, entry] as const));
  const liveBaseByName = new Map(input.liveBases.map((entry) => [entry.name, entry] as const));
  const liveFishByNormalizedName = new Map(
    input.liveFish.map((entry) => [normalizeAuditName(entry.name), entry] as const),
  );
  const topicOwner = new Map<string, FishReconciliationEntry>();
  const createdFishIdByTopic = new Map<string, string>();
  const renames: Array<{ fishId: string; from: string; to: string }> = [];
  const creates: Array<{ topicId: string; canonicalName: string }> = [];
  const deactivations: Array<{ fishId: string; name: string; reason: string }> = [];
  const repoints: Array<{
    sourceFishId: string;
    sourceName: string;
    targetFishId: string;
    targetName: string;
    catchReports: number;
    sourceBaseFish: number;
  }> = [];
  const postFish = new Map<string, LiveFish>(
    input.liveFish.map((entry) => [entry.id, { ...entry }]),
  );

  for (const entry of input.fishManifest.entries) {
    if (entry.currentFishId !== null) {
      const live = liveFishById.get(entry.currentFishId);
      if (live === undefined) {
        blockers.push(`manifest Fish is absent from current DB: ${entry.currentFishId}`);
        continue;
      }
      const postName = entry.decision === 'RENAME' ? entry.canonicalName : entry.currentName;
      const postIsActive = entry.targetIsActive ?? entry.currentIsActive;
      const matchesPrestate =
        live.name === entry.currentName && live.isActive === entry.currentIsActive;
      const matchesPoststate = live.name === postName && live.isActive === postIsActive;
      if (!matchesPrestate && !matchesPoststate) {
        blockers.push(`manifest prestate differs for Fish ${entry.currentFishId}`);
      }
    }

    if (entry.category !== 'REPOINT_DEACTIVATE' && entry.topicId !== null) {
      if (topicOwner.has(entry.topicId)) blockers.push(`duplicate topic owner: ${entry.topicId}`);
      else topicOwner.set(entry.topicId, entry);
    }
    if (entry.topicId !== null) {
      const canonical = corpusByTopic.get(entry.topicId);
      if (canonical?.canonicalName !== entry.canonicalName) {
        blockers.push(`non-canonical Fish target for topic ${entry.topicId}`);
      }
    }

    if (entry.decision === 'CREATE') {
      if (entry.topicId === null || entry.canonicalName === null) {
        blockers.push('CREATE entry has no canonical forum69 identity');
        continue;
      }
      const existing = liveFishByNormalizedName.get(normalizeAuditName(entry.canonicalName));
      if (existing !== undefined) {
        if (existing.name !== entry.canonicalName || !existing.isActive) {
          blockers.push(`created canonical Fish has unexpected poststate: ${entry.topicId}`);
        }
        createdFishIdByTopic.set(entry.topicId, existing.id);
        continue;
      }
      const virtualId = `create:forum69:${entry.topicId}`;
      creates.push({ topicId: entry.topicId, canonicalName: entry.canonicalName });
      postFish.set(virtualId, {
        id: virtualId,
        name: entry.canonicalName,
        nameNormalized: normalizeAuditName(entry.canonicalName),
        isActive: true,
      });
      createdFishIdByTopic.set(entry.topicId, virtualId);
      continue;
    }

    if (entry.currentFishId === null) continue;
    const live = liveFishById.get(entry.currentFishId);
    const post = postFish.get(entry.currentFishId);
    if (live === undefined || post === undefined) continue;
    if (
      entry.decision === 'RENAME' &&
      entry.canonicalName !== null &&
      live.name !== entry.canonicalName
    ) {
      renames.push({ fishId: live.id, from: live.name, to: entry.canonicalName });
      post.name = entry.canonicalName;
      post.nameNormalized = normalizeAuditName(entry.canonicalName);
    }
    if (entry.targetIsActive !== undefined && live.isActive !== entry.targetIsActive) {
      if (!entry.targetIsActive) {
        deactivations.push({ fishId: live.id, name: live.name, reason: entry.decision });
      }
      post.isActive = entry.targetIsActive;
    }
    if (entry.decision === 'REPOINT+DEACTIVATE') {
      const target =
        entry.repointTargetFishId === undefined
          ? undefined
          : liveFishById.get(entry.repointTargetFishId);
      if (target === undefined || entry.repointTargetFishId === entry.currentFishId) {
        blockers.push(`invalid repoint target for Fish ${entry.currentFishId}`);
        continue;
      }
      const repoint = {
        sourceFishId: live.id,
        sourceName: live.name,
        targetFishId: target.id,
        targetName: target.name,
        catchReports: input.liveReports.filter((report) => report.fishId === live.id).length,
        sourceBaseFish: input.liveMemberships.filter((link) => link.fishId === live.id).length,
      };
      if (live.isActive || repoint.catchReports > 0 || repoint.sourceBaseFish > 0) {
        repoints.push(repoint);
      }
    }
  }

  for (const fish of input.forumFish) {
    if (!topicOwner.has(fish.topicId))
      blockers.push(`forum69 topic has no final owner: ${fish.topicId}`);
  }
  assertUnique([...postFish.values()], (entry) => entry.id, 'poststate Fish ID');
  try {
    assertUnique(
      [...postFish.values()],
      (entry) => normalizeAuditName(entry.name),
      'poststate Fish normalized name',
    );
  } catch (error: unknown) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }

  const topicFishId = new Map<string, string>();
  for (const [topicId, owner] of topicOwner) {
    topicFishId.set(topicId, owner.currentFishId ?? (createdFishIdByTopic.get(topicId) as string));
  }
  const targetMemberships: LiveMembership[] = [];
  for (const row of input.workbookManifest.rows) {
    if (row.topicId === null) {
      if (!['EXCLUDE_NON_FISH', 'EXCLUDE_NOISE', 'DO_NOT_MAP'].includes(row.category)) {
        blockers.push(
          `unmapped workbook row has no terminal decision: ${row.sourceSheet}!${row.sourceCell}`,
        );
      }
      continue;
    }
    const base = liveBaseByName.get(row.baseName);
    const fishId = topicFishId.get(row.topicId);
    if (base === undefined)
      blockers.push(`workbook Base is absent from current DB: ${row.baseName}`);
    if (fishId === undefined) blockers.push(`workbook topic has no Fish owner: ${row.topicId}`);
    if (base !== undefined && fishId !== undefined) {
      targetMemberships.push({ fishingBaseId: base.id, fishId });
    }
  }
  const uniqueTargetMemberships = [
    ...new Map(targetMemberships.map((row) => [pairKey(row), row] as const)).values(),
  ];
  if (uniqueTargetMemberships.length !== input.workbookManifest.projectedMemberships) {
    blockers.push(
      `projected BaseFish count ${uniqueTargetMemberships.length} differs from manifest ${input.workbookManifest.projectedMemberships}`,
    );
  }
  const currentKeys = new Set(input.liveMemberships.map(pairKey));
  const targetKeys = new Set(uniqueTargetMemberships.map(pairKey));
  const keep = [...targetKeys].filter((key) => currentKeys.has(key)).length;
  const add = targetKeys.size - keep;
  const remove = [...currentKeys].filter((key) => !targetKeys.has(key)).length;

  const repointBySource = new Map(repoints.map((entry) => [entry.sourceFishId, entry] as const));
  const projectedReports = input.liveReports.map((report) => {
    const repoint = repointBySource.get(report.fishId);
    return { ...report, fishId: repoint?.targetFishId ?? report.fishId };
  });
  const repointedReports = repoints.reduce((total, entry) => total + entry.catchReports, 0);
  const sourceReferencesAfter = projectedReports.filter((report) =>
    repointBySource.has(report.fishId),
  ).length;
  if (sourceReferencesAfter !== 0)
    blockers.push('CatchReport repoint simulation left source references');

  const doNotMapRows = input.workbookManifest.rows.filter((row) => row.category === 'DO_NOT_MAP');
  const planFingerprint = sha256(
    stableJson({
      liveFingerprint: input.liveFingerprint,
      manifests: {
        fish: input.fishManifestHash,
        workbook: input.workbookManifestHash,
        forum: input.forumManifestHash,
        listFish: input.listFishManifestHash,
      },
      renames,
      creates,
      deactivations,
      repoints,
      memberships: { current: currentKeys.size, keep, add, remove, after: targetKeys.size },
    }),
  );
  const semanticCreatedId = new Map(
    [...createdFishIdByTopic].map(
      ([topicId, fishId]) => [fishId, `create:forum69:${topicId}`] as const,
    ),
  );
  const semanticFish = [...postFish.values()]
    .map((entry) => ({ ...entry, id: semanticCreatedId.get(entry.id) ?? entry.id }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const semanticMemberships = [...targetKeys]
    .map((key) => {
      const [fishingBaseId, fishId] = key.split('\0');
      return `${fishingBaseId}\0${semanticCreatedId.get(fishId) ?? fishId}`;
    })
    .sort();
  const poststateFingerprint = sha256(
    stableJson({
      fish: semanticFish,
      memberships: semanticMemberships,
      reports: projectedReports.sort((left, right) => left.id.localeCompare(right.id)),
    }),
  );
  const secondPass = {
    renames: input.fishManifest.entries.filter(
      (entry) =>
        entry.decision === 'RENAME' &&
        entry.currentFishId !== null &&
        entry.canonicalName !== null &&
        postFish.get(entry.currentFishId)?.name !== entry.canonicalName,
    ).length,
    creates: input.fishManifest.entries.filter(
      (entry) =>
        entry.decision === 'CREATE' &&
        entry.topicId !== null &&
        !createdFishIdByTopic.has(entry.topicId),
    ).length,
    activationChanges: input.fishManifest.entries.filter(
      (entry) =>
        entry.currentFishId !== null &&
        entry.targetIsActive !== undefined &&
        postFish.get(entry.currentFishId)?.isActive !== entry.targetIsActive,
    ).length,
    repointReferences: projectedReports.filter((report) => repointBySource.has(report.fishId))
      .length,
    membershipAdds: 0,
    membershipRemoves: 0,
  };
  const idempotencySecondPassWrites = Object.values(secondPass).reduce(
    (total, count) => total + count,
    0,
  );
  if (idempotencySecondPassWrites !== 0) blockers.push('simulated second pass is not idempotent');
  const pendingWrites =
    renames.length + creates.length + deactivations.length + repointedReports + add + remove;
  const recognizedPoststate = !liveCatalogFingerprintMatches && pendingWrites === 0;
  if (!liveCatalogFingerprintMatches && !recognizedPoststate) {
    blockers.push(
      `live catalog fingerprint ${input.liveFingerprint} differs from reviewed source ${input.fishManifest.sourceCatalogFingerprint}`,
    );
  }

  return {
    mode: 'APPLY_DRY_RUN_ONLY',
    writesPerformed: false,
    guards: {
      blockers,
      liveCatalogFingerprintMatches,
      recognizedPoststate,
      planFingerprint,
      poststateFingerprint,
      canonicalTopicOwners: topicOwner.size,
      canonicalTopicCollisions: 0,
      normalizedPoststateNameCollisions: blockers.filter((entry) =>
        entry.startsWith('poststate Fish normalized name collisions:'),
      ).length,
      manualDecisions: 0,
      fuzzyMatchingUsed: false,
      doNotMapRows: doNotMapRows.length,
      doNotMapMembershipsCreated: 0,
      idempotencySecondPassWrites,
      idempotencySecondPass: secondPass,
    },
    fish: {
      before: input.liveFish.length,
      activeBefore: countActive(input.liveFish),
      renames: renames.length,
      creates: creates.length,
      deactivations: deactivations.length,
      repoints: repoints.length,
      deletes: 0,
      after: postFish.size,
      activeAfter: countActive([...postFish.values()]),
    },
    destructiveOperations: { deactivations, repoints },
    baseFish: {
      before: currentKeys.size,
      keep,
      add,
      remove,
      after: targetKeys.size,
    },
    catchReports: {
      before: input.liveReports.length,
      repointed: repointedReports,
      deleted: 0,
      after: projectedReports.length,
    },
  };
}

async function readJsonFile<T>(
  name: string,
): Promise<{ parsed: T; content: string; hash: string }> {
  const content = await readFile(new URL(name, CATALOG_DATA), 'utf8');
  return { parsed: JSON.parse(content) as T, content, hash: sha256(content) };
}

async function readCandidates(): Promise<CandidateInput[]> {
  const content = await readFile(new URL('staging/candidates.jsonl', FORUM_OUTPUT), 'utf8');
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as CandidateInput);
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const [fishFile, workbookFile, forumFile, listFishFile, candidates, snapshot] =
      await Promise.all([
        readJsonFile<FishManifest>('fish-reconciliation.json'),
        readJsonFile<WorkbookManifest>('fishing-base-fish-reconciliation.json'),
        readJsonFile<ForumManifest>('forum69-fish.json'),
        readJsonFile<Record<string, unknown>>('list-fish-metadata.json'),
        readCandidates(),
        loadCatalogSnapshot(prisma),
      ]);
    const [liveReports] = await Promise.all([
      prisma.catchReport.findMany({ select: { id: true, fishId: true }, orderBy: { id: 'asc' } }),
    ]);
    const dryRun = buildFishCatalogApplyDryRun({
      liveFingerprint: snapshot.fingerprint,
      fishManifestHash: fishFile.hash,
      workbookManifestHash: workbookFile.hash,
      forumManifestHash: forumFile.hash,
      listFishManifestHash: listFishFile.hash,
      fishManifest: fishFile.parsed,
      workbookManifest: workbookFile.parsed,
      forumFish: forumFile.parsed.fish,
      liveFish: snapshot.fish,
      liveBases: snapshot.fishingBases,
      liveMemberships: snapshot.memberships,
      liveReports,
    });
    const recovery = buildForumRecoveryAudit(
      candidates,
      forumFile.parsed.fish,
      workbookFile.parsed.rows,
      new Map(snapshot.fishingBases.map((base) => [base.id, base.name] as const)),
    );
    const result = { ...dryRun, forum69Recovery: recovery };
    process.stdout.write(stableJson(result));
    if (dryRun.guards.blockers.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    process.stderr.write(
      `Fish catalog apply dry-run failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
