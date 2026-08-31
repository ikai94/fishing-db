import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isBlockingForumStagingIssue } from './catalog-resolver.js';
import type {
  BaitResolution,
  CatalogResolution,
  CatalogResolutionReason,
  CatalogResolutionStatus,
  ForumCandidateStatus,
  ForumStagingIssue,
  LocationResolution,
} from './catalog-resolver.js';
import type { StagingCandidate, StagingManifest } from './staging.js';
import { sha256Text } from './staging.js';

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTRIBUTOR_KEY = /^external:rus-fishsoft:member:v1:[0-9a-f]{64}$/u;
const IMPORT_KEY = /^external:rus-fishsoft:observation:v1:[0-9a-f]{64}$/u;

const CANDIDATE_KEYS = [
  'contributorKey',
  'importKey',
  'fishNameRaw',
  'weightGrams',
  'fishingBaseRaw',
  'locationRaw',
  'baitRaw',
  'fishingMethod',
  'holeDepthCm',
  'spotPositionRaw',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
  'userNoteRaw',
  'resolution',
  'status',
  'issues',
] as const;

const RESOLUTION_STATUSES = new Set<CatalogResolutionStatus>(['RESOLVED', 'MISSING', 'UNRESOLVED']);
const RESOLUTION_REASONS = new Set<CatalogResolutionReason>([
  'MISSING_INPUT',
  'INVALID_INPUT',
  'NOT_FOUND',
  'AMBIGUOUS',
  'INACTIVE',
  'DEPENDENCY_UNRESOLVED',
]);
const CANDIDATE_STATUSES = new Set<ForumCandidateStatus>([
  'USABLE_COMPLETE',
  'USABLE_PARTIAL',
  'UNRESOLVED',
]);

export interface ForumStagingReaderOptions {
  importKeyPattern?: RegExp;
  decodeManifest?: (value: unknown) => StagingManifest;
}

export class ForumStagingArtifactError extends Error {
  readonly code = 'FORUM_STAGING_ARTIFACT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ForumStagingArtifactError';
  }
}

export interface VerifiedForumStagingBundle {
  manifest: StagingManifest;
  candidates: StagingCandidate[];
}

function invalid(message: string): never {
  throw new ForumStagingArtifactError(message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} has unexpected or missing fields`);
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(`${path} must be a string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function nullableInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value)) return invalid(`${path} must be a safe integer or null`);
  return value as number;
}

function enumValue<Value extends string>(
  value: unknown,
  allowed: ReadonlySet<Value>,
  path: string,
): Value {
  if (typeof value !== 'string' || !allowed.has(value as Value)) {
    return invalid(`${path} has an unsupported value`);
  }
  return value as Value;
}

function nullableEnum<Value extends string>(
  value: unknown,
  allowed: ReadonlySet<Value>,
  path: string,
): Value | null {
  return value === null ? null : enumValue(value, allowed, path);
}

function decodeResolution(value: unknown, path: string): CatalogResolution {
  const row = object(value, path);
  exactKeys(row, ['status', 'reason', 'id', 'name'], path);
  return {
    status: enumValue(row.status, RESOLUTION_STATUSES, `${path}.status`),
    reason: nullableEnum(row.reason, RESOLUTION_REASONS, `${path}.reason`),
    id: nullableString(row.id, `${path}.id`),
    name: nullableString(row.name, `${path}.name`),
  };
}

function decodeLocationResolution(value: unknown, path: string): LocationResolution {
  const row = object(value, path);
  exactKeys(row, ['status', 'reason', 'id', 'name', 'number'], path);
  return {
    status: enumValue(row.status, RESOLUTION_STATUSES, `${path}.status`),
    reason: nullableEnum(row.reason, RESOLUTION_REASONS, `${path}.reason`),
    id: nullableString(row.id, `${path}.id`),
    name: nullableString(row.name, `${path}.name`),
    number: nullableInteger(row.number, `${path}.number`),
  };
}

function decodeBaitResolution(value: unknown, path: string): BaitResolution {
  const row = object(value, path);
  exactKeys(row, ['status', 'reason', 'id', 'name', 'type'], path);
  return {
    status: enumValue(row.status, RESOLUTION_STATUSES, `${path}.status`),
    reason: nullableEnum(row.reason, RESOLUTION_REASONS, `${path}.reason`),
    id: nullableString(row.id, `${path}.id`),
    name: nullableString(row.name, `${path}.name`),
    type: nullableEnum(row.type, new Set(['BAIT', 'LURE'] as const), `${path}.type`),
  };
}

function decodeMembership(
  value: unknown,
  path: string,
): { status: 'RESOLVED' | 'MISSING' | 'UNRESOLVED' } {
  const row = object(value, path);
  exactKeys(row, ['status'], path);
  return {
    status: enumValue(row.status, RESOLUTION_STATUSES, `${path}.status`),
  };
}

