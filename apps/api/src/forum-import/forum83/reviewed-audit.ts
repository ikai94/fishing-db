import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { sha256Hex } from '../cache.js';
import type { StagingCandidate, StagingManifest } from '../staging.js';
import {
  readVerifiedForumStagingBundle,
  type VerifiedForumStagingBundle,
} from '../staging-reader.js';
import { auditForum83BaseFishReconciliation } from './base-fish-reconciliation.js';
import { FORUM83_IMPORT_KEY_PATTERN, FORUM83_SOURCE } from './constants.js';
import {
  FORUM83_REVIEWED_DECISIONS_SHA256,
  loadForum83ReviewedDecisions,
} from './reviewed-decisions.js';
import { loadForum83TopicMap } from './topic-map.js';

export const FORUM83_REVIEWED_AUDIT_SHA256 =
  'b9d69b59aa607ea18fdaa140d4ecfe685f6ef1f23b4fd33c80a94e7fb7842d8c' as const;

type ExclusionCategory =
  | 'MISSING_BAIT'
  | 'REJECTED_AMBIGUOUS_BAIT'
  | 'OFF_TOPIC_BASE_LOCATION_CONFLICT'
  | 'REJECTED_BASE_FISH';

interface Forum83ReviewedAudit {
  version: 1;
  source: typeof FORUM83_SOURCE;
  scopeKey: 'forum83-all-forum-83';
  decision: 'APPROVED_COMPLETE_ONLY';
  reviewedDecisionsSha256: string;
  hashes: {
    scan: string;
    topicMap: string;
    candidateIdentities: string;
    catalogSnapshot: string;
    staging: string;
    audit: string;
  };
  catalogPostState: {
    catalogSnapshotFingerprint: string;
    baseFishReconciliationFingerprint: string;
    membershipsCount: number;
    reviewedAdditionsPresent: number;
  };
  candidatePopulation: {
    total: number;
    complete: number;
    reviewedExcluded: number;
    exclusionCounts: Record<ExclusionCategory, number>;
    reviewedExclusionsSha256: string;
    completeImportKeysSha256: string;
    duplicateImportKeys: number;
    contributors: { all: number; complete: number; missing: number };
  };
}

interface Forum83StagingManifest extends StagingManifest {
  source: typeof FORUM83_SOURCE;
  scopeKey: string;
  auditSha256: string;
  hashes: {
    scan: string;
    topicMap: string;
    candidateIdentities: string;
    candidatesJsonl: string;
    candidatesCsv: string;
  };
}

export interface VerifiedForum83ReviewedAuditBundle {
  bundle: VerifiedForumStagingBundle;
  frozenAuditSha256: typeof FORUM83_REVIEWED_AUDIT_SHA256;
  reviewedExcluded: number;
  exclusionCounts: Record<ExclusionCategory, number>;
  contributors: { all: number; complete: number; missing: number };
  duplicateImportKeys: number;
  catalogPostState: Forum83ReviewedAudit['catalogPostState'];
}

export class Forum83ReviewedAuditError extends Error {
  readonly code = 'FORUM83_REVIEWED_AUDIT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'Forum83ReviewedAuditError';
  }
}

function loadReviewedAudit(): Forum83ReviewedAudit {
  const source = readFileSync(
    new URL('../../../prisma/catalog-data/forum83-reviewed-audit.json', import.meta.url),
    'utf8',
  );
  const observed = sha256Hex(source);
  if (observed !== FORUM83_REVIEWED_AUDIT_SHA256) {
    throw new Forum83ReviewedAuditError(
      `forum83 reviewed audit hash is ${observed}, expected ${FORUM83_REVIEWED_AUDIT_SHA256}`,
    );
  }
  const value = JSON.parse(source) as Forum83ReviewedAudit;
  if (
    value.version !== 1 ||
    value.source !== FORUM83_SOURCE ||
    value.scopeKey !== 'forum83-all-forum-83' ||
    value.decision !== 'APPROVED_COMPLETE_ONLY' ||
    value.reviewedDecisionsSha256 !== FORUM83_REVIEWED_DECISIONS_SHA256
  ) {
    throw new Forum83ReviewedAuditError('forum83 reviewed audit identity is invalid');
  }
  return value;
}

async function requiredSource(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown read error';
    throw new Forum83ReviewedAuditError(
      `Required frozen artifact cannot be read: ${path}: ${message}`,
    );
  }
}

