import {
  buildCatalogLookupIndex,
  type CatalogLookupItem,
  type CatalogLookupResolution,
  resolveCatalogLookup,
} from '../../catalog/catalog-lookup.js';
import { parseWeightGrams } from './numeric-parsers.js';
import type { SourceRange } from './catch-report-parser.types.js';

const WEIGHT_TOKEN =
  /(?<![\p{L}\p{N},+-])(?<!\d\.)\d+(?:[,.]\d{1,3})?\s*(?:кг|грамм(?:а|ов)?|гр\.?|г)(?![\p{L}\p{N}])/giu;
const CAUGHT_AT = /(?<![\p{L}\p{N}])пойман(?:а|о)?\s+на\s+/giu;
const SAFE_SUFFIX_BOUNDARY = /^[\s.,;:!?/\\()[\]{}]$/u;
const STRUCTURAL_GAP = /^[\p{White_Space}\p{P}]*$/u;

export interface ParsedWeightToken {
  source: SourceRange;
  value: number | null;
}

export interface ParsedGameLine {
  hasGameCore: boolean;
  fishSource: SourceRange | null;
  weight: ParsedWeightToken | null;
  fishingBaseSource: SourceRange | null;
  locationAndBaitSource: SourceRange | null;
  observationSource: SourceRange;
  unresolvedFragments: SourceRange[];
}

export type CatalogPrefixCandidate = CatalogLookupItem;

export interface CatalogPrefixMatch<T extends CatalogPrefixCandidate> {
  resolution: CatalogLookupResolution<T>;
  source: SourceRange;
  remainder: SourceRange;
}

function isWhitespace(value: string): boolean {
  return /^\s$/u.test(value);
}

export function trimSourceRange(rawSourceText: string, start: number, end: number): SourceRange {
  const untrimmed = rawSourceText.slice(start, end);
  const leadingLength = untrimmed.length - untrimmed.replace(/^\s+/u, '').length;
  const afterLeading = untrimmed.slice(leadingLength);
  const trailingLength = afterLeading.length - afterLeading.replace(/\s+$/u, '').length;
  const trimmedStart = start + leadingLength;
  const trimmedEnd = end - trailingLength;

  return {
    text: rawSourceText.slice(trimmedStart, trimmedEnd),
    start: trimmedStart,
    end: trimmedEnd,
  };
}

function firstMatchAfter(pattern: RegExp, source: string, start: number): RegExpExecArray | null {
  pattern.lastIndex = start;
  return pattern.exec(source);
}

function emptyRangeAt(rawSourceText: string, index: number): SourceRange {
  return { text: rawSourceText.slice(index, index), start: index, end: index };
}

function meaningfulGap(rawSourceText: string, start: number, end: number): SourceRange[] {
  const source = trimSourceRange(rawSourceText, start, end);
  return STRUCTURAL_GAP.test(source.text) ? [] : [source];
}

export function parseGameLine(rawSourceText: string): ParsedGameLine {
  const wholeSource = trimSourceRange(rawSourceText, 0, rawSourceText.length);
  const weightMatch = firstMatchAfter(WEIGHT_TOKEN, rawSourceText, 0);

  if (weightMatch === null || weightMatch.index === undefined) {
    return {
      hasGameCore: false,
      fishSource: null,
      weight: null,
      fishingBaseSource: null,
      locationAndBaitSource: null,
      observationSource: wholeSource,
      unresolvedFragments: [],
    };
  }

  const fishSource = trimSourceRange(rawSourceText, 0, weightMatch.index);
  const weightSource = trimSourceRange(
    rawSourceText,
    weightMatch.index,
    weightMatch.index + weightMatch[0].length,
  );
  const caughtMatch = firstMatchAfter(CAUGHT_AT, rawSourceText, weightSource.end);

  if (fishSource.text.length === 0 || caughtMatch === null || caughtMatch.index === undefined) {
    return {
      hasGameCore: false,
      fishSource: fishSource.text.length === 0 ? null : fishSource,
      weight: { source: weightSource, value: parseWeightGrams(weightSource.text) },
      fishingBaseSource: null,
      locationAndBaitSource: null,
      observationSource: trimSourceRange(rawSourceText, weightSource.end, rawSourceText.length),
      unresolvedFragments: [],
    };
  }

  const baseStart = caughtMatch.index + caughtMatch[0].length;
  const colonIndex = rawSourceText.indexOf(':', baseStart);

  if (colonIndex < 0) {
    return {
      hasGameCore: false,
      fishSource,
      weight: { source: weightSource, value: parseWeightGrams(weightSource.text) },
      fishingBaseSource: null,
      locationAndBaitSource: null,
      observationSource: trimSourceRange(rawSourceText, weightSource.end, rawSourceText.length),
      unresolvedFragments: [],
    };
  }

  const fishingBaseSource = trimSourceRange(rawSourceText, baseStart, colonIndex);
  const locationAndBaitSource = trimSourceRange(
    rawSourceText,
    colonIndex + 1,
    rawSourceText.length,
  );

  return {
    hasGameCore: fishingBaseSource.text.length > 0,
    fishSource,
    weight: { source: weightSource, value: parseWeightGrams(weightSource.text) },
    fishingBaseSource: fishingBaseSource.text.length === 0 ? null : fishingBaseSource,
    locationAndBaitSource: locationAndBaitSource.text.length === 0 ? null : locationAndBaitSource,
    observationSource: emptyRangeAt(rawSourceText, rawSourceText.length),
    unresolvedFragments: meaningfulGap(rawSourceText, weightSource.end, caughtMatch.index),
  };
}