function decodeIssue(value: unknown, path: string): ForumStagingIssue {
  const row = object(value, path);
  const keys = Object.keys(row).sort();
  if (
    keys.length < 1 ||
    keys.length > 2 ||
    keys[0] !== 'code' ||
    (keys.length === 2 && keys[1] !== 'field')
  ) {
    return invalid(`${path} has unexpected or missing fields`);
  }
  const code = string(row.code, `${path}.code`);
  if (code.length === 0) return invalid(`${path}.code must not be empty`);
  return row.field === undefined ? { code } : { code, field: string(row.field, `${path}.field`) };
}

function decodeCandidate(value: unknown, line: number, importKeyPattern: RegExp): StagingCandidate {
  const path = `candidates.jsonl:${String(line)}`;
  const row = object(value, path);
  exactKeys(row, CANDIDATE_KEYS, path);
  const resolution = object(row.resolution, `${path}.resolution`);
  exactKeys(
    resolution,
    ['fish', 'fishingBase', 'location', 'bait', 'fishingBaseFish'],
    `${path}.resolution`,
  );
  const issues = row.issues;
  if (!Array.isArray(issues)) return invalid(`${path}.issues must be an array`);

  const contributorKey = nullableString(row.contributorKey, `${path}.contributorKey`);
  if (contributorKey !== null && !CONTRIBUTOR_KEY.test(contributorKey)) {
    invalid(`${path}.contributorKey is not a rus-fishsoft contributor key`);
  }
  const importKey = string(row.importKey, `${path}.importKey`);
  if (!importKeyPattern.test(importKey)) {
    invalid(`${path}.importKey is not a rus-fishsoft import key`);
  }

  return {
    contributorKey,
    importKey,
    fishNameRaw: nullableString(row.fishNameRaw, `${path}.fishNameRaw`),
    weightGrams: nullableInteger(row.weightGrams, `${path}.weightGrams`),
    fishingBaseRaw: nullableString(row.fishingBaseRaw, `${path}.fishingBaseRaw`),
    locationRaw: nullableString(row.locationRaw, `${path}.locationRaw`),
    baitRaw: nullableString(row.baitRaw, `${path}.baitRaw`),
    fishingMethod: nullableEnum(
      row.fishingMethod,
      new Set(['BAIT_FISHING', 'SPINNING'] as const),
      `${path}.fishingMethod`,
    ),
    holeDepthCm: nullableInteger(row.holeDepthCm, `${path}.holeDepthCm`),
    spotPositionRaw: nullableString(row.spotPositionRaw, `${path}.spotPositionRaw`),
    fishingNote: nullableEnum(
      row.fishingNote,
      new Set(['MIDWATER', 'FROM_BOTTOM', 'SURFACE'] as const),
      `${path}.fishingNote`,
    ),
    spinningSize: nullableEnum(
      row.spinningSize,
      new Set(['SMALL', 'MEDIUM', 'LARGE'] as const),
      `${path}.spinningSize`,
    ),
    spinningSpeed: nullableEnum(
      row.spinningSpeed,
      new Set(['SLOW', 'MEDIUM', 'FAST'] as const),
      `${path}.spinningSpeed`,
    ),
    userNoteRaw: nullableString(row.userNoteRaw, `${path}.userNoteRaw`),
    resolution: {
      fish: decodeResolution(resolution.fish, `${path}.resolution.fish`),
      fishingBase: decodeResolution(resolution.fishingBase, `${path}.resolution.fishingBase`),
      location: decodeLocationResolution(resolution.location, `${path}.resolution.location`),
      bait: decodeBaitResolution(resolution.bait, `${path}.resolution.bait`),
      fishingBaseFish: decodeMembership(
        resolution.fishingBaseFish,
        `${path}.resolution.fishingBaseFish`,
      ),
    },
    status: enumValue(row.status, CANDIDATE_STATUSES, `${path}.status`),
    issues: issues.map((issue, index) => decodeIssue(issue, `${path}.issues[${String(index)}]`)),
  };
}

