import { normalizeCatalogName } from '../catalog/catalog-normalization.js';
import { catchReportObservationErrors } from '../catch-reports/catch-report-observation.js';
import {
  CATCH_REPORT_MAX_INTEGER,
  type CatchReportFishingMethod,
} from '../catch-reports/catch-reports.constants.js';
import {
  SPOT_POSITION_RAW_MAX_LENGTH_PATTERN,
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_SPOT_POSITION_RAW_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
} from '../catch-reports/catch-report-raw-note.js';
import type { ParsedForumCandidate } from './candidate-types.js';
import type {
  CatalogBaitRow,
  CatalogLocationRow,
  CatalogNamedRow,
  CatalogSnapshot,
} from './catalog-source.js';

export type CatalogResolutionStatus = 'RESOLVED' | 'MISSING' | 'UNRESOLVED';
export type CatalogResolutionReason =
  | 'MISSING_INPUT'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'INACTIVE'
  | 'DEPENDENCY_UNRESOLVED';

export interface CatalogResolution {
  status: CatalogResolutionStatus;
  reason: CatalogResolutionReason | null;
  id: string | null;
  name: string | null;
}

export interface LocationResolution extends CatalogResolution {
  number: number | null;
}

export interface BaitResolution extends CatalogResolution {
  type: 'BAIT' | 'LURE' | null;
}

export interface MembershipResolution {
  status: CatalogResolutionStatus;
  reason: 'MISSING_MEMBERSHIP' | 'DEPENDENCY_UNRESOLVED' | null;
}

export interface ForumStagingIssue {
  code: string;
  field?: string;
}

export type ForumCandidateStatus = 'USABLE_COMPLETE' | 'USABLE_PARTIAL' | 'UNRESOLVED';

export interface CandidateCatalogResolution {
  fish: CatalogResolution;
  fishingBase: CatalogResolution;
  location: LocationResolution;
  bait: BaitResolution;
  fishingBaseFish: MembershipResolution;
}

export interface ResolvedForumCandidate extends Omit<
  ParsedForumCandidate,
  'fishingMethod' | 'issues'
> {
  fishingMethod: CatchReportFishingMethod | null;
  resolution: CandidateCatalogResolution;
  status: ForumCandidateStatus;
  issues: ForumStagingIssue[];
}

const CONTRIBUTOR_KEY = /^external:rus-fishsoft:member:v1:[0-9a-f]{64}$/u;
const IMPORT_KEY = /^external:rus-fishsoft:observation:v1:[0-9a-f]{64}$/u;

function missingResolution(): CatalogResolution {
  return { status: 'MISSING', reason: 'MISSING_INPUT', id: null, name: null };
}

function unresolvedResolution(reason: CatalogResolutionReason): CatalogResolution {
  return { status: 'UNRESOLVED', reason, id: null, name: null };
}

function exactMatches<T extends CatalogNamedRow>(raw: string, rows: readonly T[]): T[] | null {
  try {
    const normalized = normalizeCatalogName(raw).nameNormalized;
    return rows.filter((row) => row.nameNormalized === normalized);
  } catch {
    return null;
  }
}

function resolveNamed(raw: string | null, rows: readonly CatalogNamedRow[]): CatalogResolution {
  if (raw === null) {
    return missingResolution();
  }

  const matches = exactMatches(raw, rows);

  if (matches === null) {
    return unresolvedResolution('INVALID_INPUT');
  }

  if (matches.length === 0) {
    return unresolvedResolution('NOT_FOUND');
  }

  if (matches.length !== 1) {
    return unresolvedResolution('AMBIGUOUS');
  }

  const match = matches[0];

  if (match === undefined) {
    return unresolvedResolution('NOT_FOUND');
  }

  return {
    status: match.isActive ? 'RESOLVED' : 'UNRESOLVED',
    reason: match.isActive ? null : 'INACTIVE',
    id: match.id,
    name: match.name,
  };
}

function resolveLocation(
  raw: string | null,
  fishingBase: CatalogResolution,
  locations: readonly CatalogLocationRow[],
): LocationResolution {
  if (raw === null) {
    return { ...missingResolution(), number: null };
  }

  if (fishingBase.status !== 'RESOLVED' || fishingBase.id === null) {
    return { ...unresolvedResolution('DEPENDENCY_UNRESOLVED'), number: null };
  }

  const matches = exactMatches(
    raw,
    locations.filter((location) => location.fishingBaseId === fishingBase.id),
  );

  if (matches === null) {
    return { ...unresolvedResolution('INVALID_INPUT'), number: null };
  }

  if (matches.length === 0) {
    return { ...unresolvedResolution('NOT_FOUND'), number: null };
  }

  if (matches.length !== 1) {
    return { ...unresolvedResolution('AMBIGUOUS'), number: null };
  }

  const match = matches[0];

  if (match === undefined) {
    return { ...unresolvedResolution('NOT_FOUND'), number: null };
  }

  return {
    status: match.isActive ? 'RESOLVED' : 'UNRESOLVED',
    reason: match.isActive ? null : 'INACTIVE',
    id: match.id,
    name: match.name,
    number: match.number,
  };
}