function isCodePointBoundary(source: string, index: number): boolean {
  if (index <= 0 || index >= source.length) {
    return true;
  }

  const previous = source.charCodeAt(index - 1);
  const current = source.charCodeAt(index);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function suffixBoundary(source: string, index: number): boolean {
  if (index >= source.length) {
    return true;
  }

  return SAFE_SUFFIX_BOUNDARY.test(source[index] ?? '');
}

function commaBoundary(source: string, index: number): boolean {
  let cursor = index;

  while (cursor < source.length && isWhitespace(source[cursor] ?? '')) {
    cursor += 1;
  }

  return source[cursor] === ',';
}

export function matchCatalogPrefix<T extends CatalogPrefixCandidate>(
  rawSourceText: string,
  range: SourceRange,
  candidates: readonly T[],
  expectedBoundary: 'COMMA' | 'SUFFIX',
): CatalogPrefixMatch<T> | null {
  const lookupIndex = buildCatalogLookupIndex(candidates);
  let best: CatalogPrefixMatch<T> | null = null;
  let codePoints = 0;

  for (let end = range.start + 1; end <= range.end && codePoints <= 128; end += 1) {
    if (!isCodePointBoundary(rawSourceText, end)) {
      continue;
    }

    codePoints += 1;
    const source = trimSourceRange(rawSourceText, range.start, end);

    if (source.text.length === 0) {
      continue;
    }

    const resolution = resolveCatalogLookup(lookupIndex, source.text);

    if (resolution.status === 'NOT_FOUND') {
      continue;
    }

    const boundaryMatches =
      expectedBoundary === 'COMMA'
        ? commaBoundary(rawSourceText, source.end)
        : suffixBoundary(rawSourceText, source.end);

    if (!boundaryMatches) {
      continue;
    }

    best = {
      resolution,
      source,
      remainder: trimSourceRange(rawSourceText, source.end, range.end),
    };
  }

  return best;
}

export function splitLocationAndBaitFallback(
  rawSourceText: string,
  source: SourceRange,
): { locationSource: SourceRange; baitAndSuffixSource: SourceRange | null } {
  const commaIndex = rawSourceText.indexOf(',', source.start);

  if (commaIndex < 0 || commaIndex >= source.end) {
    return { locationSource: source, baitAndSuffixSource: null };
  }

  const baitAndSuffixSource = trimSourceRange(rawSourceText, commaIndex + 1, source.end);

  return {
    locationSource: trimSourceRange(rawSourceText, source.start, commaIndex),
    baitAndSuffixSource: baitAndSuffixSource.text.length === 0 ? null : baitAndSuffixSource,
  };
}

export function sourceAfterComma(
  rawSourceText: string,
  source: SourceRange,
  end = rawSourceText.length,
): SourceRange {
  let cursor = source.end;

  while (cursor < rawSourceText.length && isWhitespace(rawSourceText[cursor] ?? '')) {
    cursor += 1;
  }

  if (rawSourceText[cursor] === ',') {
    cursor += 1;
  }

  return trimSourceRange(rawSourceText, cursor, end);
}

export function fallbackBaitSource(
  rawSourceText: string,
  source: SourceRange,
): { baitSource: SourceRange; observationSource: SourceRange } {
  const periodIndex = rawSourceText.indexOf('.', source.start);
  const separator = periodIndex >= 0 && periodIndex < source.end ? periodIndex : source.end;
  const baitSource = trimSourceRange(rawSourceText, source.start, separator);
  const observationStart = separator < source.end ? separator + 1 : separator;

  return {
    baitSource,
    observationSource: trimSourceRange(rawSourceText, observationStart, source.end),
  };
}
