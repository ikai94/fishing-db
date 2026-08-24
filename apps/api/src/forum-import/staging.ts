import { createHash } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type {
  BaitResolution,
  CatalogResolution,
  ForumCandidateStatus,
  ForumStagingIssue,
  LocationResolution,
  ResolvedForumCandidate,
} from './catalog-resolver.js';

export interface StagingCandidate {
  contributorKey: string | null;
  importKey: string;
  fishNameRaw: string | null;
  weightGrams: number | null;
  fishingBaseRaw: string | null;
  locationRaw: string | null;
  baitRaw: string | null;
  fishingMethod: 'BAIT_FISHING' | 'SPINNING' | null;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  userNoteRaw: string | null;
  resolution: {
    fish: CatalogResolution;
    fishingBase: CatalogResolution;
    location: LocationResolution;
    bait: BaitResolution;
    fishingBaseFish: { status: 'RESOLVED' | 'MISSING' | 'UNRESOLVED' };
  };
  status: ForumCandidateStatus;
  issues: ForumStagingIssue[];
}

export interface StagingManifest {
  version: 1;
  catalogSnapshotFingerprint: string;
  candidatesCount: number;
  files: Array<{ path: string; sha256: string }>;
}

export interface StagingArtifacts {
  candidates: StagingCandidate[];
  candidatesJsonl: string;
  candidatesCsv: string;
  manifest: StagingManifest;
  manifestJson: string;
}

const CSV_COLUMNS = [
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
  'fishStatus',
  'fishReason',
  'fishId',
  'fishName',
  'fishingBaseStatus',
  'fishingBaseReason',
  'fishingBaseId',
  'fishingBaseName',
  'locationStatus',
  'locationReason',
  'locationId',
  'locationName',
  'locationNumber',
  'baitStatus',
  'baitReason',
  'baitId',
  'baitName',
  'baitType',
  'fishingBaseFishStatus',
  'status',
  'issues',
] as const;

function compareNumericText(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareResolvedCandidates(
  left: ResolvedForumCandidate,
  right: ResolvedForumCandidate,
): number {
  return (
    compareNumericText(left.technical.subforumId, right.technical.subforumId) ||
    compareNumericText(left.technical.topicId, right.technical.topicId) ||
    compareNumericText(left.technical.postId, right.technical.postId) ||
    left.candidateOrdinal - right.candidateOrdinal
  );
}

export function toStagingCandidate(candidate: ResolvedForumCandidate): StagingCandidate {
  return {
    contributorKey: candidate.contributorKey,
    importKey: candidate.importKey,
    fishNameRaw: candidate.fishNameRaw,
    weightGrams: candidate.weightGrams,
    fishingBaseRaw: candidate.fishingBaseRaw,
    locationRaw: candidate.locationRaw,
    baitRaw: candidate.baitRaw,
    fishingMethod: candidate.fishingMethod,
    holeDepthCm: candidate.holeDepthCm,
    spotPositionRaw: candidate.spotPositionRaw,
    fishingNote: candidate.fishingNote,
    spinningSize: candidate.spinningSize,
    spinningSpeed: candidate.spinningSpeed,
    userNoteRaw: candidate.userNoteRaw,
    resolution: {
      fish: { ...candidate.resolution.fish },
      fishingBase: { ...candidate.resolution.fishingBase },
      location: { ...candidate.resolution.location },
      bait: { ...candidate.resolution.bait },
      fishingBaseFish: { status: candidate.resolution.fishingBaseFish.status },
    },
    status: candidate.status,
    issues: candidate.issues.map((issue) => ({ ...issue })),
  };
}

export function orderedStagingCandidates(
  candidates: readonly ResolvedForumCandidate[],
): StagingCandidate[] {
  return [...candidates].sort(compareResolvedCandidates).map(toStagingCandidate);
}

export function serializeCandidatesJsonl(candidates: readonly StagingCandidate[]): string {
  return candidates.length === 0
    ? ''
    : `${candidates.map((candidate) => JSON.stringify(candidate)).join('\n')}\n`;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  const spreadsheetSafe = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

function candidateCsvRow(candidate: StagingCandidate): Array<string | number | null> {
  return [
    candidate.contributorKey,
    candidate.importKey,
    candidate.fishNameRaw,
    candidate.weightGrams,
    candidate.fishingBaseRaw,
    candidate.locationRaw,
    candidate.baitRaw,
    candidate.fishingMethod,
    candidate.holeDepthCm,
    candidate.spotPositionRaw,
    candidate.fishingNote,
    candidate.spinningSize,
    candidate.spinningSpeed,
    candidate.userNoteRaw,
    candidate.resolution.fish.status,
    candidate.resolution.fish.reason,
    candidate.resolution.fish.id,
    candidate.resolution.fish.name,
    candidate.resolution.fishingBase.status,
    candidate.resolution.fishingBase.reason,
    candidate.resolution.fishingBase.id,
    candidate.resolution.fishingBase.name,
    candidate.resolution.location.status,
    candidate.resolution.location.reason,
    candidate.resolution.location.id,
    candidate.resolution.location.name,
    candidate.resolution.location.number,
    candidate.resolution.bait.status,
    candidate.resolution.bait.reason,
    candidate.resolution.bait.id,
    candidate.resolution.bait.name,
    candidate.resolution.bait.type,
    candidate.resolution.fishingBaseFish.status,
    candidate.status,
    JSON.stringify(candidate.issues),
  ];
}

export function serializeCandidatesCsv(candidates: readonly StagingCandidate[]): string {
  const rows = [CSV_COLUMNS.map(csvCell).join(',')];

  for (const candidate of candidates) {
    rows.push(candidateCsvRow(candidate).map(csvCell).join(','));
  }

  return `${rows.join('\r\n')}\r\n`;
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildStagingManifest(
  catalogSnapshotFingerprint: string,
  candidatesCount: number,
  files: Readonly<Record<string, string>>,
): StagingManifest {
  return {
    version: 1,
    catalogSnapshotFingerprint,
    candidatesCount,
    files: Object.entries(files)
      .sort(([left], [right]) => compareText(left, right))
      .map(([path, contents]) => ({ path, sha256: sha256Text(contents) })),
  };
}

export function serializeDeterministicJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildStagingArtifacts(
  candidates: readonly ResolvedForumCandidate[],
  catalogSnapshotFingerprint: string,
  additionalFiles: Readonly<Record<string, string>> = {},
): StagingArtifacts {
  const projected = orderedStagingCandidates(candidates);
  const candidatesJsonl = serializeCandidatesJsonl(projected);
  const candidatesCsv = serializeCandidatesCsv(projected);
  const manifest = buildStagingManifest(catalogSnapshotFingerprint, projected.length, {
    ...additionalFiles,
    'candidates.csv': candidatesCsv,
    'candidates.jsonl': candidatesJsonl,
  });

  return {
    candidates: projected,
    candidatesJsonl,
    candidatesCsv,
    manifest,
    manifestJson: serializeDeterministicJson(manifest),
  };
}

function safeOutputPath(outputDirectory: string, relativePath: string): string {
  if (relativePath === '' || isAbsolute(relativePath)) {
    throw new Error(`Unsafe staging output path: ${relativePath}`);
  }

  const normalized = normalize(relativePath);

  if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe staging output path: ${relativePath}`);
  }

  return join(outputDirectory, normalized);
}

export async function writeAtomicTextFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function writeStagingFiles(
  outputDirectory: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [relativePath, contents] of Object.entries(files).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    await writeAtomicTextFile(safeOutputPath(outputDirectory, relativePath), contents);
  }
}
