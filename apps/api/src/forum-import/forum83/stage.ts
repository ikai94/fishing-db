import { join } from 'node:path';
import { normalizeCatalogName } from '../../catalog/catalog-normalization.js';
import { createPrismaAdapter } from '../../prisma/prisma-adapter.js';
import {
  assertCandidateIdentityStable,
  buildCandidateIdentityManifest,
  CandidateIdentityDriftError,
  type CandidateIdentityManifest,
} from '../candidate-identity-manifest.js';
import { readJsonFile, sha256Hex, writeFileAtomic, writeJsonAtomic } from '../cache.js';
import { resolveForumCandidates, type ResolvedForumCandidate } from '../catalog-resolver.js';
import { loadCatalogSnapshot, type CatalogSnapshot } from '../catalog-source.js';
import type { ForumLocalStore } from '../cache.js';
import {
  buildStagingArtifacts,
  serializeDeterministicJson,
  toStagingCandidate,
  writeStagingFiles,
} from '../staging.js';
import { FORUM83_ID, FORUM83_IMPORT_KEY_PATTERN, FORUM83_SOURCE } from './constants.js';
import { parseForum83Post, type Forum83ParsedCandidate } from './parser.js';
import {
  assertForum83ReviewedResolutionTargets,
  forum83CatalogRawOverride,
} from './reviewed-decisions.js';
import { readForum83TechnicalPosts, type Forum83ScanManifest } from './scanner.js';
import { forum83ScopeKey, type Forum83ScanScope } from './scope.js';
import { bindingByTopicId, loadForum83TopicMap } from './topic-map.js';

interface Forum83CandidateIdentityArtifact {
  version: 1;
  source: typeof FORUM83_SOURCE;
  importKeyNamespace: 'rus-fishsoft/forum83/post-candidate/v1';
  candidateIdentities: CandidateIdentityManifest;
}

export interface Forum83Audit {
  version: 1;
  source: typeof FORUM83_SOURCE;
  scopeKey: string;
  topicsDiscovered: number;
  topicsScanned: number;
  postsScanned: number;
  zeroCatchPosts: number;
  candidatesExtracted: number;
  multiCandidatePosts: number;
  locationContextCounts: { EXPLICIT: number; INHERITED: number };
  candidateStatusCounts: {
    USABLE_COMPLETE: number;
    USABLE_PARTIAL: number;
    UNRESOLVED: number;
  };
  resolutionCounts: {
    fish: ResolutionCounts;
    fishingBase: ResolutionCounts;
    location: ResolutionCounts;
    bait: ResolutionCounts;
    fishingBaseFish: ResolutionCounts;
  };
  duplicateImportKeys: number;
  externalContributorCount: number;
  sourceChangedPostIds: string[];
  catalogSnapshotFingerprint: string;
  hashes: {
    scan: string;
    topicMap: string;
    candidateIdentities: string;
    candidatesJsonl: string;
    candidatesCsv: string;
  };
  examples: Forum83AuditExample[];
}

interface ResolutionCounts {
  RESOLVED: number;
  MISSING: number;
  UNRESOLVED: number;
}

interface Forum83AuditExample {
  topicId: string;
  postId: string;
  candidateOrdinal: number;
  importKey: string;
  status: 'USABLE_COMPLETE' | 'USABLE_PARTIAL' | 'UNRESOLVED';
  fishNameRaw: string | null;
  weightGrams: number | null;
  fishingBaseRaw: string | null;
  locationRaw: string | null;
  baitRaw: string | null;
  locationContext: 'EXPLICIT' | 'INHERITED';
  issues: Array<{ code: string; field?: string }>;
}

export interface Forum83StageSummary {
  scopeKey: string;
  postsScanned: number;
  candidatesExtracted: number;
  zeroCatchPosts: number;
  multiCandidatePosts: number;
  locationContextCounts: { EXPLICIT: number; INHERITED: number };
  candidateStatusCounts: Forum83Audit['candidateStatusCounts'];
  catalogSnapshotFingerprint: string;
  outputDirectory: string;
  examples: Forum83AuditExample[];
}

export class Forum83StageError extends Error {
  readonly code = 'FORUM83_STAGE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83StageError';
  }
}

