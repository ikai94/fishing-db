import {
  CATCH_REPORT_MAX_INTEGER,
  type CatchReportFishingNote,
  type CatchReportSpinningSize,
  type CatchReportSpinningSpeed,
} from '../catch-reports/catch-reports.constants.js';
import {
  SPOT_POSITION_RAW_MAX_LENGTH_PATTERN,
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_SPOT_POSITION_RAW_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from '../catch-reports/catch-report-raw-note.js';
import { parseGameLine } from '../catch-reports/parser/game-line-parser.js';
import { parseHoleDepthCm, parseWeightGrams } from '../catch-reports/parser/numeric-parsers.js';
import type {
  CandidateSourceRange,
  ForumCandidateField,
  ForumCandidateIssue,
  ParsedForumCandidate,
  TechnicalForumPost,
} from './candidate-types.js';
import {
  canonicalizeExternalNumericId,
  deriveExternalContributorKey,
  deriveExternalImportKey,
} from './identity.js';

interface RelativeRange {
  start: number;
  end: number;
}

type CandidateSegment = RelativeRange;

type LabelKey =
  | 'fish'
  | 'weight'
  | 'base'
  | 'location'
  | 'bait'
  | 'depth'
  | 'spot'
  | 'fishingNote'
  | 'spinning'
  | 'spinningSize'
  | 'spinningSpeed'
  | 'userNote';

interface LabelEntry {
  key: LabelKey;
  value: string;
  range: RelativeRange;
}

interface TextSource {
  text: string;
  /** Offset relative to the start of the candidate segment. */
  offset: number;
  restrictSpinningToStart?: boolean;
}

interface ParsedDepth {
  value: number | null;
  range: RelativeRange | null;
  issues: ForumCandidateIssue[];
}

interface ParsedEnum<T extends string> {
  value: T | null;
  ranges: RelativeRange[];
  ambiguous: boolean;
}

interface GeneratedFields {
  fishNameRaw: string | null;
  weightRaw: string | null;
  fishingBaseRaw: string | null;
  locationRaw: string | null;
  baitRaw: string | null;
  observation: TextSource | null;
  contextBeforeCore: TextSource | null;
  ambiguousCore: boolean;
}

interface SelectedGeneratedSource {
  source: TextSource;
  contextBeforeCore: TextSource | null;
  ambiguousCore: boolean;
}

const BROAD_WEIGHT_TOKEN =
  /(?<![\p{L}\p{N},+-])(?<!\d\.)[-+]?\d+(?:[,.]\d+)?\s*(?:\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433)(?![\p{L}\p{N}])/giu;
const HAS_UNIT_WEIGHT =
  /(?<![\p{L}\p{N},+-])(?<!\d\.)[-+]?\d+(?:[,.]\d+)?\s*(?:\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433)(?![\p{L}\p{N}])/iu;
const CAUGHT_ON =
  /(?<![\p{L}\p{N}])\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430(?![\p{L}\p{N}])/iu;
const CAUGHT_BY_PLAYER =
  /(?<![\p{L}\p{N}])\u043f\u043e\u0439\u043c\u0430\u043b(?:\u0430|\u0438)?(?![\p{L}\p{N}])/iu;
const SALE_PRICE = /(?:-|\u2013|\u2014)\s*\d[\d\p{White_Space}]*\s*\u0440\u0443\u0431\.?/iu;
const GENERATED_WEIGHT_SOURCE = String.raw`[-+]?\d+(?:[,.]\d+)?\s*(?:\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433)`;
const PARAGRAPH_SEPARATOR = /(?:\r\n|[\n\r])[\t ]*(?:\r\n|[\n\r])/gu;
const LINE = /[^\r\n]+/gu;
const INLINE_FISH_LABEL =
  /;[\t ]*(?:[-*\u2022]\s*)?(?=(?:\u0440\u044b\u0431\u0430|\u0443\u043b\u043e\u0432)\s*(?::|=|\u2014|\u2013|-))/giu;
const LABEL_AT_START =
  /^(?:[-*\u2022]\s*)?(?:\u0440\u044b\u0431\u0430|\u0443\u043b\u043e\u0432)\s*(?::|=|\u2014|\u2013|-)/iu;

const LABEL_HEADER = new RegExp(
  String.raw`(?:^|[\n\r;])[\t ]*(?:[-*\u2022]\s*)?(` +
    [
      '\u0440\u044b\u0431\u043e\u043b\u043e\u0432\u043d\u0430\u044f\\s+\u0431\u0430\u0437\u0430',
      '\u0440\u0430\u0437\u043c\u0435\u0440\\s+\u0441\u043f\u0438\u043d\u043d\u0438\u043d\u0433\u0430',
      '\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c\\s+\u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0438',
      '\u043c\u0435\u0441\u0442\u043e\\s+\u0437\u0430\u0431\u0440\u043e\u0441\u0430',
      '\u043f\u0440\u0438\u043c\u0435\u0447\u0430\u043d\u0438\u0435',
      '\u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439',
      '\u043d\u0430\u0436\u0438\u0432\u043a\u0430',
      '\u043f\u0440\u0438\u043c\u0430\u043d\u043a\u0430',
      '\u043b\u043e\u043a\u0430\u0446\u0438\u044f',
      '\u043f\u043e\u0437\u0438\u0446\u0438\u044f',
      '\u0433\u043b\u0443\u0431\u0438\u043d\u0430',
      '\u0441\u043f\u0438\u043d\u043d\u0438\u043d\u0433',
      '\u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430',
      '\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c',
      '\u0440\u0430\u0437\u043c\u0435\u0440',
      '\u0443\u0441\u043b\u043e\u0432\u0438\u0435',
      '\u043f\u043e\u0434\u0430\u0447\u0430',
      '\u0440\u044b\u0431\u0430',
      '\u0443\u043b\u043e\u0432',
      '\u0432\u0435\u0441',
      '\u0431\u0430\u0437\u0430',
      '\u043b\u043e\u043a\u0430',
      '\u043c\u0435\u0441\u0442\u043e',
      '\u043d\u0430\u0436\u0438\u0432\u043a\u0430',
      '\u043f\u0440\u0438\u043c\u0430\u043d\u043a\u0430',
      '\u044f\u043c\u043a\u0430',
      '\u044f\u043c\u0430',
      '\u0437\u0430\u043c\u0435\u0442\u043a\u0430',
    ].join('|') +
    String.raw`)\s*(?::|=|\u2014|\u2013|-)\s*`,
  'gimu',
);

const FISHING_NOTES: ReadonlyArray<readonly [RegExp, CatchReportFishingNote]> = [
  [
    /(?<![\p{L}\p{N}])\u0432\u043f\u043e\u043b\u0432\u043e\u0434\u044b(?![\p{L}\p{N}])/giu,
    'MIDWATER',
  ],
  [/(?<![\p{L}\p{N}])\u0441\u043e\s+\u0434\u043d\u0430(?![\p{L}\p{N}])/giu, 'FROM_BOTTOM'],
  [/(?<![\p{L}\p{N}])\u0434\u043d\u043e(?![\p{L}\p{N}])/giu, 'FROM_BOTTOM'],
  [/(?<![\p{L}\p{N}])\u043f\u043e\u0432\u0435\u0440\u0445\u0443(?![\p{L}\p{N}])/giu, 'SURFACE'],
];

const SUPPLEMENTARY_PATTERNS = [
  /(?<![\p{L}\p{N}])\u0437\u0430\u0431\u0440\u043e\u0441\s+\u0441\s+\u0431\u0443\u0433\u043e\u0440\u043a\u0430\s+\d+[,.]\d{1,2}(?![\d,.\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u043f\u0440\u043e\u0442\u044f\u0436\u043a\u0430\s+\u0434\u043e\s+\u0433\u043e\u0440\u043a\u0438\s+\d+[,.]\d{1,2}(?![\d,.\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u0434\u0430\u043b\u044c\u043d\u0438\u0439\s+\u0437\u0430\u0431\u0440\u043e\u0441(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u043d\u0430\u0445\u043b\u044b\u0441\u0442(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u0434\u043e\u043d\u043a\u0430(?=\s*,\s*(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438|\u043a\u0443))\s*(?::|=|\u2014|\u2013)?\s*[+-]?\d)/giu,
  /(?<![\p{L}\p{N}])\u043f\u043e\u043b\u043e\u0447\u043a\u0430(?=\s+(?:[+-]?\d))/giu,
] as const;

const EXPLICIT_DEPTH =
  /(?<![\p{L}\p{N}])(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438|\u043a\u0443)|\u043f\u043e\u043b\u043e\u0447\u043a\u0430)(?:-(?=\d)|\s*(?::|=|\u2014|\u2013)?\s*)([+-]?\d+(?:[,.]\d+)?)(?![,.]\d)(?:\s*(?:\u043c|\u043c\u0435\u0442\u0440(?:\u0430|\u043e\u0432)?))?(?![\p{L}\p{N}])/giu;
const COMPACT_DEPTH_AT_START =
  /^\s*(\+?\d{3,})(?:\s*(?:\u043c|\u043c\u0435\u0442\u0440(?:\u0430|\u043e\u0432)?))?(?![\p{L}\p{N}])/iu;
const BARE_DEPTH =
  /(?<![\p{L}\p{N}.+-])(\d+[,.]\d{1,2})(?:\s*\u043c(?![\p{L}\p{N}]))?(?!\d|[,.]\d|\s*(?:\u043a\u0433|\u0433\u0440\.?|\u0433\u0440\u0430\u043c))/giu;
const INVALID_BARE_DEPTH =
  /(?<![\p{L}\p{N},.+-])(\d+[,.]\d{3,})(?![\d,.]|\s*(?:\u043a\u0433|\u0433\u0440\.?|\u0433\u0440\u0430\u043c))/giu;

const COMPACT_SPINNING =
  /(?<![\p{L}\p{N}])(\u043c\u0430\u043b(?:\.|\u0435\u043d\u044c\u043a\u0430\u044f|\u0435\u043d\u044c\u043a\u0438\u0439)?|\u043c|\u0441\u0440(?:\u0435\u0434)?\.?|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0438\u0439)|\u0441|\u0431\u043e\u043b(?:\.|\u044c\u0448\u0430\u044f|\u044c\u0448\u043e\u0439)?|\u0431)\s*[/\\]\s*(\u043c\u0435\u0434(?:\.|\u043b(?:\u0435\u043d\u043d\u0430\u044f|\u0435\u043d\u043d\u043e|\.)?)?|\u043c|\u0441\u0440(?:\u0435\u0434)?\.?|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0435)|\u0431\u044b\u0441\u0442\u0440(?:\u0430\u044f|\u043e|\.)?|\u0431)(?![\p{L}\p{N}])/giu;
const TEXT_SPINNING =
  /(?<![\p{L}\p{N}])(\u043c\u0430\u043b\u0435\u043d\u044c\u043a(?:\u0430\u044f|\u0438\u0439)|\u043c\u0430\u043b(?:\.|\u044b\u0439)?|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0438\u0439)|\u0441\u0440(?:\u0435\u0434|\.)?|\u0431\u043e\u043b\u044c\u0448(?:\u0430\u044f|\u043e\u0439)|\u0431\u043e\u043b\.?)(?:\s*,\s*|\s+)(?:\u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430\s+)?(\u043c\u0435\u0434\u043b(?:\u0435\u043d\u043d\u0430\u044f|\u0435\u043d\u043d\u043e|\.)?|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0435)|\u0441\u0440(?:\u0435\u0434|\.)?|\u0431\u044b\u0441\u0442\u0440(?:\u0430\u044f|\u043e|\.))(?![\p{L}\p{N}])/giu;
const STRUCTURAL_SPINNING =
  /(?<![\p{L}\p{N}])(\u043c\u0430\u043b\u0435\u043d\u044c\u043a(?:\u0430\u044f|\u0438\u0439)|\u043c\u0430\u043b(?:\.|\u044b\u0439)?|\u043c|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0438\u0439)|\u0441\u0440(?:\u0435\u0434|\.)?|\u0441|\u0431\u043e\u043b\u044c\u0448(?:\u0430\u044f|\u043e\u0439)|\u0431\u043e\u043b\.?|\u0431)(?:\s*[,.;:/\\\u2013\u2014-]\s*|\s+)(?:\u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430(?:\s*[,.;:=\u2013\u2014-]\s*|\s+))?(\u043c\u0435\u0434\u043b(?:\u0435\u043d\u043d\u0430\u044f|\u0435\u043d\u043d\u043e|\.)?|\u043c\u0435\u0434\.?|\u043c|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0435)|\u0441\u0440(?:\u0435\u0434|\.)?|\u0431\u044b\u0441\u0442\u0440(?:\u0430\u044f|\u043e|\.)?|\u0431)(?![\p{L}\p{N}])/giu;