function resolveBait(raw: string | null, baits: readonly CatalogBaitRow[]): BaitResolution {
  if (raw === null) {
    return { ...missingResolution(), type: null };
  }

  const matches = exactMatches(raw, baits);

  if (matches === null) {
    return { ...unresolvedResolution('INVALID_INPUT'), type: null };
  }

  if (matches.length === 0) {
    return { ...unresolvedResolution('NOT_FOUND'), type: null };
  }

  if (matches.length !== 1) {
    return { ...unresolvedResolution('AMBIGUOUS'), type: null };
  }

  const match = matches[0];

  if (match === undefined) {
    return { ...unresolvedResolution('NOT_FOUND'), type: null };
  }

  return {
    status: match.isActive ? 'RESOLVED' : 'UNRESOLVED',
    reason: match.isActive ? null : 'INACTIVE',
    id: match.id,
    name: match.name,
    type: match.type,
  };
}

function resolveMembership(
  fishingBase: CatalogResolution,
  fish: CatalogResolution,
  snapshot: CatalogSnapshot,
): MembershipResolution {
  if (
    fishingBase.status !== 'RESOLVED' ||
    fish.status !== 'RESOLVED' ||
    fishingBase.id === null ||
    fish.id === null
  ) {
    return { status: 'UNRESOLVED', reason: 'DEPENDENCY_UNRESOLVED' };
  }

  const exists = snapshot.memberships.some(
    (membership) => membership.fishingBaseId === fishingBase.id && membership.fishId === fish.id,
  );

  return exists
    ? { status: 'RESOLVED', reason: null }
    : { status: 'MISSING', reason: 'MISSING_MEMBERSHIP' };
}

function methodFromBait(bait: BaitResolution): CatchReportFishingMethod | null {
  if (bait.status !== 'RESOLVED') {
    return null;
  }

  if (bait.type === 'BAIT') {
    return 'BAIT_FISHING';
  }

  if (bait.type === 'LURE') {
    return 'SPINNING';
  }

  return null;
}