export async function stageForum83(
  scope: Forum83ScanScope,
  store: ForumLocalStore,
  environment: NodeJS.ProcessEnv,
): Promise<Forum83StageSummary> {
  const scopeKey = forum83ScopeKey(scope);
  const outputDirectory = store.outputDirectory(scopeKey);
  const scanPath = join(outputDirectory, 'technical', 'scan.json');
  const scan = await requiredJson<Forum83ScanManifest>(scanPath);
  assertScan(scan, scope);
  if (scan.sourceChangedPostIds.length > 0) {
    throw new Forum83StageError(
      `Pinned forum83 source changed for post(s): ${scan.sourceChangedPostIds.join(', ')}`,
    );
  }
  const databaseUrl = environment.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    throw new Forum83StageError('DATABASE_URL is required for read-only catalog resolution');
  }
  const posts = await readForum83TechnicalPosts(store, scan.postIds);
  const topicMap = loadForum83TopicMap();
  if (scan.topicMapSha256 !== topicMap.sha256) {
    throw new Forum83StageError('Scan topic map differs from the approved topic map');
  }

  const { PrismaClient } = await import('../../generated/prisma/client.js');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const catalog = await prisma.$transaction((transaction) => loadCatalogSnapshot(transaction), {
      isolationLevel: 'RepeatableRead',
    });
    assertForum83ReviewedResolutionTargets(catalog);
    const parsed = parsePosts(posts, topicMap.map, catalog);
    const candidateIdentities = buildCandidateIdentityManifest(scopeKey, posts, parsed);
    const identityArtifact: Forum83CandidateIdentityArtifact = {
      version: 1,
      source: FORUM83_SOURCE,
      importKeyNamespace: 'rus-fishsoft/forum83/post-candidate/v1',
      candidateIdentities,
    };
    const identitiesPath = join(outputDirectory, 'technical', 'candidate-identities.json');
    const previous = await readJsonFile<Forum83CandidateIdentityArtifact>(identitiesPath);
    if (previous !== null) {
      if (
        previous.version !== 1 ||
        previous.source !== FORUM83_SOURCE ||
        previous.importKeyNamespace !== identityArtifact.importKeyNamespace
      ) {
        throw new Forum83StageError('Pinned forum83 identity artifact is invalid');
      }
      try {
        assertCandidateIdentityStable(previous.candidateIdentities, candidateIdentities);
      } catch (error: unknown) {
        if (!(error instanceof CandidateIdentityDriftError)) throw error;
        await writeJsonAtomic(
          join(outputDirectory, 'technical', 'candidate-identities.drift.json'),
          identityArtifact,
        );
        throw error;
      }
    }

    const resolved = resolveForumCandidates(parsed, catalog, {
      importKeyPattern: FORUM83_IMPORT_KEY_PATTERN,
      catalogRawOverride: forum83CatalogRawOverride,
    });
    const staging = buildStagingArtifacts(resolved, catalog.fingerprint);
    const candidatesFiles = {
      'candidates.csv': staging.candidatesCsv,
      'candidates.jsonl': staging.candidatesJsonl,
    };
    const identitySource = serializeDeterministicJson(identityArtifact);
    const scanSource = serializeDeterministicJson(scan);
    const audit = buildAudit(
      scan,
      posts.map(({ postId }) => postId),
      parsed,
      resolved,
      catalog.fingerprint,
      {
        scan: sha256Hex(scanSource),
        topicMap: topicMap.sha256,
        candidateIdentities: sha256Hex(identitySource),
        candidatesJsonl: sha256Hex(staging.candidatesJsonl),
        candidatesCsv: sha256Hex(staging.candidatesCsv),
      },
    );
    const forum83Manifest = {
      version: 1,
      source: FORUM83_SOURCE,
      scopeKey,
      catalogSnapshotFingerprint: catalog.fingerprint,
      candidatesCount: staging.candidates.length,
      auditSha256: sha256Hex(serializeDeterministicJson(audit)),
      hashes: audit.hashes,
      files: Object.entries(candidatesFiles).map(([path, source]) => ({
        path,
        sha256: sha256Hex(source),
      })),
    };
    const review = serializeReview(posts, parsed, resolved);

    await writeJsonAtomic(identitiesPath, identityArtifact);
    await writeJsonAtomic(join(outputDirectory, 'technical', 'catalog-snapshot.json'), catalog);
    await writeStagingFiles(join(outputDirectory, 'staging'), {
      ...candidatesFiles,
      'manifest.json': serializeDeterministicJson(forum83Manifest),
    });
    await writeJsonAtomic(join(outputDirectory, 'audit', 'audit.json'), audit);
    await writeFileAtomic(join(outputDirectory, 'review', 'posts.jsonl'), review);

    return {
      scopeKey,
      postsScanned: audit.postsScanned,
      candidatesExtracted: audit.candidatesExtracted,
      zeroCatchPosts: audit.zeroCatchPosts,
      multiCandidatePosts: audit.multiCandidatePosts,
      locationContextCounts: audit.locationContextCounts,
      candidateStatusCounts: audit.candidateStatusCounts,
      catalogSnapshotFingerprint: catalog.fingerprint,
      outputDirectory,
      examples: audit.examples,
    };
  } finally {
    await prisma.$disconnect();
  }
}

