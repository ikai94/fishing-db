import { normalizeCatalogName } from '../../catalog/catalog-normalization.js';
import type {
  CatchReportFishingMethod,
  CatchReportFishingNote,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../catch-reports.constants.js';
import type { SourceRange } from './catch-report-parser.types.js';
import { trimSourceRange } from './game-line-parser.js';
import { parseHoleDepthCm } from './numeric-parsers.js';
import { SCREEN_ANCHOR_ALIASES } from './screen-anchor-aliases.js';

interface ParsedValue<T> {
  value: T;
  source: SourceRange;
}

export interface ObservationAnchor {
  name: string;
  nameNormalized: string;
}

export interface ParsedObservation {
  holeDepthCm: ParsedValue<number> | null;
  spotPositionRaw: ParsedValue<string> | null;
  fishingNote: ParsedValue<CatchReportFishingNote> | null;
  spinningSize: ParsedValue<CatchReportSpinningSize> | null;
  spinningSpeed: ParsedValue<CatchReportSpinningSpeed> | null;
  userNoteRaw: ParsedValue<string> | null;
  unresolvedFragments: SourceRange[];
}

interface RelativeInterval {
  start: number;
  end: number;
}

const SIZE_ALIASES: ReadonlyArray<readonly [string, CatchReportSpinningSize]> = [
  ['маленькая', 'SMALL'],
  ['маленький', 'SMALL'],
  ['мал.', 'SMALL'],
  ['мал', 'SMALL'],
  ['м', 'SMALL'],
  ['средняя', 'MEDIUM'],
  ['средний', 'MEDIUM'],
  ['сред', 'MEDIUM'],
  ['ср.', 'MEDIUM'],
  ['ср', 'MEDIUM'],
  ['большая', 'LARGE'],
  ['большой', 'LARGE'],
  ['бол.', 'LARGE'],
  ['бол', 'LARGE'],
  ['б', 'LARGE'],
];

const SPEED_ALIASES: ReadonlyArray<readonly [string, CatchReportSpinningSpeed]> = [
  ['медленная', 'SLOW'],
  ['медленно', 'SLOW'],
  ['медл.', 'SLOW'],
  ['медл', 'SLOW'],
  ['м', 'SLOW'],
  ['средняя', 'MEDIUM'],
  ['средне', 'MEDIUM'],
  ['сред', 'MEDIUM'],
  ['ср.', 'MEDIUM'],
  ['ср', 'MEDIUM'],
  ['быстрая', 'FAST'],
  ['быстро', 'FAST'],
  ['быстр.', 'FAST'],
  ['быстр', 'FAST'],
  ['б', 'FAST'],
];

const FISHING_NOTES: ReadonlyArray<readonly [RegExp, CatchReportFishingNote]> = [
  [/(?<![\p{L}\p{N}])вполводы(?![\p{L}\p{N}])/iu, 'MIDWATER'],
  [/(?<![\p{L}\p{N}])со\s+дна(?![\p{L}\p{N}])/iu, 'FROM_BOTTOM'],
  [/(?<![\p{L}\p{N}])поверху(?![\p{L}\p{N}])/iu, 'SURFACE'],
];

const DEPTH_TOKEN =
  /(?<![\p{L}\p{N},+-])(?<!\d\.)(?:ям(?:а|ка)\s*)?(\d+(?:[,.]\d{1,2})?)(?![\d,.+-]|[\p{L}\p{N}])/iu;
const HARD_FRAGMENT_SEPARATOR = /[.;]+/gu;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function aliasPattern<T extends string>(aliases: ReadonlyArray<readonly [string, T]>): string {
  return aliases.map(([alias]) => escapeRegex(alias)).join('|');
}

const SIZE_PATTERN = aliasPattern(SIZE_ALIASES);
const SPEED_PATTERN = aliasPattern(SPEED_ALIASES);
const COMPACT_SPINNING = new RegExp(
  `^(${SIZE_PATTERN})\\s*[/\\\\]\\s*(${SPEED_PATTERN})(?=$|[\\s.,;:!?])`,
  'iu',
);
const TEXT_SPINNING = new RegExp(
  `^(${SIZE_PATTERN})(?:\\s*,?\\s+|\\s*,\\s*)(?:проводка\\s+)?(${SPEED_PATTERN})(?=$|[\\s.,;:!?])`,
  'iu',
);

function aliasValue<T extends string>(
  source: string,
  aliases: ReadonlyArray<readonly [string, T]>,
): T | null {
  const normalized = source.toLowerCase();
  return aliases.find(([alias]) => alias === normalized)?.[1] ?? null;
}

function parsedRange<T>(
  rawSourceText: string,
  sourceStart: number,
  relativeStart: number,
  text: string,
  value: T,
): ParsedValue<T> {
  const start = sourceStart + relativeStart;
  return {
    value,
    source: { text, start, end: start + text.length },
  };
}

function firstMeaningfulIndex(value: string): number {
  const match = /[^\s.,;:!?]/u.exec(value);
  return match?.index ?? value.length;
}

function parseSpinning(
  rawSourceText: string,
  source: SourceRange,
): {
  size: ParsedValue<CatchReportSpinningSize>;
  speed: ParsedValue<CatchReportSpinningSpeed>;
  consumed: RelativeInterval;
} | null {
  const relativeSource = rawSourceText.slice(source.start, source.end);
  const prefixLength = firstMeaningfulIndex(relativeSource);
  const meaningful = relativeSource.slice(prefixLength);
  const match = COMPACT_SPINNING.exec(meaningful) ?? TEXT_SPINNING.exec(meaningful);

  if (match === null || match[1] === undefined || match[2] === undefined) {
    return null;
  }

  const size = aliasValue(match[1], SIZE_ALIASES);
  const speed = aliasValue(match[2], SPEED_ALIASES);

  if (size === null || speed === null) {
    return null;
  }

  const sizeStart = prefixLength + (match[0].indexOf(match[1]) || 0);
  const speedStart = prefixLength + match[0].lastIndexOf(match[2]);

  return {
    size: parsedRange(rawSourceText, source.start, sizeStart, match[1], size),
    speed: parsedRange(rawSourceText, source.start, speedStart, match[2], speed),
    consumed: { start: prefixLength, end: prefixLength + match[0].length },
  };
}

function trimFragment(rawSourceText: string, start: number, end: number): SourceRange | null {
  const untrimmed = rawSourceText.slice(start, end);
  const withoutLeading = untrimmed.replace(/^[\s.,;:!?]+/u, '');
  const leadingLength = untrimmed.length - withoutLeading.length;
  const withoutEdges = withoutLeading.replace(/[\s.,;:!?]+$/u, '');

  if (withoutEdges.length === 0) {
    return null;
  }

  const fragmentStart = start + leadingLength;
  return {
    text: withoutEdges,
    start: fragmentStart,
    end: fragmentStart + withoutEdges.length,
  };
}

function splitFragments(rawSourceText: string, start: number, end: number): SourceRange[] {
  const fragments: SourceRange[] = [];
  const relative = rawSourceText.slice(start, end);
  let cursor = 0;

  HARD_FRAGMENT_SEPARATOR.lastIndex = 0;

  for (const match of relative.matchAll(HARD_FRAGMENT_SEPARATOR)) {
    const separatorIndex = match.index;
    const fragment = trimFragment(rawSourceText, start + cursor, start + separatorIndex);

    if (fragment !== null) {
      fragments.push(fragment);
    }

    cursor = separatorIndex + match[0].length;
  }

  const finalFragment = trimFragment(rawSourceText, start + cursor, end);

  if (finalFragment !== null) {
    fragments.push(finalFragment);
  }

  return fragments;
}

function subtractIntervals(
  rawSourceText: string,
  source: SourceRange,
  intervals: readonly RelativeInterval[],
): SourceRange[] {
  const sorted = [...intervals]
    .filter((interval) => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const fragments: SourceRange[] = [];
  let cursor = 0;

  for (const interval of sorted) {
    if (interval.start > cursor) {
      fragments.push(
        ...splitFragments(rawSourceText, source.start + cursor, source.start + interval.start),
      );
    }

    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < source.end - source.start) {
    fragments.push(...splitFragments(rawSourceText, source.start + cursor, source.end));
  }

  return fragments;
}

function normalizedTokens(source: string): string[] {
  try {
    return normalizeCatalogName(source)
      .nameNormalized.split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function containsAnchor(source: string, anchors: readonly ObservationAnchor[]): boolean {
  const sourceTokens = normalizedTokens(source);
  const activeNames = new Set(anchors.map((anchor) => anchor.nameNormalized));
  const recognized = new Set<string>();

  for (const anchor of anchors) {
    for (const token of normalizedTokens(anchor.nameNormalized)) {
      recognized.add(token);
    }
  }

  for (const [alias, canonical] of Object.entries(SCREEN_ANCHOR_ALIASES)) {
    if (activeNames.has(canonical)) {
      recognized.add(alias);
    }
  }

  return sourceTokens.some((token) => recognized.has(token));
}

function findLineComment(
  rawSourceText: string,
  source: SourceRange,
): { comment: SourceRange; observationEnd: number } | null {
  const relative = rawSourceText.slice(source.start, source.end);
  const lineBreak = /\r\n|[\n\r]/u.exec(relative);

  if (lineBreak === null || lineBreak.index === undefined) {
    return null;
  }

  const comment = trimSourceRange(
    rawSourceText,
    source.start + lineBreak.index + lineBreak[0].length,
    source.end,
  );
  return comment.text.length === 0
    ? null
    : { comment, observationEnd: source.start + lineBreak.index };
}

function sameLineSpinningComment(
  rawSourceText: string,
  source: SourceRange,
  spinningEnd: number,
): SourceRange | null {
  const afterSpinning = rawSourceText.slice(source.start + spinningEnd, source.end);
  const boundary = /^\s*\.\s+(?=\p{Lu})/u.exec(afterSpinning);

  if (boundary === null) {
    return null;
  }

  const comment = trimSourceRange(
    rawSourceText,
    source.start + spinningEnd + boundary[0].length,
    source.end,
  );
  return comment.text.length === 0 ? null : comment;
}

export function parseObservation(
  rawSourceText: string,
  source: SourceRange,
  fishingMethod: CatchReportFishingMethod | null,
  anchors: readonly ObservationAnchor[],
): ParsedObservation {
  const lineComment = fishingMethod === 'SPINNING' ? findLineComment(rawSourceText, source) : null;
  let parseEnd = lineComment?.observationEnd ?? source.end;
  let observationSource = trimSourceRange(rawSourceText, source.start, parseEnd);
  const consumed: RelativeInterval[] = [];
  let spinningSize: ParsedValue<CatchReportSpinningSize> | null = null;
  let spinningSpeed: ParsedValue<CatchReportSpinningSpeed> | null = null;
  let spinning: ReturnType<typeof parseSpinning> = null;
  let userNoteRaw: SourceRange | null = null;

  if (fishingMethod === 'SPINNING') {
    spinning = parseSpinning(rawSourceText, observationSource);

    if (spinning === null && lineComment !== null) {
      parseEnd = source.end;
      observationSource = trimSourceRange(rawSourceText, source.start, parseEnd);
      spinning = parseSpinning(rawSourceText, observationSource);
    } else if (spinning !== null && lineComment !== null) {
      userNoteRaw = lineComment.comment;
    }

    if (spinning !== null) {
      spinningSize = spinning.size;
      spinningSpeed = spinning.speed;
      consumed.push(spinning.consumed);

      if (userNoteRaw === null) {
        userNoteRaw = sameLineSpinningComment(
          rawSourceText,
          observationSource,
          spinning.consumed.end,
        );

        if (userNoteRaw !== null) {
          parseEnd = userNoteRaw.start;
        }
      }
    }
  }

  const effectiveEnd = Math.min(parseEnd, observationSource.end);
  const effectiveSource: SourceRange = {
    text: rawSourceText.slice(observationSource.start, effectiveEnd),
    start: observationSource.start,
    end: effectiveEnd,
  };
  const effectiveRelative = rawSourceText.slice(effectiveSource.start, effectiveSource.end);
  let holeDepthCm: ParsedValue<number> | null = null;
  const depthMatch = DEPTH_TOKEN.exec(effectiveRelative);

  if (depthMatch !== null && depthMatch.index !== undefined && depthMatch[1] !== undefined) {
    const value = parseHoleDepthCm(depthMatch[1]);

    if (value !== null) {
      const numberStart = depthMatch.index + depthMatch[0].lastIndexOf(depthMatch[1]);
      holeDepthCm = parsedRange(
        rawSourceText,
        effectiveSource.start,
        numberStart,
        depthMatch[1],
        value,
      );
      consumed.push({ start: depthMatch.index, end: depthMatch.index + depthMatch[0].length });
    }
  }

  let fishingNote: ParsedValue<CatchReportFishingNote> | null = null;

  for (const [pattern, value] of FISHING_NOTES) {
    const match = pattern.exec(effectiveRelative);

    if (match !== null && match.index !== undefined) {
      fishingNote = parsedRange(rawSourceText, effectiveSource.start, match.index, match[0], value);
      consumed.push({ start: match.index, end: match.index + match[0].length });
      break;
    }
  }

  const fragments = subtractIntervals(rawSourceText, effectiveSource, consumed);
  const positionIndex = fragments.findIndex((fragment) => containsAnchor(fragment.text, anchors));
  const positionFragment = positionIndex < 0 ? undefined : fragments[positionIndex];
  const spotPositionRaw =
    positionFragment === undefined
      ? null
      : { value: positionFragment.text, source: positionFragment };
  const unresolvedFragments = fragments.filter((_fragment, index) => index !== positionIndex);

  return {
    holeDepthCm,
    spotPositionRaw,
    fishingNote,
    spinningSize,
    spinningSpeed,
    userNoteRaw: userNoteRaw === null ? null : { value: userNoteRaw.text, source: userNoteRaw },
    unresolvedFragments,
  };
}