function addIssue(issues: ForumStagingIssue[], code: string, field?: string): ForumStagingIssue {
  const issue = field === undefined ? { code } : { code, field };

  if (!issues.some((current) => current.code === code && current.field === field)) {
    issues.push(issue);
  }

  return issue;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortIssues(issues: ForumStagingIssue[]): ForumStagingIssue[] {
  return issues.sort((left, right) => {
    const code = compareText(left.code, right.code);
    return code || compareText(left.field ?? '', right.field ?? '');
  });
}

function addResolutionIssue(
  issues: ForumStagingIssue[],
  field: 'fish' | 'fishingBase' | 'location' | 'bait',
  resolution: CatalogResolution,
): { missing: boolean; blocking: boolean } {
  if (resolution.status === 'RESOLVED') {
    return { missing: false, blocking: false };
  }

  if (resolution.status === 'MISSING') {
    addIssue(issues, `MISSING_${field.replace(/([A-Z])/gu, '_$1').toUpperCase()}`, field);
    return { missing: true, blocking: false };
  }

  addIssue(issues, `UNRESOLVED_${field.replace(/([A-Z])/gu, '_$1').toUpperCase()}`, field);
  return { missing: false, blocking: true };
}

function isPositiveInteger(value: number | null): value is number {
  return (
    value !== null && Number.isSafeInteger(value) && value >= 1 && value <= CATCH_REPORT_MAX_INTEGER
  );
}

export function resolveForumCandidate(
  candidate: ParsedForumCandidate,
  snapshot: CatalogSnapshot,
): ResolvedForumCandidate {
  const fish = resolveNamed(candidate.fishNameRaw, snapshot.fish);
  const fishingBase = resolveNamed(candidate.fishingBaseRaw, snapshot.fishingBases);
  const location = resolveLocation(candidate.locationRaw, fishingBase, snapshot.locations);
  const bait = resolveBait(candidate.baitRaw, snapshot.baits);
  const fishingBaseFish = resolveMembership(fishingBase, fish, snapshot);
  const fishingMethod = methodFromBait(bait);
  const issues: ForumStagingIssue[] = candidate.issues.map(({ code, field }) =>
    field === undefined ? { code } : { code, field },
  );
  let hasBlockingIssue = issues.length > 0;
  let hasMissingRequiredField = false;

  if (candidate.contributorKey === null || !CONTRIBUTOR_KEY.test(candidate.contributorKey)) {
    addIssue(
      issues,
      candidate.contributorKey === null ? 'MISSING_EXTERNAL_MEMBER_ID' : 'INVALID_CONTRIBUTOR_KEY',
      'contributorKey',
    );
    hasBlockingIssue = true;
  }

  if (!IMPORT_KEY.test(candidate.importKey)) {
    addIssue(issues, 'INVALID_IMPORT_KEY', 'importKey');
    hasBlockingIssue = true;
  }

  for (const [field, resolution] of [
    ['fish', fish],
    ['fishingBase', fishingBase],
    ['location', location],
    ['bait', bait],
  ] as const) {
    const outcome = addResolutionIssue(issues, field, resolution);
    hasMissingRequiredField ||= outcome.missing;
    hasBlockingIssue ||= outcome.blocking;
  }

  if (fishingBaseFish.status === 'MISSING') {
    addIssue(issues, 'MISSING_FISHING_BASE_FISH_MEMBERSHIP', 'fishingBaseFish');
    hasBlockingIssue = true;
  }

  if (candidate.weightGrams === null) {
    addIssue(issues, 'MISSING_WEIGHT_GRAMS', 'weightGrams');
    hasMissingRequiredField = true;
  } else if (!isPositiveInteger(candidate.weightGrams)) {
    addIssue(issues, 'INVALID_WEIGHT_GRAMS', 'weightGrams');
    hasBlockingIssue = true;
  }

  if (candidate.fishingMethod !== null && candidate.fishingMethod !== fishingMethod) {
    addIssue(issues, 'FISHING_METHOD_CONFLICT', 'fishingMethod');
    hasBlockingIssue = true;
  }

  if (candidate.holeDepthCm !== null && !isPositiveInteger(candidate.holeDepthCm)) {
    addIssue(issues, 'INVALID_HOLE_DEPTH_CM', 'holeDepthCm');
    hasBlockingIssue = true;
  }

  if (fishingMethod !== null) {
    const observationErrors = catchReportObservationErrors({
      fishingMethod,
      holeDepthCm: candidate.holeDepthCm,
      spinningSize: candidate.spinningSize,
      spinningSpeed: candidate.spinningSpeed,
    });

    for (const field of Object.keys(observationErrors) as Array<keyof typeof observationErrors>) {
      const missing =
        (field === 'holeDepthCm' && candidate.holeDepthCm === null) ||
        (field === 'spinningSize' && candidate.spinningSize === null) ||
        (field === 'spinningSpeed' && candidate.spinningSpeed === null);

      addIssue(
        issues,
        missing
          ? `MISSING_${field.replace(/([A-Z])/gu, '_$1').toUpperCase()}`
          : `INVALID_${field.replace(/([A-Z])/gu, '_$1').toUpperCase()}_FOR_METHOD`,
        field,
      );
      hasMissingRequiredField ||= missing;
      hasBlockingIssue ||= !missing;
    }
  }

  const spotPositionRaw = normalizeSpotPositionRaw(candidate.spotPositionRaw);
  const userNoteRaw = normalizeUserNoteRaw(candidate.userNoteRaw);

  if (
    spotPositionRaw !== null &&
    (!VALID_SPOT_POSITION_RAW_PATTERN.test(spotPositionRaw) ||
      !SPOT_POSITION_RAW_MAX_LENGTH_PATTERN.test(spotPositionRaw))
  ) {
    addIssue(issues, 'INVALID_SPOT_POSITION_RAW', 'spotPositionRaw');
    hasBlockingIssue = true;
  }

  if (
    userNoteRaw !== null &&
    (!VALID_USER_NOTE_RAW_PATTERN.test(userNoteRaw) ||
      !USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(userNoteRaw))
  ) {
    addIssue(issues, 'INVALID_USER_NOTE_RAW', 'userNoteRaw');
    hasBlockingIssue = true;
  }

  const status: ForumCandidateStatus = hasBlockingIssue
    ? 'UNRESOLVED'
    : hasMissingRequiredField
      ? 'USABLE_PARTIAL'
      : 'USABLE_COMPLETE';

  return {
    ...candidate,
    fishingMethod,
    spotPositionRaw,
    userNoteRaw,
    resolution: { fish, fishingBase, location, bait, fishingBaseFish },
    status,
    issues: sortIssues(issues),
  };
}

export function resolveForumCandidates(
  candidates: readonly ParsedForumCandidate[],
  snapshot: CatalogSnapshot,
): ResolvedForumCandidate[] {
  return candidates.map((candidate) => resolveForumCandidate(candidate, snapshot));
}