function parsePosts(
  posts: readonly import('../candidate-types.js').TechnicalForumPost[],
  topicMap: ReturnType<typeof loadForum83TopicMap>['map'],
  catalog: CatalogSnapshot,
): Forum83ParsedCandidate[] {
  const bindings = bindingByTopicId(topicMap);
  const parsed: Forum83ParsedCandidate[] = [];
  for (const post of posts) {
    const binding = bindings.get(post.topicId);
    if (binding === undefined || binding.topicTitle !== post.topicTitle) {
      throw new Forum83StageError(`Post ${post.postId} has no approved topic context`);
    }
    const baseNormalized = normalizeCatalogName(binding.baseName).nameNormalized;
    const baseMatches = catalog.fishingBases.filter(
      ({ nameNormalized }) => nameNormalized === baseNormalized,
    );
    if (baseMatches.length !== 1) {
      throw new Forum83StageError(`Topic ${post.topicId} Base is not uniquely canonical`);
    }
    const base = baseMatches[0];
    if (base === undefined) throw new Forum83StageError(`Topic ${post.topicId} Base is missing`);
    parsed.push(
      ...parseForum83Post(post, {
        baseName: binding.baseName,
        locationNames: catalog.locations
          .filter(({ fishingBaseId }) => fishingBaseId === base.id)
          .map(({ name }) => name),
        fishNames: catalog.fish.map(({ name }) => name),
        baitNames: catalog.baits.map(({ name }) => name),
      }),
    );
  }
  return parsed;
}