const SPINNING_PATTERNS = [COMPACT_SPINNING, TEXT_SPINNING, STRUCTURAL_SPINNING] as const;
const IMMEDIATE_BARE_DEPTH =
  /^(\d+[,.]\d{1,2})(?:\s*\u043c(?![\p{L}\p{N}]))?(?!\d|[,.]\d|\s*(?:\u043a\u0433|\u0433\u0440\.?|\u0433\u0440\u0430\u043c))/iu;
const IMMEDIATE_SPOT_POSITION =
  /^[.\p{White_Space},;:\u2013\u2014-]*(?:\(\s*)?(?:\u043d\u0430\u0434|\u043c\u0435\u0436\u0434\u0443|\u043f\u0435\u0440\u0435\u0434|\u0442\u043e\u0447\u043a\u0430|\u043b\u0435\u0432(?:\u0435\u0435|\u044b\u0439|\u043e)?|\u043f\u0440\u0430\u0432(?:\u0435\u0435|\u044b\u0439|\u043e)?|\u0446\u0435\u043d\u0442\u0440|\u043a\u0440\u0430\u0439|\u0448\u043a(?:\u0430\u043b\u0430)?|\u0440\u044e\u043a\u0437\u0430\u043a|\u0430\u043b\u043a(?:\u043e\u0433\u043e\u043b\u044c)?|\u0431\u043b\u043e\u043a\u043d\u043e\u0442|\u0447\u0430\u0442|\u0443\u0434(?:\u0430|\u043e\u0447\u043a\u0430|\u043e\u0439|\u044b)|\u043a\u0430\u0442(?:\u0430|\u0443\u0448\u043a\u0430)|\u043b\u0435\u0441\u043a\u0430|\u0431\u0430\u0440\u043e\u043c\u0435\u0442\u0440|\u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u044c|\u0441\u043d\u0430\u0441\u0442\u0438|\u044d\u043a\u0440\u0430\u043d|\u044f\u0449\u0438\u043a|\u0435\u0434\u0430|\u0441\u043e\u0431\u044b\u0442\u0438\u044f|\u0438\u0433\u0440\u043e\u043a\u0438|\u0437\u0430\u043c\u0435\u0442\u043a\u0438)(?![\p{L}\p{N}])/iu;

const EXCLUDED_OBSERVATION_NUMBERS = [
  /(?<![\p{L}\p{N}])(?:\u0432\u0440\u0435\u043c\u044f\s*(?::|=|-)?\s*|\u0432\s+)(?:[01]?\d|2[0-3])[.:,][0-5]\d(?!\d)/giu,
  /(?<![\p{L}\p{N}])(?:\u0438\u0433\u0440\u043e\u0432\u0440\u0435\u043c\u044f|\u0438\u0433\u0440\u043e\u0432\u043e\u0435\s+\u0432\u0440\u0435\u043c\u044f|\u0432\u0440\u0435\u043c\u044f|\u0432\u0440\u0435\u043c\u0435\u043d\u0438)(?:\s+\u043e\u043a\u043e\u043b\u043e|\s+\u0441|\s+\u0434\u043e|\s*[:=-])?\s*(?:[01]?\d|2[0-3])[.:,][0-5]\d(?:\s*(?:-|\u0434\u043e)\s*(?:[01]?\d|2[0-3])[.:,][0-5]\d)?(?!\d)/giu,
  /(?<![\p{L}\p{N}])(?:\u0432\s+)?(?:[01]?\d|2[0-3])[.:,][0-5]\d\s*(?:\u0443\u0442\u0440\u0430|\u043d\u043e\u0447\u0438|\u0432\u0435\u0447\u0435\u0440\u0430|\u0438\u0433\u0440\u043e(?:\u0432\u0440\u0435\u043c\u0435\u043d\u0438|\u0432\u0440\u0435\u043c\u044f)|\u0438\u0433\u0440\.?\s*\u0432\u0440\u0435\u043c\u0435\u043d\u0438)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u043e\u043f\u044b\u0442\u0430(?:\s+\p{L}+){0,3}\s+)?\d+(?:[,.]\d+)?\s*(?:\u043c\u043b\u043d|\u043b\u044f\u043c(?:\u0430|\u043e\u0432)?)(?:\.?\s*\u043e\u043f\u044b\u0442\u0430)?(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u0441\u0435\u0440\u0432\u0435\u0440|\u0441\u0435\u0440\u0432\.?|\u043f\u0440\u0438\u043c\u0430\u043d\u043a\u0430|\u0431\u043b\u0435\u0441\u043d\u0430|\u0432\u043e\u0431\u043b\u0435\u0440)\S*\s*(?:\u2116|\u043d\u043e\u043c\u0435\u0440)?\s*\d+(?:[,.]\d+)?/giu,
  /(?<![\p{L}\p{N}])\u2116\s*\d+(?:[,.]\d+)?/giu,
] as const;
const OBSERVATION_TIME = /(?<![\p{L}\p{N}])\u0432\s+(?:[01]?\d|2[0-3])[:.][0-5]\d(?!\d)/giu;
const NON_POSITIONAL_OBSERVATION_SUFFIXES = [
  /(?<![\p{L}\p{N}])(?:\u0438\u0433\u0440\u043e\u0432\u0440\u0435\u043c\u044f|\u0438\u0433\u0440\u043e\u043d\u043e\u0447(?:\u044c|\u044c\u044e)|\u0438\u0433\u0440\u043e\u0434\u0435\u043d\u044c|\u043e\u043f\u044b\u0442\u0430)(?![\p{L}\p{N}])/giu,
  /(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)/giu,
  /(?<![\p{L}\p{N}])\u0432\s+(?:[01]?\d|2[0-3])[-:.,][0-5]\d(?!\d)/giu,
  /(?<![\p{L}\p{N}])\u0432\s+(?:[01]?\d|2[0-3])(?:[:.-][0-5]\d)?\s*(?:\u0447(?:\u0430\u0441(?:\u0430|\u043e\u0432)?)?|\u043f\u043e\s+\u0438\u0433\u0440\u043e\u0432\u043e\u043c\u0443)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\d+\s*(?:-?\u0439\s*)?\u0441\u0435\u0440\u0432\u0435\u0440|\u0441\u0435\u0440\u0432\u0435\u0440)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\d+\s*\u0441\u0435\u0440\u0432?\.?(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u043d\u0430\s+\u0432\u0442\u043e\u0440\u0443\u044e\s+\u043d\u043e\u0447\u044c|\u043d\u043e\u0447(?:\u044c|\u044c\u044e)|\u0443\u0442\u0440(?:\u043e|\u043e\u043c)|\u0432\u0435\u0447\u0435\u0440(?:\u043e\u043c)?|\u0434\u0435\u043d\u044c|\u0434\u043d(?:\u0435\u043c|\u0451\u043c))(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u043d\u0430\s+\u0432\u0442\u043e\u0440\u0443\u044e\s+\u043d\u043e\u0447|\d+\s*(?:\u0443\u0442\u0440\u0430|\u0438\u0433\u0440\u043e\u0432\u0435\u0447\u0435\u0440\u0430))(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u0432\u0441\u0435\u043c\s+\u0443\u0434\u0430\u0447\u0438|\u0441\u043f\u0430\u0441\u0438\u0431\u043e|\u0432\u043e\s+\u0432\u0440\u0435\u043c\u044f|\u0437\u0430\s+\u0438\u0433\u0440\u043e\u0434\u0435\u043d\u044c|\u043a\u0430\u043a\s+\u0432\s+\u043f\u043e\u0441\u0442\u0443|\u043f\u043e\u0439\u043c\u0430\u043b(?:\u0430|\u0438)?|\u043b\u043e\u0432\u0438\u043b(?:\u0430|\u0438)?|\u0432\u0437\u044f\u043b\u0430|\u043f\u043e\u043f\u0430\u043b\u0430\u0441\u044c|\u0445\u043e\u0440\u043e\u0448\u043e\s+\u0447\u0442\u043e|\u0436\u0430\u043b\u044c)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u0441\s+\u0443\u0432\u0430\u0436\u0435\u043d\u0438\u0435\u043c|\u043d\u0435\s+\u0437\u0430\u0447(?:\u0435|\u0451)\u0442|\u0437\u0430\u0447(?:\u0435|\u0451)\u0442|\u043d\u0430\s+\u0441\u0443\u0445\u0443\u044e|\u0431\u0435\u0437\s+\u043e\u0442\u0432\u0430\u0440\u043e\u0432|\u0441\s+\u043a\u0440\u044f\u043a\u043e\u043c|\u0438\u0437\u043d\u043e\u0441\s+\u0443\u0434\u044b|\u0437\u0430\s+\u0441\u0443\u0442\u043a\u0438|viking\s+rod)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:\u0443\u0434\u0430\u0447\u0438|\u043f\u043e\u043a\u043b\u0435\u0432\u043a\u0430|\u043f\u043e\u043f\u043b\u0430\u0432\u043e\u043a|\u0434\u043e\u043d\u043a\u0430)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u0443\u0434\u043e\u0447\u043a\u0430\s+\u043f\u043e\u043f\u043b\u0430\u0432\u043e\u043a(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])\u043d\u0430\s+\S+\s+\u0443\u0434\u0443(?![\p{L}\p{N}])/giu,
  /\(\s*\u0434\u043e(?![\p{L}\p{N}])/giu,
] as const;