function decodeManifest(value: unknown): StagingManifest {
  const manifest = object(value, 'manifest.json');
  exactKeys(
    manifest,
    ['version', 'catalogSnapshotFingerprint', 'candidatesCount', 'files'],
    'manifest.json',
  );
  if (manifest.version !== 1) invalid('manifest.json version must be 1');
  if (!Number.isSafeInteger(manifest.candidatesCount) || Number(manifest.candidatesCount) < 0) {
    invalid('manifest.json candidatesCount must be a nonnegative safe integer');
  }
  const fingerprint = string(
    manifest.catalogSnapshotFingerprint,
    'manifest.json.catalogSnapshotFingerprint',
  );
  if (!SHA256.test(fingerprint)) invalid('manifest.json catalog fingerprint is invalid');
  if (!Array.isArray(manifest.files)) invalid('manifest.json files must be an array');
  const files = manifest.files.map((value, index) => {
    const path = `manifest.json.files[${String(index)}]`;
    const file = object(value, path);
    exactKeys(file, ['path', 'sha256'], path);
    const filePath = string(file.path, `${path}.path`);
    const sha256 = string(file.sha256, `${path}.sha256`);
    if (!SHA256.test(sha256)) invalid(`${path}.sha256 is invalid`);
    return { path: filePath, sha256 };
  });
  const expectedPaths = ['candidates.csv', 'candidates.jsonl'];
  const actualPaths = files.map((file) => file.path).sort();
  if (
    actualPaths.length !== expectedPaths.length ||
    actualPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    invalid('manifest.json must contain exactly candidates.csv and candidates.jsonl');
  }

  return {
    version: 1,
    catalogSnapshotFingerprint: fingerprint,
    candidatesCount: Number(manifest.candidatesCount),
    files,
  };
}

async function requiredFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown read error';
    return invalid(`Required staging artifact cannot be read: ${path}: ${message}`);
  }
}

export function assertCompleteStagingCandidate(candidate: StagingCandidate): void {
  if (candidate.status !== 'USABLE_COMPLETE') {
    invalid(`Candidate ${candidate.importKey} is not USABLE_COMPLETE`);
  }
  if (candidate.contributorKey === null || !CONTRIBUTOR_KEY.test(candidate.contributorKey)) {
    invalid(`COMPLETE candidate ${candidate.importKey} has no valid contributorKey`);
  }
  if (candidate.issues.some(isBlockingForumStagingIssue)) {
    invalid(`COMPLETE candidate ${candidate.importKey} has blocking staging issues`);
  }
  for (const [field, resolution] of [
    ['fish', candidate.resolution.fish],
    ['fishingBase', candidate.resolution.fishingBase],
    ['location', candidate.resolution.location],
    ['bait', candidate.resolution.bait],
  ] as const) {
    if (
      resolution.status !== 'RESOLVED' ||
      resolution.reason !== null ||
      resolution.id === null ||
      !UUID_V4.test(resolution.id)
    ) {
      invalid(`COMPLETE candidate ${candidate.importKey} has invalid ${field} resolution`);
    }
  }
  if (candidate.resolution.fishingBaseFish.status !== 'RESOLVED') {
    invalid(`COMPLETE candidate ${candidate.importKey} has invalid Base-Fish membership`);
  }
  const expectedMethod = candidate.resolution.bait.type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
  if (candidate.resolution.bait.type === null || candidate.fishingMethod !== expectedMethod) {
    invalid(`COMPLETE candidate ${candidate.importKey} has an invalid fishing method`);
  }
}

export async function readVerifiedForumStagingBundle(
  stagingDirectory: string,
  options: ForumStagingReaderOptions = {},
): Promise<VerifiedForumStagingBundle> {
  const manifestSource = await requiredFile(join(stagingDirectory, 'manifest.json'));
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestSource);
  } catch {
    return invalid('manifest.json is not valid JSON');
  }
  const manifest = (options.decodeManifest ?? decodeManifest)(manifestValue);
  const contents = new Map<string, string>();
  for (const file of manifest.files) {
    const source = await requiredFile(join(stagingDirectory, file.path));
    if (sha256Text(source) !== file.sha256) {
      invalid(`Staging checksum mismatch: ${file.path}`);
    }
    contents.set(file.path, source);
  }
  const jsonl = contents.get('candidates.jsonl');
  if (jsonl === undefined) invalid('candidates.jsonl is missing');
  if (jsonl.length > 0 && !jsonl.endsWith('\n')) {
    invalid('candidates.jsonl must end with a newline');
  }
  const lines = jsonl.length === 0 ? [] : jsonl.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0)) invalid('candidates.jsonl contains an empty line');
  const candidates = lines.map((line, index) => {
    try {
      return decodeCandidate(JSON.parse(line), index + 1, options.importKeyPattern ?? IMPORT_KEY);
    } catch (error: unknown) {
      if (error instanceof ForumStagingArtifactError) throw error;
      return invalid(`candidates.jsonl:${String(index + 1)} is not valid JSON`);
    }
  });
  if (candidates.length !== manifest.candidatesCount) {
    invalid('manifest candidatesCount does not match candidates.jsonl');
  }
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (keys.has(candidate.importKey)) {
      invalid(`Duplicate staging importKey: ${candidate.importKey}`);
    }
    keys.add(candidate.importKey);
    if (candidate.status === 'USABLE_COMPLETE') assertCompleteStagingCandidate(candidate);
  }
  return { manifest, candidates };
}