function assertHash(label: string, source: string, expected: string): void {
  const observed = sha256Hex(source);
  if (observed !== expected) {
    throw new Forum83ReviewedAuditError(`${label} hash is ${observed}, expected ${expected}`);
  }
}

function decodeForum83Manifest(
  source: string,
  reviewed: Forum83ReviewedAudit,
): Forum83StagingManifest {
  const value = JSON.parse(source) as Forum83StagingManifest;
  if (
    value.version !== 1 ||
    value.source !== FORUM83_SOURCE ||
    value.scopeKey !== reviewed.scopeKey ||
    value.catalogSnapshotFingerprint !== reviewed.catalogPostState.catalogSnapshotFingerprint ||
    value.candidatesCount !== reviewed.candidatePopulation.total ||
    value.auditSha256 !== reviewed.hashes.audit ||
    value.hashes.scan !== reviewed.hashes.scan ||
    value.hashes.topicMap !== reviewed.hashes.topicMap ||
    value.hashes.candidateIdentities !== reviewed.hashes.candidateIdentities ||
    !Array.isArray(value.files) ||
    value.files.length !== 2
  ) {
    throw new Forum83ReviewedAuditError('forum83 staging manifest does not match the frozen audit');
  }
  const files = new Map(value.files.map((file) => [file.path, file.sha256]));
  if (
    files.get('candidates.jsonl') !== value.hashes.candidatesJsonl ||
    files.get('candidates.csv') !== value.hashes.candidatesCsv ||
    files.size !== 2
  ) {
    throw new Forum83ReviewedAuditError('forum83 staging file hashes are invalid');
  }
  return value;
}

function issueSet(candidate: StagingCandidate): Set<string> {
  return new Set(candidate.issues.map(({ code, field }) => `${code}:${field ?? ''}`));
}

function exclusionCategory(candidate: StagingCandidate): ExclusionCategory {
  const issues = issueSet(candidate);
  const decisions = loadForum83ReviewedDecisions();
  if (issues.has('MISSING_BAIT:bait')) return 'MISSING_BAIT';
  if (issues.has('UNRESOLVED_BAIT:bait')) {
    if (candidate.baitRaw === null || !decisions.rejectedBaitRaw.includes(candidate.baitRaw)) {
      throw new Forum83ReviewedAuditError(`Unreviewed unresolved Bait: ${candidate.importKey}`);
    }
    return 'REJECTED_AMBIGUOUS_BAIT';
  }
  if (issues.has('UNRESOLVED_LOCATION:location')) {
    if (!issues.has('AMBIGUOUS_CANDIDATE_FIELD:fishingBaseRaw')) {
      throw new Forum83ReviewedAuditError(`Unreviewed unresolved Location: ${candidate.importKey}`);
    }
    return 'OFF_TOPIC_BASE_LOCATION_CONFLICT';
  }
  if (issues.has('MISSING_FISHING_BASE_FISH_MEMBERSHIP:fishingBaseFish')) {
    const baseName = candidate.resolution.fishingBase.name;
    const fishName = candidate.resolution.fish.name;
    if (
      baseName === null ||
      fishName === null ||
      !decisions.baseFishRejections.some(
        (pair) => pair.baseName === baseName && pair.fishName === fishName,
      )
    ) {
      throw new Forum83ReviewedAuditError(
        `Unreviewed missing BaseFish pair: ${candidate.importKey}`,
      );
    }
    return 'REJECTED_BASE_FISH';
  }
  throw new Forum83ReviewedAuditError(
    `Unclassified non-COMPLETE candidate: ${candidate.importKey}`,
  );
}

function sha256Lines(lines: readonly string[]): string {
  return createHash('sha256')
    .update(lines.map((line) => `${line}\n`).join(''), 'utf8')
    .digest('hex');
}