function labelKey(rawLabel: string): LabelKey {
  const label = rawLabel.toLowerCase().replace(/\s+/gu, ' ').trim();

  if (label === '\u0440\u044b\u0431\u0430' || label === '\u0443\u043b\u043e\u0432') return 'fish';
  if (label === '\u0432\u0435\u0441') return 'weight';
  if (
    label === '\u0431\u0430\u0437\u0430' ||
    label ===
      '\u0440\u044b\u0431\u043e\u043b\u043e\u0432\u043d\u0430\u044f \u0431\u0430\u0437\u0430'
  )
    return 'base';
  if (
    label === '\u043b\u043e\u043a\u0430' ||
    label === '\u043b\u043e\u043a\u0430\u0446\u0438\u044f' ||
    label === '\u043c\u0435\u0441\u0442\u043e'
  )
    return 'location';
  if (
    label === '\u043d\u0430\u0436\u0438\u0432\u043a\u0430' ||
    label === '\u043f\u0440\u0438\u043c\u0430\u043d\u043a\u0430'
  )
    return 'bait';
  if (
    label === '\u0433\u043b\u0443\u0431\u0438\u043d\u0430' ||
    label === '\u044f\u043c\u0430' ||
    label === '\u044f\u043c\u043a\u0430'
  )
    return 'depth';
  if (
    label === '\u043f\u043e\u0437\u0438\u0446\u0438\u044f' ||
    label === '\u043c\u0435\u0441\u0442\u043e \u0437\u0430\u0431\u0440\u043e\u0441\u0430'
  )
    return 'spot';
  if (
    label === '\u0443\u0441\u043b\u043e\u0432\u0438\u0435' ||
    label === '\u043f\u043e\u0434\u0430\u0447\u0430'
  )
    return 'fishingNote';
  if (label === '\u0441\u043f\u0438\u043d\u043d\u0438\u043d\u0433') return 'spinning';
  if (
    label === '\u0440\u0430\u0437\u043c\u0435\u0440' ||
    label ===
      '\u0440\u0430\u0437\u043c\u0435\u0440 \u0441\u043f\u0438\u043d\u043d\u0438\u043d\u0433\u0430'
  )
    return 'spinningSize';
  if (
    label === '\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c' ||
    label === '\u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0430' ||
    label ===
      '\u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u043f\u0440\u043e\u0432\u043e\u0434\u043a\u0438'
  ) {
    return 'spinningSpeed';
  }

  return 'userNote';
}

function trimRange(source: string, start: number, end: number): RelativeRange | null {
  const raw = source.slice(start, end);
  const leading = raw.length - raw.replace(/^\s+/u, '').length;
  const afterLeading = raw.slice(leading);
  const trailing = afterLeading.length - afterLeading.replace(/\s+$/u, '').length;
  const result = { start: start + leading, end: end - trailing };
  return result.end > result.start ? result : null;
}

function trimStructuralValue(value: string): string | null {
  const trimmed = value
    .replace(/^[\p{White_Space},;:]+/u, '')
    .replace(/[\p{White_Space},;:]+$/u, '')
    .replace(/\.$/u, '')
    .trimEnd();
  return trimmed.length === 0 ? null : trimmed;
}

function lineAt(source: string, offset: number): number {
  let line = 1;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index];

    if (character === '\r') {
      line += 1;
      if (source[index + 1] === '\n') index += 1;
    } else if (character === '\n') {
      line += 1;
    }
  }

  return line;
}

function candidateSourceRange(bodyText: string, range: RelativeRange): CandidateSourceRange {
  return {
    startOffset: range.start,
    endOffset: range.end,
    startLine: lineAt(bodyText, range.start),
    endLine: lineAt(bodyText, Math.max(range.start, range.end - 1)),
  };
}

