import type {
  CatchReportFishingMethod,
  CatchReportFishingNote,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../catch-reports/catch-reports.constants.js';

export interface TechnicalForumPost {
  subforumId: string;
  topicId: string;
  postId: string;
  memberId: string | null;
  topicTitle: string;
  bodyText: string;
}

/** JavaScript UTF-16 offsets and one-based line numbers in TechnicalForumPost.bodyText. */
export interface CandidateSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

export type ForumCandidateField =
  | 'contributorKey'
  | 'fishNameRaw'
  | 'weightGrams'
  | 'fishingBaseRaw'
  | 'locationRaw'
  | 'baitRaw'
  | 'holeDepthCm'
  | 'spotPositionRaw'
  | 'fishingNote'
  | 'spinningSize'
  | 'spinningSpeed'
  | 'userNoteRaw';

export type ForumCandidateIssueCode =
  | 'MISSING_EXTERNAL_MEMBER_ID'
  | 'AMBIGUOUS_CANDIDATE_FIELD'
  | 'AMBIGUOUS_WEIGHT'
  | 'INVALID_WEIGHT'
  | 'AMBIGUOUS_HOLE_DEPTH'
  | 'INVALID_HOLE_DEPTH'
  | 'AMBIGUOUS_FISHING_NOTE'
  | 'AMBIGUOUS_SPINNING_SIZE'
  | 'AMBIGUOUS_SPINNING_SPEED'
  | 'AMBIGUOUS_USER_NOTE_RAW'
  | 'INVALID_SPOT_POSITION_RAW'
  | 'INVALID_USER_NOTE_RAW';

export interface ForumCandidateIssue {
  code: ForumCandidateIssueCode;
  field?: ForumCandidateField;
}

export interface ParsedForumCandidate {
  contributorKey: string | null;
  importKey: string;
  candidateOrdinal: number;

  fishNameRaw: string | null;
  weightGrams: number | null;
  fishingBaseRaw: string | null;
  locationRaw: string | null;
  baitRaw: string | null;

  /** Derived later, and only from an exactly resolved canonical Bait type. */
  fishingMethod: CatchReportFishingMethod | null;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: CatchReportFishingNote | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;

  userNoteRaw: string | null;
  issues: ForumCandidateIssue[];

  /** Local technical data. Staging exporters must not include this object. */
  technical: {
    subforumId: string;
    topicId: string;
    postId: string;
    sourceRange: CandidateSourceRange;
    sourceText: string;
    supplementarySourceRanges: CandidateSourceRange[];
  };
}