export async function readVerifiedForum83ReviewedAuditBundle(
  outputDirectory: string,
): Promise<VerifiedForum83ReviewedAuditBundle> {
  const reviewed = loadReviewedAudit();
  const [scan, identities, catalogSnapshot, stagingManifest, audit] = await Promise.all([
    requiredSource(join(outputDirectory, 'technical', 'scan.json')),
    requiredSource(join(outputDirectory, 'technical', 'candidate-identities.json')),
    requiredSource(join(outputDirectory, 'technical', 'catalog-snapshot.json')),
    requiredSource(join(outputDirectory, 'staging', 'manifest.json')),
    requiredSource(join(outputDirectory, 'audit', 'audit.json')),
  ]);
  assertHash('scan', scan, reviewed.hashes.scan);
  assertHash('candidate identity', identities, reviewed.hashes.candidateIdentities);
  assertHash('catalog snapshot', catalogSnapshot, reviewed.hashes.catalogSnapshot);
  assertHash('staging', stagingManifest, reviewed.hashes.staging);
  assertHash('audit', audit, reviewed.hashes.audit);
  if (loadForum83TopicMap().sha256 !== reviewed.hashes.topicMap) {
    throw new Forum83ReviewedAuditError('Pinned topic map differs from the frozen audit');
  }

  const manifest = decodeForum83Manifest(stagingManifest, reviewed);
  const bundle = await readVerifiedForumStagingBundle(join(outputDirectory, 'staging'), {
    importKeyPattern: FORUM83_IMPORT_KEY_PATTERN,
    decodeManifest: () => ({
      version: 1,
      catalogSnapshotFingerprint: manifest.catalogSnapshotFingerprint,
      candidatesCount: manifest.candidatesCount,
      files: manifest.files,
    }),
  });
  const complete = bundle.candidates.filter(({ status }) => status === 'USABLE_COMPLETE');
  const excluded = bundle.candidates
    .filter(({ status }) => status !== 'USABLE_COMPLETE')
    .map((candidate) => ({
      importKey: candidate.importKey,
      status: candidate.status,
      category: exclusionCategory(candidate),
    }))
    .sort((left, right) => left.importKey.localeCompare(right.importKey));
  const exclusionCounts: Record<ExclusionCategory, number> = {
    MISSING_BAIT: 0,
    REJECTED_AMBIGUOUS_BAIT: 0,
    OFF_TOPIC_BASE_LOCATION_CONFLICT: 0,
    REJECTED_BASE_FISH: 0,
  };
  for (const row of excluded) exclusionCounts[row.category] += 1;
  const exclusionHash = sha256Lines(excluded.map((row) => JSON.stringify(row)));
  const completeImportKeysHash = sha256Lines(
    complete.map(({ importKey }) => importKey).sort((left, right) => left.localeCompare(right)),
  );
  const importKeys = new Set(bundle.candidates.map(({ importKey }) => importKey));
  const missingContributors = bundle.candidates.filter(
    ({ contributorKey }) => contributorKey === null,
  ).length;
  const contributors = {
    all: new Set(bundle.candidates.map(({ contributorKey }) => contributorKey)).size,
    complete: new Set(complete.map(({ contributorKey }) => contributorKey)).size,
    missing: missingContributors,
  };
  const expected = reviewed.candidatePopulation;
  if (
    bundle.candidates.length !== expected.total ||
    complete.length !== expected.complete ||
    excluded.length !== expected.reviewedExcluded ||
    JSON.stringify(exclusionCounts) !== JSON.stringify(expected.exclusionCounts) ||
    exclusionHash !== expected.reviewedExclusionsSha256 ||
    completeImportKeysHash !== expected.completeImportKeysSha256 ||
    bundle.candidates.length - importKeys.size !== expected.duplicateImportKeys ||
    JSON.stringify(contributors) !== JSON.stringify(expected.contributors)
  ) {
    throw new Forum83ReviewedAuditError(
      'Candidate population differs from the frozen reviewed audit',
    );
  }
  return {
    bundle,
    frozenAuditSha256: FORUM83_REVIEWED_AUDIT_SHA256,
    reviewedExcluded: excluded.length,
    exclusionCounts,
    contributors,
    duplicateImportKeys: bundle.candidates.length - importKeys.size,
    catalogPostState: reviewed.catalogPostState,
  };
}

export async function assertForum83ReviewedCatalogPostState(
  prisma: PrismaClient,
  expected: Forum83ReviewedAudit['catalogPostState'],
): Promise<void> {
  const state = await auditForum83BaseFishReconciliation(prisma);
  if (
    state.state !== 'POST_APPLY' ||
    state.preStateFingerprint !== expected.baseFishReconciliationFingerprint ||
    state.memberships.current !== expected.membershipsCount ||
    state.memberships.alreadyPresent !== expected.reviewedAdditionsPresent ||
    state.memberships.add !== 0 ||
    state.writesPerformed
  ) {
    throw new Forum83ReviewedAuditError('Live BaseFish post-state differs from the frozen audit');
  }
}