function rangesOverlap(left: RelativeRange, right: RelativeRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function regexRanges(source: string, pattern: RegExp): RelativeRange[] {
  pattern.lastIndex = 0;
  return Array.from(source.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function parseLabels(source: string): LabelEntry[] {
  LABEL_HEADER.lastIndex = 0;
  const matches = Array.from(source.matchAll(LABEL_HEADER));

  return matches.flatMap((match, index) => {
    const rawLabel = match[1];

    if (rawLabel === undefined) return [];

    const valueStart = match.index + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? source.length;
    const range = trimRange(source, valueStart, valueEnd);

    if (range === null) return [];

    const value = trimStructuralValue(source.slice(range.start, range.end));
    return value === null ? [] : [{ key: labelKey(rawLabel), value, range }];
  });
}

function startsStrongCandidate(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    LABEL_AT_START.test(trimmed) ||
    (HAS_UNIT_WEIGHT.test(trimmed) && (CAUGHT_ON.test(trimmed) || CAUGHT_BY_PLAYER.test(trimmed)))
  );
}

function isLabelCluster(source: string): boolean {
  const keys = new Set(parseLabels(source).map((entry) => entry.key));
  return (
    keys.size >= 3 &&
    (keys.has('weight') || keys.has('depth')) &&
    (keys.has('base') || keys.has('location') || keys.has('bait'))
  );
}

function paragraphRanges(bodyText: string): RelativeRange[] {
  const ranges: RelativeRange[] = [];
  let cursor = 0;

  PARAGRAPH_SEPARATOR.lastIndex = 0;
  for (const match of bodyText.matchAll(PARAGRAPH_SEPARATOR)) {
    const range = trimRange(bodyText, cursor, match.index);
    if (range !== null) ranges.push(range);
    cursor = match.index + match[0].length;
  }

  const tail = trimRange(bodyText, cursor, bodyText.length);
  if (tail !== null) ranges.push(tail);
  return ranges;
}

function exactTopicWeightStarts(source: string, topicFishRaw: string | null): number[] {
  if (topicFishRaw === null) return [];

  const boundedWeight = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${exactTextPattern(topicFishRaw)}(?=\s+${GENERATED_WEIGHT_SOURCE}(?![\p{L}\p{N}]))`,
    'giu',
  );
  const concatenatedGeneratedCatch = new RegExp(
    String.raw`${exactTextPattern(topicFishRaw)}(?=\s+${GENERATED_WEIGHT_SOURCE}\s*[.!?]?\s*\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430\s+[^:\r\n]+\s*:)`,
    'giu',
  );
  return [
    ...new Set([
      ...Array.from(source.matchAll(boundedWeight), (match) => match.index),
      ...Array.from(source.matchAll(concatenatedGeneratedCatch), (match) => match.index),
    ]),
  ].sort((left, right) => left - right);
}

function refinedCandidateStarts(
  paragraphText: string,
  broadStarts: readonly number[],
  topicFishRaw: string | null,
): number[] {
  if (broadStarts.length === 0) return [];

  const exactStarts = exactTopicWeightStarts(paragraphText, topicFishRaw);
  if (exactStarts.length < 2) return [...broadStarts];

  const refined: number[] = [];
  broadStarts.forEach((start, index) => {
    const end = broadStarts[index + 1] ?? paragraphText.length;
    const exactInside = exactStarts.filter((exact) => exact >= start && exact < end);
    if (exactInside.length < 2) {
      refined.push(start);
      return;
    }

    const firstExact = exactInside[0] ?? start;
    const prefix = paragraphText.slice(start, firstExact);
    const addedConcatenatedCatch = exactInside
      .slice(1)
      .some((exact) => /[\p{L}\p{N}]/u.test(paragraphText[exact - 1] ?? ''));
    const preserveCatchLogPrefix =
      addedConcatenatedCatch && /^\s*\u0443\u043b\u043e\u0432\s*:?\s*$/iu.test(prefix);
    refined.push(preserveCatchLogPrefix ? start : firstExact, ...exactInside.slice(1));
  });
  return refined;
}

function segmentCandidates(bodyText: string, topicFishRaw: string | null): CandidateSegment[] {
  const segments: CandidateSegment[] = [];

  for (const paragraph of paragraphRanges(bodyText)) {
    const paragraphText = bodyText.slice(paragraph.start, paragraph.end);
    const starts: number[] = [];

    LINE.lastIndex = 0;
    for (const match of paragraphText.matchAll(LINE)) {
      if (startsStrongCandidate(match[0])) {
        const leading = match[0].length - match[0].trimStart().length;
        starts.push(paragraph.start + match.index + leading);
      }
    }

    INLINE_FISH_LABEL.lastIndex = 0;
    for (const match of paragraphText.matchAll(INLINE_FISH_LABEL)) {
      const afterSeparator = match.index + match[0].length;
      starts.push(paragraph.start + afterSeparator);
    }

    if (starts.length === 0 && isLabelCluster(paragraphText)) {
      starts.push(paragraph.start);
    }

    const broadStarts = [...new Set(starts)]
      .map((start) => start - paragraph.start)
      .sort((left, right) => left - right);
    const uniqueStarts = refinedCandidateStarts(paragraphText, broadStarts, topicFishRaw).map(
      (start) => paragraph.start + start,
    );

    uniqueStarts.forEach((start, index) => {
      const end = uniqueStarts[index + 1] ?? paragraph.end;
      const range = trimRange(bodyText, start, end);
      if (range !== null) segments.push(range);
    });
  }

  return segments
    .filter((segment) => {
      const source = bodyText.slice(segment.start, segment.end);
      return !SALE_PRICE.test(source) || CAUGHT_ON.test(source) || CAUGHT_BY_PLAYER.test(source);
    })
    .sort((left, right) => left.start - right.start);
}

function selectLabelValue(
  entries: readonly LabelEntry[],
  key: LabelKey,
  field: ForumCandidateField,
  issues: ForumCandidateIssue[],
): LabelEntry | null {
  const matching = entries.filter((entry) => entry.key === key);
  const distinct = new Set(matching.map((entry) => entry.value));

  if (distinct.size > 1) {
    issues.push({ code: 'AMBIGUOUS_CANDIDATE_FIELD', field });
    return null;
  }

  return matching[0] ?? null;
}

function stripCandidatePrefix(source: string): TextSource {
  const match = /^\s*(?:[-*\u2022]|\d+[.)])\s*/u.exec(source);
  const offset = match?.[0].length ?? source.length - source.trimStart().length;
  return { text: source.slice(offset), offset };
}

function topicFishNameRaw(topicTitle: string): string | null {
  const title = trimStructuralValue(topicTitle);
  if (title === null) return null;

  const withTrailingVariant = /^(.+?)\s+\([^()\r\n]+\)$/u.exec(title);
  return trimStructuralValue(withTrailingVariant?.[1] ?? title);
}

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function exactTextPattern(source: string): string {
  return source
    .trim()
    .split(/\s+/u)
    .map((part) => escapeRegExp(part))
    .join(String.raw`\s+`);
}

function selectGeneratedSource(
  candidateText: string,
  topicFishRaw: string | null,
): SelectedGeneratedSource {
  const stripped = stripCandidatePrefix(candidateText);
  if (topicFishRaw === null) {
    return { source: stripped, contextBeforeCore: null, ambiguousCore: false };
  }

  const topicFish = exactTextPattern(topicFishRaw);
  const generatedCore = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${topicFish}(?=\s+${GENERATED_WEIGHT_SOURCE}\s*[.!?]?\s*\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430\s+[^:\r\n]+\s*:)`,
    'giu',
  );
  const matches = Array.from(candidateText.matchAll(generatedCore));

  if (matches.length > 1) {
    return { source: stripped, contextBeforeCore: null, ambiguousCore: true };
  }

  const start = matches[0]?.index;
  if (start === undefined) {
    return { source: stripped, contextBeforeCore: null, ambiguousCore: false };
  }

  const rawContext = candidateText.slice(0, start);
  return {
    source: { text: candidateText.slice(start), offset: start },
    contextBeforeCore: rawContext.trim().length === 0 ? null : { text: rawContext, offset: 0 },
    ambiguousCore: false,
  };
}

function beginsObservation(source: string): boolean {
  const trimmed = source.trimStart().replace(/^\(\s*/u, '');
  const beginsWithField =
    /^(?:(?:\u0434\u043e\u043d\u043a\u0430\s*,\s*)?(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438|\u043a\u0443)|\u043f\u043e\u043b\u043e\u0447\u043a\u0430)(?![\p{L}\p{N}])|\d{3,}(?:\s|$)|\d+[,.]\d{1,2}(?:\s*\u043c)?(?:\s|$)|(?:\u043c|\u0441\u0440\.?|\u0431)\s*[/\\]\s*(?:\u043c|\u0441\u0440\.?|\u0431)(?:\s|$)|\u0432\u043f\u043e\u043b\u0432\u043e\u0434\u044b(?![\p{L}\p{N}])|\u0441\u043e\s+\u0434\u043d\u0430(?![\p{L}\p{N}])|\u0434\u043d\u043e(?![\p{L}\p{N}])|\u043f\u043e\u0432\u0435\u0440\u0445\u0443(?![\p{L}\p{N}])|\u0437\u0430\u0431\u0440\u043e\u0441\s+\u0441\s+\u0431\u0443\u0433\u043e\u0440\u043a\u0430(?![\p{L}\p{N}])|\u043f\u0440\u043e\u0442\u044f\u0436\u043a\u0430\s+\u0434\u043e\s+\u0433\u043e\u0440\u043a\u0438(?![\p{L}\p{N}])|\u0434\u0430\u043b\u044c\u043d\u0438\u0439\s+\u0437\u0430\u0431\u0440\u043e\u0441(?![\p{L}\p{N}])|\u043d\u0430\u0445\u043b\u044b\u0441\u0442(?![\p{L}\p{N}]))/iu.test(
      trimmed,
    );
  if (beginsWithField) return true;

  for (const pattern of SPINNING_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(trimmed);
    if (match?.index === 0) return true;
  }

  if (beginsUniqueImmediateDepth(trimmed, false)) return true;

  const beginsWithApprovedMetadata =
    /^(?:\u0432\s+(?:[01]?\d|2[0-3])[:.][0-5]\d|\u0432\u0440\u0435\u043c\u044f|\u0441\u0435\u0440\u0432\u0435\u0440|\u043f\u0440\u0438\u043c\u0430\u043d\u043a\u0430|\u0432\u0435\u0441)(?![\p{L}\p{N}])/iu.test(
      trimmed,
    );
  if (!beginsWithApprovedMetadata) return false;

  const depth = parseDepth(trimmed);
  return depth.value !== null && depth.issues.length === 0;
}

function beginsUniqueImmediateDepth(source: string, allowExplicit: boolean): boolean {
  const trimmed = source.trimStart().replace(/^\(\s*/u, '');
  const beginsExplicit =
    /^(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438|\u043a\u0443)|\u043f\u043e\u043b\u043e\u0447\u043a\u0430)(?![\p{L}\p{N}])/iu.test(
      trimmed,
    );
  const beginsCompact = /^\d{3,}(?![\p{L}\p{N}])/u.test(trimmed);
  const beginsBare = IMMEDIATE_BARE_DEPTH.test(trimmed);
  if (!(allowExplicit && beginsExplicit) && !beginsCompact && !beginsBare) return false;

  const parsed = parseDepth(trimmed, beginsCompact);
  if (
    parsed.value === null ||
    parsed.range === null ||
    (!beginsExplicit && parsed.range.start !== 0) ||
    parsed.issues.length > 0
  )
    return false;
  return beginsExplicit || IMMEDIATE_SPOT_POSITION.test(trimmed.slice(parsed.range.end));
}

function beginsNewAnchoredBareDepth(source: string): boolean {
  const trimmed = source.trimStart().replace(/^\(\s*/u, '');
  const alreadySupported = /^\d+[,.]\d{1,2}(?:\s*\u043c)?(?:\s|$)/iu.test(trimmed);
  return !alreadySupported && beginsUniqueImmediateDepth(trimmed, false);
}

function immediateObservation(source: string, start: number, offset: number): TextSource {
  const raw = source.slice(start);
  const parenthesized = /^\s*\(\s*/u.exec(raw);
  const contentStart = start + (parenthesized?.[0].length ?? 0);
  const lineBreak = /\r\n|[\n\r]/u.exec(source.slice(contentStart));
  const lineEnd = lineBreak === null ? source.length : contentStart + lineBreak.index;
  const closingParenthesis = parenthesized === null ? -1 : source.indexOf(')', contentStart);
  const end = closingParenthesis >= 0 ? Math.min(lineEnd, closingParenthesis) : lineEnd;
  return { text: source.slice(contentStart, end), offset: offset + contentStart };
}

function spinningPairAtStart(source: string): { end: number; structuralOnly: boolean } | null {
  let structuralEnd: number | null = null;

  STRUCTURAL_SPINNING.lastIndex = 0;
  const structural = STRUCTURAL_SPINNING.exec(source);
  if (structural?.index === 0) structuralEnd = structural[0].length;

  for (const pattern of [COMPACT_SPINNING, TEXT_SPINNING]) {
    pattern.lastIndex = 0;
    const existing = pattern.exec(source);
    if (existing?.index === 0) {
      return { end: existing[0].length, structuralOnly: false };
    }
  }

  return structuralEnd === null ? null : { end: structuralEnd, structuralOnly: true };
}

function inlineSpinningObservationStart(
  source: string,
): { start: number; structuralEnd: number | null } | null {
  let earliest: number | null = null;

  for (const pattern of SPINNING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (match.index === 0 || !/[\s,;]/u.test(source[match.index - 1] ?? '')) continue;
      earliest = earliest === null ? match.index : Math.min(earliest, match.index);
    }
  }

  if (earliest === null) return null;
  const pair = spinningPairAtStart(source.slice(earliest));
  return {
    start: earliest,
    structuralEnd: pair?.structuralOnly === true ? earliest + pair.end : null,
  };
}

function boundedObservation(
  source: string,
  start: number,
  end: number,
  offset: number,
): TextSource {
  return { text: source.slice(start, end), offset: offset + start, restrictSpinningToStart: true };
}

function structuralSpinningObservation(
  source: string,
  start: number,
  pairEnd: number,
  offset: number,
): TextSource {
  const depthStart =
    pairEnd +
    (/^[\p{White_Space}.,;:\u2013\u2014-]*/u.exec(source.slice(pairEnd))?.[0].length ?? 0);
  if (beginsUniqueImmediateDepth(source.slice(depthStart), true)) {
    const observation = immediateObservation(source, start, offset);
    observation.restrictSpinningToStart = true;
    return observation;
  }

  return boundedObservation(source, start, pairEnd, offset);
}

function splitBaitAndObservation(
  source: string,
  offset: number,
): {
  baitRaw: string | null;
  observation: TextSource | null;
} {
  const firstHardBoundary = /[.\r\n]/u.exec(source)?.index ?? source.length;
  const inlineExplicitDepth =
    /[\t ]+(?=(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438|\u043a\u0443)|\u043f\u043e\u043b\u043e\u0447\u043a\u0430)\s*(?::|=|\u2014|\u2013)?\s*[+-]?\d)/iu.exec(
      source.slice(0, firstHardBoundary),
    );
  const separatorBeforeInline =
    inlineExplicitDepth === null ? null : /[,;]/u.exec(source.slice(0, inlineExplicitDepth.index));
  if (inlineExplicitDepth !== null && separatorBeforeInline === null) {
    const observationStart = inlineExplicitDepth.index + inlineExplicitDepth[0].length;
    return {
      baitRaw: trimStructuralValue(source.slice(0, inlineExplicitDepth.index)),
      observation: immediateObservation(source, observationStart, offset),
    };
  }

  const spinningObservationStart = inlineSpinningObservationStart(
    source.slice(0, firstHardBoundary),
  );
  if (spinningObservationStart !== null) {
    return {
      baitRaw: trimStructuralValue(source.slice(0, spinningObservationStart.start)),
      observation:
        spinningObservationStart.structuralEnd === null
          ? immediateObservation(source, spinningObservationStart.start, offset)
          : structuralSpinningObservation(
              source,
              spinningObservationStart.start,
              spinningObservationStart.structuralEnd,
              offset,
            ),
    };
  }

  const separators = /[.,;]+(?:[\t ]*[\u2013\u2014-])?|\r\n|[\n\r]/gu;

  for (const match of source.matchAll(separators)) {
    const suffixStart = match.index + match[0].length;
    const rawSuffix = source.slice(suffixStart);
    const leading = rawSuffix.length - rawSuffix.trimStart().length;
    const observationStart = suffixStart + leading;
    const observationSource = source.slice(observationStart);
    const spinningPair = spinningPairAtStart(observationSource);
    const newStructuralSeparator =
      /[\u2013\u2014-]/u.test(match[0]) || /^[.,;]{2,}$/u.test(match[0]);

    if (spinningPair !== null && (spinningPair.structuralOnly || newStructuralSeparator)) {
      return {
        baitRaw: trimStructuralValue(source.slice(0, match.index)),
        observation: structuralSpinningObservation(
          source,
          observationStart,
          observationStart + spinningPair.end,
          offset,
        ),
      };
    }

    if (newStructuralSeparator) {
      if (beginsUniqueImmediateDepth(observationSource, true)) {
        const observation = immediateObservation(source, observationStart, offset);
        observation.restrictSpinningToStart = true;
        return {
          baitRaw: trimStructuralValue(source.slice(0, match.index)),
          observation,
        };
      }
    } else if (beginsObservation(observationSource)) {
      const observation = immediateObservation(source, observationStart, offset);
      if (beginsNewAnchoredBareDepth(observationSource)) {
        observation.restrictSpinningToStart = true;
      }

      return {
        baitRaw: trimStructuralValue(source.slice(0, match.index)),
        observation,
      };
    }

    if (/\.|\r\n|[\n\r]/u.test(match[0])) {
      return { baitRaw: trimStructuralValue(source.slice(0, match.index)), observation: null };
    }
  }

  return { baitRaw: trimStructuralValue(source), observation: null };
}

function emptyGeneratedFields(
  contextBeforeCore: TextSource | null,
  ambiguousCore: boolean,
): GeneratedFields {
  return {
    fishNameRaw: null,
    weightRaw: null,
    fishingBaseRaw: null,
    locationRaw: null,
    baitRaw: null,
    observation: null,
    contextBeforeCore,
    ambiguousCore,
  };
}

function parseGeneratedFields(candidateText: string, topicFishRaw: string | null): GeneratedFields {
  const selected = selectGeneratedSource(candidateText, topicFishRaw);
  if (selected.ambiguousCore) return emptyGeneratedFields(null, true);

  const generatedSource = selected.source;
  const gameLine = parseGameLine(generatedSource.text);

  if (!gameLine.hasGameCore || gameLine.locationAndBaitSource === null) {
    const alternateCatch = new RegExp(
      String.raw`^(.+?)\s*,\s*(${GENERATED_WEIGHT_SOURCE})\s+\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430\s+(.+?)\s+\u0432\s+\u044f\u043c(?:\u0435|\u043a\u0435)\s*([+-]?\d+(?:[,.]\d+)?)\s+\u043d\u0430\s+([^,.\r\n]+)(?:[,\r\n.]|$)`,
      'iu',
    ).exec(generatedSource.text);

    if (alternateCatch !== null) {
      const fullMatch = alternateCatch[0];
      const depthMarker = /\u044f\u043c(?:\u0435|\u043a\u0435)\s*[+-]?\d+(?:[,.]\d+)?/iu.exec(
        fullMatch,
      );
      const depthStart = depthMarker?.index ?? 0;
      return {
        fishNameRaw: trimStructuralValue(alternateCatch[1] ?? ''),
        weightRaw: trimStructuralValue(alternateCatch[2] ?? ''),
        fishingBaseRaw: null,
        locationRaw: trimStructuralValue(alternateCatch[3] ?? ''),
        baitRaw: trimStructuralValue(alternateCatch[5] ?? ''),
        observation:
          depthMarker === null
            ? null
            : {
                text: depthMarker[0],
                offset: generatedSource.offset + depthStart,
              },
        contextBeforeCore: selected.contextBeforeCore,
        ambiguousCore: false,
      };
    }

    const malformedGenerated =
      /^(.+?)\s+([-+]?\d+(?:[,.]\d+)?\s*(?:\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433))\s*[.!?]?\s*\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430\s+([^:\r\n]+)\s*:\s*([\s\S]+)$/iu.exec(
        generatedSource.text,
      );

    if (malformedGenerated !== null) {
      const rawLocationAndBait = malformedGenerated[4] ?? '';
      const commaIndex = rawLocationAndBait.indexOf(',');

      if (commaIndex >= 0) {
        const baitStart = commaIndex + 1;
        const baitWithSuffix = rawLocationAndBait.slice(baitStart).trimStart();
        const baitLeading = rawLocationAndBait.slice(baitStart).length - baitWithSuffix.length;
        const restStart = generatedSource.text.lastIndexOf(rawLocationAndBait);
        const split = splitBaitAndObservation(
          baitWithSuffix,
          generatedSource.offset + restStart + baitStart + baitLeading,
        );

        return {
          fishNameRaw: trimStructuralValue(malformedGenerated[1] ?? ''),
          weightRaw: trimStructuralValue(malformedGenerated[2] ?? ''),
          fishingBaseRaw: trimStructuralValue(malformedGenerated[3] ?? ''),
          locationRaw: trimStructuralValue(rawLocationAndBait.slice(0, commaIndex)),
          baitRaw: split.baitRaw,
          observation: split.observation,
          contextBeforeCore: selected.contextBeforeCore,
          ambiguousCore: false,
        };
      }
    }

    const caught =
      /(?<![\p{L}\p{N}])\u043f\u043e\u0439\u043c\u0430\u043b(?:\u0430|\u0438)?\s+(?:\u0440\u044b\u0431\u0443\s+)?(.+?)\s+([-+]?\d+(?:[,.]\d+)?\s*(?:\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433))(?![\p{L}\p{N}])/iu.exec(
        generatedSource.text,
      );

    if (caught === null && topicFishRaw !== null) {
      const exactTopicWeight = new RegExp(
        String.raw`^\s*${exactTextPattern(topicFishRaw)}\s+(${GENERATED_WEIGHT_SOURCE})(?![\p{L}\p{N}])`,
        'iu',
      ).exec(generatedSource.text);

      if (exactTopicWeight !== null) {
        return {
          fishNameRaw: topicFishRaw,
          weightRaw: trimStructuralValue(exactTopicWeight[1] ?? ''),
          fishingBaseRaw: null,
          locationRaw: null,
          baitRaw: null,
          observation: null,
          contextBeforeCore: selected.contextBeforeCore,
          ambiguousCore: false,
        };
      }
    }

    return {
      fishNameRaw: trimStructuralValue(caught?.[1] ?? ''),
      weightRaw: trimStructuralValue(caught?.[2] ?? ''),
      fishingBaseRaw: null,
      locationRaw: null,
      baitRaw: null,
      observation: null,
      contextBeforeCore: selected.contextBeforeCore,
      ambiguousCore: false,
    };
  }

  const locationAndBait = gameLine.locationAndBaitSource;
  const commaIndex = locationAndBait.text.indexOf(',');

  if (commaIndex < 0) {
    return {
      fishNameRaw: trimStructuralValue(gameLine.fishSource?.text ?? ''),
      weightRaw: trimStructuralValue(gameLine.weight?.source.text ?? ''),
      fishingBaseRaw: trimStructuralValue(gameLine.fishingBaseSource?.text ?? ''),
      locationRaw: trimStructuralValue(locationAndBait.text),
      baitRaw: null,
      observation: null,
      contextBeforeCore: selected.contextBeforeCore,
      ambiguousCore: false,
    };
  }

  const baitStart = commaIndex + 1;
  const baitWithSuffix = locationAndBait.text.slice(baitStart).trimStart();
  const baitLeading = locationAndBait.text.slice(baitStart).length - baitWithSuffix.length;
  const baitOffset = generatedSource.offset + locationAndBait.start + baitStart + baitLeading;
  const split = splitBaitAndObservation(baitWithSuffix, baitOffset);

  return {
    fishNameRaw: trimStructuralValue(gameLine.fishSource?.text ?? ''),
    weightRaw: trimStructuralValue(gameLine.weight?.source.text ?? ''),
    fishingBaseRaw: trimStructuralValue(gameLine.fishingBaseSource?.text ?? ''),
    locationRaw: trimStructuralValue(locationAndBait.text.slice(0, commaIndex)),
    baitRaw: split.baitRaw,
    observation: split.observation,
    contextBeforeCore: selected.contextBeforeCore,
    ambiguousCore: false,
  };
}

function parseWeight(source: string | null, issues: ForumCandidateIssue[]): number | null {
  if (source === null) return null;

  BROAD_WEIGHT_TOKEN.lastIndex = 0;
  const matches = Array.from(source.matchAll(BROAD_WEIGHT_TOKEN));

  if (matches.length > 1) {
    issues.push({ code: 'AMBIGUOUS_WEIGHT', field: 'weightGrams' });
    return null;
  }

  const token = matches[0]?.[0];
  if (token === undefined) {
    issues.push({ code: 'INVALID_WEIGHT', field: 'weightGrams' });
    return null;
  }

  const value = parseWeightGrams(token);
  if (value === null) issues.push({ code: 'INVALID_WEIGHT', field: 'weightGrams' });
  return value;
}

function supplementaryRanges(source: string): RelativeRange[] {
  return SUPPLEMENTARY_PATTERNS.flatMap((pattern) => regexRanges(source, pattern)).sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function observationMetadataRanges(source: string): RelativeRange[] {
  return EXCLUDED_OBSERVATION_NUMBERS.flatMap((pattern) => regexRanges(source, pattern));
}

function nonPositionalObservationRanges(source: string): RelativeRange[] {
  return NON_POSITIONAL_OBSERVATION_SUFFIXES.flatMap((pattern) => regexRanges(source, pattern));
}

function uniqueRanges(ranges: readonly RelativeRange[]): RelativeRange[] {
  const byBoundary = new Map(ranges.map((range) => [`${range.start}:${range.end}`, range]));
  return [...byBoundary.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function excludedDepthRanges(source: string): RelativeRange[] {
  return [
    ...regexRanges(source, BROAD_WEIGHT_TOKEN),
    ...observationMetadataRanges(source),
    ...supplementaryRanges(source),
  ];
}

function parseForumDepthToken(source: string): number | null {
  const trimmed = source.trim();
  const compact = /^\+?(\d{3,})$/u.exec(trimmed);
  if (compact !== null) {
    const digits = compact[1];
    if (digits === undefined) return null;

    // The last two decimal digits are centimetres. In centimetres the exact
    // value is therefore the compact digit string itself (831 => 8 m 31 cm).
    const value = BigInt(digits);
    return value >= 1n && value <= BigInt(CATCH_REPORT_MAX_INTEGER) ? Number(value) : null;
  }

  return parseHoleDepthCm(trimmed);
}

function parseDepth(source: string, standaloneDepthContext = false): ParsedDepth {
  const excluded = excludedDepthRanges(source);
  const issues: ForumCandidateIssue[] = [];
  const valid: Array<{ value: number; range: RelativeRange }> = [];
  const invalidRanges: RelativeRange[] = [];
  const explicitRanges: RelativeRange[] = [];
  let hasInvalid = false;

  if (standaloneDepthContext) {
    const match = COMPACT_DEPTH_AT_START.exec(source);
    const numeric = match?.[1];

    if (match !== null && numeric !== undefined) {
      const numericStart = match.index + match[0].indexOf(numeric);
      const range = { start: numericStart, end: match.index + match[0].length };
      explicitRanges.push({ start: match.index, end: match.index + match[0].length });
      const value = parseForumDepthToken(numeric);

      if (value === null) {
        hasInvalid = true;
        invalidRanges.push(range);
      } else {
        valid.push({ value, range });
      }
    }
  }

  EXPLICIT_DEPTH.lastIndex = 0;
  for (const match of source.matchAll(EXPLICIT_DEPTH)) {
    const numeric = match[1];
    if (numeric === undefined) continue;

    const numericStart = match.index + match[0].lastIndexOf(numeric);
    const numericRange = { start: numericStart, end: match.index + match[0].length };
    explicitRanges.push({ start: match.index, end: match.index + match[0].length });
    const value = parseForumDepthToken(numeric);

    if (value === null) {
      hasInvalid = true;
      invalidRanges.push(numericRange);
    } else valid.push({ value, range: numericRange });
  }

  BARE_DEPTH.lastIndex = 0;
  for (const match of source.matchAll(BARE_DEPTH)) {
    const numeric = match[1];
    if (numeric === undefined) continue;

    const numericStart = match.index + match[0].indexOf(numeric);
    const wholeRange = { start: match.index, end: match.index + match[0].length };
    const numericRange = { start: numericStart, end: wholeRange.end };

    if (
      explicitRanges.some((range) => rangesOverlap(range, wholeRange)) ||
      excluded.some((range) => rangesOverlap(range, wholeRange))
    ) {
      continue;
    }

    const value = parseForumDepthToken(numeric);
    if (value === null) {
      hasInvalid = true;
      invalidRanges.push(numericRange);
    } else valid.push({ value, range: numericRange });
  }

  INVALID_BARE_DEPTH.lastIndex = 0;
  for (const match of source.matchAll(INVALID_BARE_DEPTH)) {
    const range = { start: match.index, end: match.index + match[0].length };

    if (
      !explicitRanges.some((item) => rangesOverlap(item, range)) &&
      !excluded.some((item) => rangesOverlap(item, range))
    ) {
      hasInvalid = true;
      invalidRanges.push(range);
    }
  }

  if (hasInvalid) {
    issues.push({ code: 'INVALID_HOLE_DEPTH', field: 'holeDepthCm' });
  }

  if (valid.length > 1) {
    issues.push({ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' });
  }

  if (hasInvalid || valid.length !== 1) {
    const soleInvalidRange =
      valid.length === 0 && invalidRanges.length === 1 ? invalidRanges[0] : null;
    return { value: null, range: soleInvalidRange ?? null, issues };
  }
  return { value: valid[0]?.value ?? null, range: valid[0]?.range ?? null, issues };
}

function parseFishingNote(source: string): ParsedEnum<CatchReportFishingNote> {
  const matches = FISHING_NOTES.flatMap(([pattern, value]) =>
    regexRanges(source, pattern).map((range) => ({ value, range })),
  ).sort((left, right) => left.range.start - right.range.start);
  const values = new Set(matches.map((match) => match.value));
  return {
    value: values.size === 1 ? (matches[0]?.value ?? null) : null,
    ranges: matches.map((match) => match.range),
    ambiguous: values.size > 1,
  };
}

function spinningSize(value: string): CatchReportSpinningSize | null {
  const normalized = value.toLowerCase().replace(/\.$/u, '');
  if (
    /^(?:\u043c|\u043c\u0430\u043b|\u043c\u0430\u043b\u044b\u0439|\u043c\u0430\u043b\u0435\u043d\u044c\u043a(?:\u0430\u044f|\u0438\u0439))$/u.test(
      normalized,
    )
  )
    return 'SMALL';
  if (
    /^(?:\u0441|\u0441\u0440|\u0441\u0440\u0435\u0434|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0438\u0439))$/u.test(
      normalized,
    )
  )
    return 'MEDIUM';
  if (
    /^(?:\u0431|\u0431\u043e\u043b|\u0431\u043e\u043b\u044c\u0448(?:\u0430\u044f|\u043e\u0439))$/u.test(
      normalized,
    )
  )
    return 'LARGE';
  return null;
}

function spinningSpeed(value: string): CatchReportSpinningSpeed | null {
  const normalized = value.toLowerCase().replace(/\.$/u, '');
  if (
    /^(?:\u043c|\u043c\u0435\u0434|\u043c\u0435\u0434\u043b|\u043c\u0435\u0434\u043b\u0435\u043d\u043d(?:\u0430\u044f|\u043e))$/u.test(
      normalized,
    )
  )
    return 'SLOW';
  if (
    /^(?:\u0441\u0440|\u0441\u0440\u0435\u0434|\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0435))$/u.test(
      normalized,
    )
  )
    return 'MEDIUM';
  if (
    /^(?:\u0431|\u0431\u044b\u0441\u0442\u0440|\u0431\u044b\u0441\u0442\u0440(?:\u0430\u044f|\u043e))$/u.test(
      normalized,
    )
  )
    return 'FAST';
  return null;
}

function parseSpinning(
  source: string,
  sizeLabel: LabelEntry | null,
  speedLabel: LabelEntry | null,
  restrictToStart = false,
): {
  size: ParsedEnum<CatchReportSpinningSize>;
  speed: ParsedEnum<CatchReportSpinningSpeed>;
  ranges: RelativeRange[];
} {
  const sizes: Array<{ value: CatchReportSpinningSize; range: RelativeRange }> = [];
  const speeds: Array<{ value: CatchReportSpinningSpeed; range: RelativeRange }> = [];
  const ranges: RelativeRange[] = [];

  for (const pattern of SPINNING_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      if (restrictToStart && match.index !== 0) continue;
      if (pattern === STRUCTURAL_SPINNING && match.index !== 0) continue;

      const rawSize = match[1];
      const rawSpeed = match[2];
      if (rawSize === undefined || rawSpeed === undefined) continue;

      const size = spinningSize(rawSize);
      const speed = spinningSpeed(rawSpeed);
      const range = { start: match.index, end: match.index + match[0].length };
      if (size !== null) sizes.push({ value: size, range });
      if (speed !== null) speeds.push({ value: speed, range });
      ranges.push(range);
    }
  }

  if (sizeLabel !== null) {
    const value = spinningSize(sizeLabel.value);
    if (value !== null) sizes.push({ value, range: sizeLabel.range });
  }

  if (speedLabel !== null) {
    const value = spinningSpeed(speedLabel.value);
    if (value !== null) speeds.push({ value, range: speedLabel.range });
  }

  const sizeValues = new Set(sizes.map((match) => match.value));
  const speedValues = new Set(speeds.map((match) => match.value));
  return {
    size: {
      value: sizeValues.size === 1 ? (sizes[0]?.value ?? null) : null,
      ranges: sizes.map((match) => match.range),
      ambiguous: sizeValues.size > 1,
    },
    speed: {
      value: speedValues.size === 1 ? (speeds[0]?.value ?? null) : null,
      ranges: speeds.map((match) => match.range),
      ambiguous: speedValues.size > 1,
    },
    ranges,
  };
}

function observationSentenceBoundary(value: string): number | null {
  const uppercaseBoundary = /\.(?=\s*\p{Lu})/u.exec(value)?.index;
  const knownLowercaseBoundary =
    /\.(?=\s*(?:\u043d\u043e\u0447(?:\u044c|\u044c\u044e)|\u0443\u0442\u0440(?:\u043e|\u043e\u043c)|\u0432\u0435\u0447\u0435\u0440(?:\u043e\u043c)?|\u0440\u0435\u043a\u043e\u0440\u0434|\u043f\u043e\u0439\u043c\u0430\u043b|\u043b\u043e\u0432\u0438\u043b|\u0441\u043f\u043e\u0439\u043b\u0435\u0440)(?![\p{L}\p{N}]))/iu.exec(
      value,
    )?.index;
  const boundaries = [uppercaseBoundary, knownLowercaseBoundary].filter(
    (index): index is number => index !== undefined,
  );
  return boundaries.length === 0 ? null : Math.min(...boundaries);
}

function stopAtSentenceBoundary(value: string): string {
  const boundary = observationSentenceBoundary(value);
  return boundary === null ? value : value.slice(0, boundary);
}

function timeRangesAfterDepth(source: string, depthRange: RelativeRange | null): RelativeRange[] {
  if (depthRange === null) return [];

  const tail = source.slice(depthRange.end);
  const lineBreak = /\r\n|[\n\r]/u.exec(tail);
  const sentenceBoundary = observationSentenceBoundary(tail);
  const limits = [lineBreak?.index, sentenceBoundary]
    .filter((value): value is number => value !== undefined && value !== null)
    .map((value) => depthRange.end + value);
  const limit = limits.length === 0 ? source.length : Math.min(...limits);

  return regexRanges(source, OBSERVATION_TIME).filter(
    (range) => range.start >= depthRange.end && range.end <= limit,
  );
}

function spotAfterDepth(
  source: string,
  depthRange: RelativeRange | null,
  semanticRanges: readonly RelativeRange[],
): string | null {
  if (depthRange === null) return null;

  const nextSemantic = semanticRanges
    .filter((range) => range.start >= depthRange.end)
    .sort((left, right) => left.start - right.start)[0];
  let end = nextSemantic?.start ?? source.length;
  const lineBreak = /\r\n|[\n\r]/u.exec(source.slice(depthRange.end, end));
  if (lineBreak !== null) end = depthRange.end + lineBreak.index;

  const raw = stopAtSentenceBoundary(source.slice(depthRange.end, end)).replace(
    /^[.\p{White_Space},;:\u2013\u2014-]+/u,
    '',
  );
  return trimStructuralValue(
    raw.replace(/[.\p{White_Space}([{,;:]+$/u, '').replace(/\s+(?:\u0432|\u043f\u043e)$/iu, ''),
  );
}

function validSpot(value: string | null, issues: ForumCandidateIssue[]): string | null {
  if (value === null) return null;
  if (
    SPOT_POSITION_RAW_MAX_LENGTH_PATTERN.test(value) &&
    VALID_SPOT_POSITION_RAW_PATTERN.test(value)
  ) {
    return value;
  }

  issues.push({ code: 'INVALID_SPOT_POSITION_RAW', field: 'spotPositionRaw' });
  return null;
}

function validUserNote(value: string | null, issues: ForumCandidateIssue[]): string | null {
  if (value === null) return null;
  if (USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(value) && VALID_USER_NOTE_RAW_PATTERN.test(value)) {
    return value;
  }

  issues.push({ code: 'INVALID_USER_NOTE_RAW', field: 'userNoteRaw' });
  return null;
}

function uniqueIssues(issues: readonly ForumCandidateIssue[]): ForumCandidateIssue[] {
  const byIdentity = new Map<string, ForumCandidateIssue>();

  for (const issue of issues) {
    byIdentity.set(`${issue.code}\0${issue.field ?? ''}`, issue);
  }

  return [...byIdentity.values()].sort((left, right) => {
    const leftKey = `${left.code}\0${left.field ?? ''}`;
    const rightKey = `${right.code}\0${right.field ?? ''}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function parseCandidate(
  post: TechnicalForumPost,
  segment: CandidateSegment,
  candidateOrdinal: number,
  contributorKey: string | null,
): ParsedForumCandidate {
  const sourceText = post.bodyText.slice(segment.start, segment.end);
  const issues: ForumCandidateIssue[] = [];
  if (contributorKey === null) {
    issues.push({ code: 'MISSING_EXTERNAL_MEMBER_ID', field: 'contributorKey' });
  }

  const labels = parseLabels(sourceText);
  const topicFishRaw = topicFishNameRaw(post.topicTitle);
  const generated = parseGeneratedFields(sourceText, topicFishRaw);
  if (generated.ambiguousCore) {
    issues.push({ code: 'AMBIGUOUS_WEIGHT', field: 'weightGrams' });
  }
  const fishLabel = selectLabelValue(labels, 'fish', 'fishNameRaw', issues);
  const weightLabel = selectLabelValue(labels, 'weight', 'weightGrams', issues);
  const baseLabel = selectLabelValue(labels, 'base', 'fishingBaseRaw', issues);
  const locationLabel = selectLabelValue(labels, 'location', 'locationRaw', issues);
  const baitLabel = selectLabelValue(labels, 'bait', 'baitRaw', issues);
  const depthLabel = selectLabelValue(labels, 'depth', 'holeDepthCm', issues);
  const spotLabel = selectLabelValue(labels, 'spot', 'spotPositionRaw', issues);
  const fishingNoteLabel = selectLabelValue(labels, 'fishingNote', 'fishingNote', issues);
  const spinningLabel = selectLabelValue(labels, 'spinning', 'spinningSize', issues);
  const spinningSizeLabel = selectLabelValue(labels, 'spinningSize', 'spinningSize', issues);
  const spinningSpeedLabel = selectLabelValue(labels, 'spinningSpeed', 'spinningSpeed', issues);
  const userNoteLabel = selectLabelValue(labels, 'userNote', 'userNoteRaw', issues);

  const generatedCatchInsideFishLabel =
    fishLabel !== null &&
    generated.fishNameRaw !== null &&
    /\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430/iu.test(
      fishLabel.value,
    );
  const fishNameRaw = generatedCatchInsideFishLabel
    ? generated.fishNameRaw
    : (fishLabel?.value ?? generated.fishNameRaw ?? topicFishRaw);
  const weightGrams = parseWeight(weightLabel?.value ?? generated.weightRaw, issues);
  const fishingBaseRaw = baseLabel?.value ?? generated.fishingBaseRaw;
  const locationRaw = locationLabel?.value ?? generated.locationRaw;
  const baitRaw = baitLabel?.value ?? generated.baitRaw;

  const explicitObservation: TextSource | null =
    depthLabel !== null
      ? { text: depthLabel.value, offset: depthLabel.range.start }
      : generated.observation;
  const matchingCoreContext =
    generated.contextBeforeCore !== null &&
    locationRaw !== null &&
    (() => {
      const contextDepth = parseDepth(generated.contextBeforeCore.text);
      return (
        contextDepth.value !== null &&
        contextDepth.issues.length === 0 &&
        contextDepth.range !== null &&
        containsExactContextText(
          generated.contextBeforeCore.text.slice(0, contextDepth.range.start),
          locationRaw,
        )
      );
    })()
      ? generated.contextBeforeCore
      : null;
  const depthSource = explicitObservation ?? matchingCoreContext ?? { text: '', offset: 0 };
  const semanticObservation = explicitObservation ?? { text: '', offset: 0 };
  const parsedDepth = parseDepth(depthSource.text, explicitObservation !== null);
  issues.push(...parsedDepth.issues);

  const fishingNoteSource =
    fishingNoteLabel === null
      ? semanticObservation
      : { text: fishingNoteLabel.value, offset: fishingNoteLabel.range.start };
  const parsedFishingNote = parseFishingNote(fishingNoteSource.text);
  if (parsedFishingNote.ambiguous) {
    issues.push({ code: 'AMBIGUOUS_FISHING_NOTE', field: 'fishingNote' });
  }

  const spinningSource =
    spinningLabel === null
      ? semanticObservation
      : { text: spinningLabel.value, offset: spinningLabel.range.start };
  const parsedSpinning = parseSpinning(
    spinningSource.text,
    spinningSizeLabel,
    spinningSpeedLabel,
    spinningSource.restrictSpinningToStart === true,
  );
  if (parsedSpinning.size.ambiguous) {
    issues.push({ code: 'AMBIGUOUS_SPINNING_SIZE', field: 'spinningSize' });
  }
  if (parsedSpinning.speed.ambiguous) {
    issues.push({ code: 'AMBIGUOUS_SPINNING_SPEED', field: 'spinningSpeed' });
  }

  const contextualTimes = timeRangesAfterDepth(depthSource.text, parsedDepth.range).map(
    (range) => ({
      start: depthSource.offset + range.start,
      end: depthSource.offset + range.end,
    }),
  );
  const supplements = uniqueRanges([...supplementaryRanges(sourceText), ...contextualTimes]);
  const noteSources: Array<{ value: string; range: RelativeRange }> = [];

  if (userNoteLabel !== null) {
    noteSources.push({ value: userNoteLabel.value, range: userNoteLabel.range });
  }

  for (const range of supplements) {
    if (noteSources.some((source) => rangesOverlap(source.range, range))) continue;
    noteSources.push({ value: sourceText.slice(range.start, range.end), range });
  }
  noteSources.sort(
    (left, right) => left.range.start - right.range.start || left.range.end - right.range.end,
  );

  const noteStart = noteSources[0]?.range.start;
  const noteEnd = noteSources.at(-1)?.range.end;
  const userNoteSpan =
    noteStart === undefined || noteEnd === undefined ? null : sourceText.slice(noteStart, noteEnd);
  const spanOnlyHasSeparators =
    noteSources.length <= 1 ||
    noteSources.slice(0, -1).every((noteSource, index) => {
      const next = noteSources[index + 1];
      return (
        next !== undefined &&
        /^[\p{White_Space};,]*$/u.test(sourceText.slice(noteSource.range.end, next.range.start))
      );
    });
  const userNoteRaw = validUserNote(
    spanOnlyHasSeparators &&
      userNoteSpan !== null &&
      VALID_USER_NOTE_RAW_PATTERN.test(userNoteSpan) &&
      USER_NOTE_RAW_MAX_LENGTH_PATTERN.test(userNoteSpan)
      ? userNoteSpan
      : noteSources.map((source) => source.value.replace(/\r\n|[\n\r]/gu, '; ')).join('; ') || null,
    issues,
  );

  const semanticObservationRanges = [
    ...parsedFishingNote.ranges.map((range) => ({
      start: fishingNoteSource.offset - semanticObservation.offset + range.start,
      end: fishingNoteSource.offset - semanticObservation.offset + range.end,
    })),
    ...parsedSpinning.ranges.map((range) => ({
      start: spinningSource.offset - semanticObservation.offset + range.start,
      end: spinningSource.offset - semanticObservation.offset + range.end,
    })),
    ...supplements
      .filter(
        (range) =>
          range.start >= semanticObservation.offset &&
          range.end <= semanticObservation.offset + semanticObservation.text.length,
      )
      .map((range) => ({
        start: range.start - semanticObservation.offset,
        end: range.end - semanticObservation.offset,
      })),
    ...observationMetadataRanges(semanticObservation.text),
    ...nonPositionalObservationRanges(semanticObservation.text),
  ].filter((range) => range.start >= 0 && range.end <= semanticObservation.text.length);

  const derivedSpot =
    explicitObservation === null
      ? null
      : spotAfterDepth(semanticObservation.text, parsedDepth.range, semanticObservationRanges);
  const spotPositionRaw = validSpot(spotLabel?.value ?? derivedSpot, issues);

  return {
    contributorKey,
    importKey: deriveExternalImportKey(post.postId, candidateOrdinal),
    candidateOrdinal,
    fishNameRaw,
    weightGrams,
    fishingBaseRaw,
    locationRaw,
    baitRaw,
    fishingMethod: null,
    holeDepthCm: parsedDepth.value,
    spotPositionRaw,
    fishingNote: parsedFishingNote.value,
    spinningSize: parsedSpinning.size.value,
    spinningSpeed: parsedSpinning.speed.value,
    userNoteRaw,
    issues: uniqueIssues(issues),
    technical: {
      subforumId: post.subforumId,
      topicId: post.topicId,
      postId: post.postId,
      sourceRange: candidateSourceRange(post.bodyText, segment),
      sourceText,
      supplementarySourceRanges: supplements.map((range) =>
        candidateSourceRange(post.bodyText, {
          start: segment.start + range.start,
          end: segment.start + range.end,
        }),
      ),
    },
  };
}

function normalizeContextText(source: string): string {
  return source.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function containsExactContextText(source: string, expected: string): boolean {
  const normalizedSource = normalizeContextText(source);
  const normalizedExpected = normalizeContextText(expected);
  if (normalizedExpected.length === 0) return false;

  return new RegExp(
    String.raw`(?:^|[^\p{L}\p{N}])${escapeRegExp(normalizedExpected)}(?:$|[^\p{L}\p{N}])`,
    'u',
  ).test(normalizedSource);
}

function isExactGeneratedContextLine(
  source: string,
  topicFishRaw: string,
  locationRaw: string,
): boolean {
  const generated = parseGeneratedFields(source.trim(), topicFishRaw);
  return (
    !generated.ambiguousCore &&
    generated.contextBeforeCore === null &&
    generated.fishNameRaw !== null &&
    normalizeContextText(generated.fishNameRaw) === normalizeContextText(topicFishRaw) &&
    generated.weightRaw !== null &&
    generated.fishingBaseRaw !== null &&
    generated.locationRaw !== null &&
    normalizeContextText(generated.locationRaw) === normalizeContextText(locationRaw) &&
    generated.baitRaw !== null
  );
}

function sharedHeaderDepth(
  post: TechnicalForumPost,
  candidate: ParsedForumCandidate,
  topicFishRaw: string | null,
): number | null {
  if (
    topicFishRaw === null ||
    candidate.locationRaw === null ||
    candidate.holeDepthCm !== null ||
    candidate.issues.some((issue) => issue.field === 'holeDepthCm')
  ) {
    return null;
  }

  const lines = post.bodyText.split(/\r\n|[\n\r]/u);
  const candidateLine = candidate.technical.sourceRange.startLine - 1;

  for (let headerLine = candidateLine - 1; headerLine >= 0; headerLine -= 1) {
    const rawHeader = lines[headerLine];
    if (rawHeader === undefined || rawHeader.trim().length === 0) return null;
    if (!/:\s*$/u.test(rawHeader) || !/\u044f\u043c/iu.test(rawHeader)) continue;

    const parsedHeader = parseDepth(rawHeader);
    if (
      parsedHeader.value === null ||
      parsedHeader.issues.length > 0 ||
      !containsExactContextText(rawHeader, candidate.locationRaw)
    ) {
      return null;
    }

    for (let line = headerLine + 1; line < candidateLine; line += 1) {
      const intervening = lines[line];
      if (
        intervening === undefined ||
        intervening.trim().length === 0 ||
        !isExactGeneratedContextLine(intervening, topicFishRaw, candidate.locationRaw)
      ) {
        return null;
      }
    }

    return parsedHeader.value;
  }

  return null;
}

function applySharedHeaderDepths(
  post: TechnicalForumPost,
  candidates: readonly ParsedForumCandidate[],
): ParsedForumCandidate[] {
  const topicFishRaw = topicFishNameRaw(post.topicTitle);
  return candidates.map((candidate) => {
    const inherited = sharedHeaderDepth(post, candidate, topicFishRaw);
    return inherited === null ? candidate : { ...candidate, holeDepthCm: inherited };
  });
}

function paragraphForCandidate(
  bodyText: string,
  candidate: ParsedForumCandidate,
): RelativeRange | null {
  return (
    paragraphRanges(bodyText).find(
      (paragraph) =>
        candidate.technical.sourceRange.startOffset >= paragraph.start &&
        candidate.technical.sourceRange.endOffset <= paragraph.end,
    ) ?? null
  );
}

function hasCompleteSharedCatchContext(candidate: ParsedForumCandidate): boolean {
  return (
    candidate.fishingBaseRaw !== null &&
    candidate.locationRaw !== null &&
    candidate.baitRaw !== null &&
    candidate.holeDepthCm !== null
  );
}

function applyExplicitSameHoleAndBaitContext(
  post: TechnicalForumPost,
  candidates: readonly ParsedForumCandidate[],
): ParsedForumCandidate[] {
  const inheritedByOrdinal = new Map<number, ParsedForumCandidate>();

  for (const paragraph of paragraphRanges(post.bodyText)) {
    const paragraphText = post.bodyText.slice(paragraph.start, paragraph.end);
    const linker =
      /(?<![\p{L}\p{N}])\u044f\u043c\u043a\u0430\s+\u0438\s+\u043d\u0430\u0436\u0438\u0432\u043a\u0430\s+\u0442\u0435\s+\u0436\u0435(?![\p{L}\p{N}])/iu.exec(
        paragraphText,
      );
    if (linker === null) continue;

    const linkerStart = paragraph.start + linker.index;
    const paragraphCandidates = candidates.filter(
      (candidate) =>
        paragraphForCandidate(post.bodyText, candidate)?.start === paragraph.start &&
        candidate.technical.sourceRange.startOffset < linkerStart,
    );
    const anchors = paragraphCandidates.filter(hasCompleteSharedCatchContext);
    if (anchors.length !== 1) continue;

    const anchor = anchors[0];
    if (anchor === undefined) continue;
    const followers = paragraphCandidates.filter(
      (candidate) =>
        candidate.technical.sourceRange.startOffset > anchor.technical.sourceRange.startOffset,
    );
    if (
      followers.length === 0 ||
      followers.some(
        (candidate) =>
          candidate.weightGrams === null ||
          candidate.fishingBaseRaw !== null ||
          candidate.locationRaw !== null ||
          candidate.baitRaw !== null ||
          candidate.holeDepthCm !== null,
      )
    ) {
      continue;
    }

    for (const follower of followers) {
      inheritedByOrdinal.set(follower.candidateOrdinal, {
        ...follower,
        fishingBaseRaw: anchor.fishingBaseRaw,
        locationRaw: anchor.locationRaw,
        baitRaw: anchor.baitRaw,
        holeDepthCm: anchor.holeDepthCm,
        spotPositionRaw: anchor.spotPositionRaw,
      });
    }
  }

  return candidates.map(
    (candidate) => inheritedByOrdinal.get(candidate.candidateOrdinal) ?? candidate,
  );
}

export function parseForumPost(input: TechnicalForumPost): ParsedForumCandidate[] {
  const post: TechnicalForumPost = {
    ...input,
    subforumId: canonicalizeExternalNumericId(input.subforumId),
    topicId: canonicalizeExternalNumericId(input.topicId),
    postId: canonicalizeExternalNumericId(input.postId),
    memberId: input.memberId === null ? null : canonicalizeExternalNumericId(input.memberId),
  };
  const contributorKey =
    post.memberId === null ? null : deriveExternalContributorKey(post.memberId);

  const topicFishRaw = topicFishNameRaw(post.topicTitle);
  const candidates = segmentCandidates(post.bodyText, topicFishRaw).map((segment, index) =>
    parseCandidate(post, segment, index + 1, contributorKey),
  );
  return applyExplicitSameHoleAndBaitContext(post, applySharedHeaderDepths(post, candidates));
}