function buildAudit(
  scan: Forum83ScanManifest,
  postIds: readonly string[],
  parsed: readonly Forum83ParsedCandidate[],
  resolved: readonly ResolvedForumCandidate[],
  catalogSnapshotFingerprint: string,
  hashes: Forum83Audit['hashes'],
): Forum83Audit {
  const parsedByKey = new Map(parsed.map((candidate) => [candidate.importKey, candidate]));
  const candidatesByPost = new Map<string, number>();
  for (const candidate of parsed) {
    const postId = candidate.technical.postId;
    candidatesByPost.set(postId, (candidatesByPost.get(postId) ?? 0) + 1);
  }
  const candidateStatusCounts = {
    USABLE_COMPLETE: 0,
    USABLE_PARTIAL: 0,
    UNRESOLVED: 0,
  };
  const resolutionCounts = {
    fish: emptyResolutionCounts(),
    fishingBase: emptyResolutionCounts(),
    location: emptyResolutionCounts(),
    bait: emptyResolutionCounts(),
    fishingBaseFish: emptyResolutionCounts(),
  };
  for (const candidate of resolved) {
    candidateStatusCounts[candidate.status] += 1;
    resolutionCounts.fish[candidate.resolution.fish.status] += 1;
    resolutionCounts.fishingBase[candidate.resolution.fishingBase.status] += 1;
    resolutionCounts.location[candidate.resolution.location.status] += 1;
    resolutionCounts.bait[candidate.resolution.bait.status] += 1;
    resolutionCounts.fishingBaseFish[candidate.resolution.fishingBaseFish.status] += 1;
  }
  const locationContextCounts = { EXPLICIT: 0, INHERITED: 0 };
  for (const candidate of parsed) locationContextCounts[candidate.forum83.locationContext] += 1;
  const duplicateImportKeys = duplicateCount(resolved.map(({ importKey }) => importKey));
  const examples = resolved.slice(0, 12).map((candidate): Forum83AuditExample => {
    const parsedCandidate = parsedByKey.get(candidate.importKey);
    if (parsedCandidate === undefined)
      throw new Forum83StageError('Resolved candidate lost parser metadata');
    return {
      topicId: candidate.technical.topicId,
      postId: candidate.technical.postId,
      candidateOrdinal: candidate.candidateOrdinal,
      importKey: candidate.importKey,
      status: candidate.status,
      fishNameRaw: candidate.fishNameRaw,
      weightGrams: candidate.weightGrams,
      fishingBaseRaw: candidate.fishingBaseRaw,
      locationRaw: candidate.locationRaw,
      baitRaw: candidate.baitRaw,
      locationContext: parsedCandidate.forum83.locationContext,
      issues: candidate.issues,
    };
  });
  return {
    version: 1,
    source: FORUM83_SOURCE,
    scopeKey: scan.scopeKey,
    topicsDiscovered: scan.topicsDiscovered,
    topicsScanned: scan.scannedTopicIds.length,
    postsScanned: postIds.length,
    zeroCatchPosts: postIds.filter((postId) => !candidatesByPost.has(postId)).length,
    candidatesExtracted: resolved.length,
    multiCandidatePosts: [...candidatesByPost.values()].filter((count) => count > 1).length,
    locationContextCounts,
    candidateStatusCounts,
    resolutionCounts,
    duplicateImportKeys,
    externalContributorCount: new Set(
      resolved.flatMap(({ contributorKey }) => (contributorKey === null ? [] : [contributorKey])),
    ).size,
    sourceChangedPostIds: [...scan.sourceChangedPostIds],
    catalogSnapshotFingerprint,
    hashes,
    examples,
  };
}

function serializeReview(
  posts: readonly import('../candidate-types.js').TechnicalForumPost[],
  parsed: readonly Forum83ParsedCandidate[],
  resolved: readonly ResolvedForumCandidate[],
): string {
  const resolvedByKey = new Map(resolved.map((candidate) => [candidate.importKey, candidate]));
  const rows = posts.map((post) => ({
    source: FORUM83_SOURCE,
    topicId: post.topicId,
    postId: post.postId,
    topicTitle: post.topicTitle,
    memberIdPresent: post.memberId !== null,
    bodyText: post.bodyText,
    candidates: parsed
      .filter((candidate) => candidate.technical.postId === post.postId)
      .map((candidate) => ({
        sourceRange: candidate.technical.sourceRange,
        sourceText: candidate.technical.sourceText,
        locationContext: candidate.forum83.locationContext,
        staging: toStagingCandidate(
          resolvedByKey.get(candidate.importKey) ??
            (() => {
              throw new Forum83StageError(`Candidate ${candidate.importKey} was not resolved`);
            })(),
        ),
      })),
  }));
  return rows.length === 0 ? '' : `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

function assertScan(scan: Forum83ScanManifest, scope: Forum83ScanScope): void {
  if (
    scan.version !== 1 ||
    scan.source !== FORUM83_SOURCE ||
    scan.forumId !== FORUM83_ID ||
    scan.scopeKey !== forum83ScopeKey(scope) ||
    JSON.stringify(scan.scope) !== JSON.stringify(scope) ||
    !scan.complete ||
    scan.topicsDiscovered !== 77
  ) {
    throw new Forum83StageError('Forum83 scan is missing, incomplete, or belongs to another scope');
  }
}

async function requiredJson<Value>(path: string): Promise<Value> {
  const value = await readJsonFile<Value>(path);
  if (value === null) throw new Forum83StageError(`Required artifact is missing: ${path}`);
  return value;
}

function emptyResolutionCounts(): ResolutionCounts {
  return { RESOLVED: 0, MISSING: 0, UNRESOLVED: 0 };
}

function duplicateCount(values: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.values()].filter((count) => count > 1).length;
}
