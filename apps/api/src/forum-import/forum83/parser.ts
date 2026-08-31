import { normalizeCatalogName } from '../../catalog/catalog-normalization.js';
import type {
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../../catch-reports/catch-reports.constants.js';
import type {
  CandidateSourceRange,
  ParsedForumCandidate,
  TechnicalForumPost,
} from '../candidate-types.js';
import { canonicalizeExternalNumericId, deriveExternalContributorKey } from '../identity.js';
import { deriveForum83ImportKey } from './identity.js';
import {
  isProtectedReviewedBaitRaw,
  isReviewedEmbeddedBaseEquivalent,
} from './reviewed-decisions.js';

export interface Forum83ParserContext {
  baseName: string;
  locationNames: readonly string[];
  fishNames: readonly string[];
  baitNames: readonly string[];
}

export interface Forum83ParsedCandidate extends ParsedForumCandidate {
  forum83: {
    locationContext: 'EXPLICIT' | 'INHERITED';
    embeddedBaseRaw: string | null;
  };
}

const CAUGHT_MARKER =
  /\u043f\u043e\u0439\u043c\u0430\u043d(?:\u0430|\u043e|\u044b)?\s+\u043d\u0430\s+/giu;
const WEIGHT_AT_END =
  /(\d+(?:[,.]\d+)?)\s*(\u043a\u0433|\u0433\u0440\u0430\u043c\u043c(?:\u0430|\u043e\u0432)?|\u0433\u0440\.?|\u0433)\s*[.!?]?\s*$/iu;
const OBSERVATION_START =
  /\s*,\s*(?=(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438)|\u0432\u043f\u043e\u043b\u0432\u043e\u0434\u044b|\u0441\u043e\s+\u0434\u043d\u0430|\u043f\u043e\u0432\u0435\u0440\u0445\u0443)\b)/iu;
const DEPTH =
  /(?:\u0433\u043b\u0443\u0431\u0438\u043d\u0430|\u044f\u043c(?:\u0430|\u043a\u0430|\u043a\u0435|\u043a\u0438))\s*[:=-]?\s*(\d+(?:[,.]\d{1,2})?)\s*\u043c?/iu;

export function parseForum83Post(
  input: TechnicalForumPost,
  context: Forum83ParserContext,
): Forum83ParsedCandidate[] {
  const post: TechnicalForumPost = {
    ...input,
    subforumId: canonicalizeExternalNumericId(input.subforumId),
    topicId: canonicalizeExternalNumericId(input.topicId),
    postId: canonicalizeExternalNumericId(input.postId),
    memberId: input.memberId === null ? null : canonicalizeExternalNumericId(input.memberId),
  };
  const contributorKey =
    post.memberId === null ? null : deriveExternalContributorKey(post.memberId);
  const fishByNormalizedName = uniqueNormalizedNames(context.fishNames);
  const locationsByNormalizedName = uniqueNormalizedNames(context.locationNames);
  const baitsByNormalizedName = uniqueNormalizedNames(context.baitNames);
  const markers = Array.from(post.bodyText.matchAll(CAUGHT_MARKER));
  const candidates: Forum83ParsedCandidate[] = [];
  let previousMarkerEnd = 0;

  for (const marker of markers) {
    const markerIndex = marker.index;
    const markerEnd = markerIndex + marker[0].length;
    const prefixStart = previousMarkerEnd;
    const prefix = post.bodyText.slice(prefixStart, markerIndex);
    const weight = WEIGHT_AT_END.exec(prefix);
    previousMarkerEnd = markerEnd;
    if (weight === null || weight.index === undefined) continue;
    const fishPrefix = prefix.slice(0, weight.index);
    const fish = exactNamedSuffix(fishPrefix, fishByNormalizedName);
    if (fish === null) continue;
    const weightGrams = weightInGrams(weight[1] ?? '', weight[2] ?? '');
    if (weightGrams === null) continue;

    const after = candidateTail(post.bodyText, markerEnd);
    const parsedContext = parseCatchContext(
      after.text,
      context.baseName,
      inheritedLocation(post.bodyText, fish.start + prefixStart, locationsByNormalizedName),
      locationsByNormalizedName,
      baitsByNormalizedName,
    );
    if (parsedContext === null) continue;
    const issues: Forum83ParsedCandidate['issues'] = [];
    if (contributorKey === null) {
      issues.push({ code: 'MISSING_EXTERNAL_MEMBER_ID', field: 'contributorKey' });
    }
    if (
      parsedContext.embeddedBaseRaw !== null &&
      normalized(parsedContext.embeddedBaseRaw) !== normalized(context.baseName) &&
      !isReviewedEmbeddedBaseEquivalent(context.baseName, parsedContext.embeddedBaseRaw)
    ) {
      issues.push({ code: 'AMBIGUOUS_CANDIDATE_FIELD', field: 'fishingBaseRaw' });
    }
    const observation = parseObservation(parsedContext.observationRaw);
    const candidateStart = prefixStart + fish.start;
    const candidateEnd = markerEnd + after.end;
    const ordinal = candidates.length + 1;
    candidates.push({
      contributorKey,
      importKey: deriveForum83ImportKey(post.postId, ordinal),
      candidateOrdinal: ordinal,
      fishNameRaw: fish.rawName,
      weightGrams,
      fishingBaseRaw: context.baseName,
      locationRaw: parsedContext.locationRaw,
      baitRaw: parsedContext.baitRaw,
      fishingMethod: null,
      holeDepthCm: observation.holeDepthCm,
      spotPositionRaw: observation.spotPositionRaw,
      fishingNote: observation.fishingNote,
      spinningSize: observation.spinningSize,
      spinningSpeed: observation.spinningSpeed,
      userNoteRaw: observation.userNoteRaw,
      issues,
      technical: {
        subforumId: post.subforumId,
        topicId: post.topicId,
        postId: post.postId,
        sourceRange: sourceRange(post.bodyText, candidateStart, candidateEnd),
        sourceText: post.bodyText.slice(candidateStart, candidateEnd),
        supplementarySourceRanges: [],
      },
      forum83: {
        locationContext: parsedContext.locationContext,
        embeddedBaseRaw: parsedContext.embeddedBaseRaw,
      },
    });
  }
  return candidates;
}

function parseCatchContext(
  source: string,
  baseName: string,
  inherited: string | null,
  locations: Map<string, string>,
  baits: Map<string, string>,
): {
  embeddedBaseRaw: string | null;
  locationRaw: string;
  baitRaw: string | null;
  observationRaw: string | null;
  locationContext: 'EXPLICIT' | 'INHERITED';
} | null {
  const value = source.trim();
  const colon = value.indexOf(':');
  if (colon >= 0) {
    const embeddedBaseRaw = structural(value.slice(0, colon));
    const locationAndBait = value.slice(colon + 1);
    const comma = locationAndBait.indexOf(',');
    if (embeddedBaseRaw === null || comma < 0) return null;
    const sourceLocationRaw = structural(locationAndBait.slice(0, comma));
    if (sourceLocationRaw === null) return null;
    const locationRaw = boundedNumberedLocation(sourceLocationRaw, locations);
    const split = baitAndObservation(locationAndBait.slice(comma + 1), baits);
    return {
      embeddedBaseRaw,
      locationRaw,
      baitRaw: split.baitRaw,
      observationRaw: split.observationRaw,
      locationContext: 'EXPLICIT',
    };
  }
  if (inherited === null || normalized(baseName).length === 0) return null;
  const split = baitAndObservation(value, baits);
  return {
    embeddedBaseRaw: null,
    locationRaw: inherited,
    baitRaw: split.baitRaw,
    observationRaw: split.observationRaw,
    locationContext: 'INHERITED',
  };
}

function baitAndObservation(
  source: string,
  baits: Map<string, string>,
): {
  baitRaw: string | null;
  observationRaw: string | null;
} {
  const sentence = source.split(/\r?\n/u, 1)[0] ?? '';
  const withoutTrailing = sentence.replace(/[.!?]+\s*$/u, '').trim();
  const exactSplit = exactBaitWithObservation(withoutTrailing, baits);
  if (exactSplit !== null) return exactSplit;
  const boundedCleanup = boundedBaitCleanup(withoutTrailing, baits);
  if (boundedCleanup !== null) return boundedCleanup;
  const observation = OBSERVATION_START.exec(withoutTrailing);
  const baitEnd = observation?.index ?? withoutTrailing.length;
  return {
    baitRaw: structural(withoutTrailing.slice(0, baitEnd)),
    observationRaw:
      observation === null
        ? null
        : structural(withoutTrailing.slice(observation.index + observation[0].length)),
  };
}

function boundedBaitCleanup(
  source: string,
  baits: Map<string, string>,
): { baitRaw: string; observationRaw: string | null } | null {
  if (isProtectedReviewedBaitRaw(source)) return null;
  const numberedLocation = /^\d+\s+лока\s+(.+)$/iu.exec(source);
  if (numberedLocation?.[1] !== undefined) {
    const bait = baits.get(normalized(numberedLocation[1]));
    if (bait !== undefined) return { baitRaw: bait, observationRaw: null };
  }

  const matches: Array<{ baitRaw: string; observationRaw: string }> = [];
  for (let end = 1; end < source.length; end += 1) {
    const candidate = source.slice(0, end).trimEnd();
    if (candidate.length === 0) continue;
    const baitRaw = baits.get(normalized(candidate));
    if (baitRaw === undefined) continue;
    const observationRaw = source.slice(end);
    if (observationRaw.trim().length === 0) continue;
    matches.push({ baitRaw, observationRaw });
  }
  matches.sort((left, right) => right.baitRaw.length - left.baitRaw.length);
  const match = matches[0];
  return match === undefined
    ? null
    : { baitRaw: match.baitRaw, observationRaw: structural(match.observationRaw) };
}

function exactBaitWithObservation(
  source: string,
  baits: Map<string, string>,
): { baitRaw: string; observationRaw: string } | null {
  const matches: Array<{ baitRaw: string; observationRaw: string }> = [];
  for (let end = 1; end < source.length; end += 1) {
    const baitRaw = source.slice(0, end).trimEnd();
    if (baitRaw.length === 0 || baits.get(normalized(baitRaw)) === undefined) continue;
    const observationRaw = source.slice(end);
    if (!isRecognizedObservation(observationRaw)) continue;
    matches.push({ baitRaw, observationRaw });
  }
  matches.sort((left, right) => right.baitRaw.length - left.baitRaw.length);
  return matches[0] ?? null;
}

function isRecognizedObservation(source: string): boolean {
  const value = source.replace(/^[\s,.;:]+/u, '').trim();
  return (
    /^(?:\d+[,.]\d{1,2})(?:\s*м)?(?:\s+.+)?$/iu.test(value) ||
    /^(?:глубина|ям(?:а|ка|ке|ки))\b/iu.test(value) ||
    /^(?:маленьк(?:ая|ий)|средн(?:яя|ий)|больш(?:ая|ой))(?:\b|$)/iu.test(value) ||
    /^\((?:(?:с\s+)?\d{1,2}(?:[-:.]\d{1,2})?(?:\s*-\s*\d{1,2}(?:[-:.]\d{1,2})?)?\s+(?:утра|ночи|вечера)|\d{1,2}\s+час(?:а|ов)?\s+ночи)\)$/iu.test(
      value,
    )
  );
}

function parseObservation(source: string | null): {
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
  userNoteRaw: string | null;
} {
  if (source === null) {
    return {
      holeDepthCm: null,
      spotPositionRaw: null,
      fishingNote: null,
      spinningSize: null,
      spinningSpeed: null,
      userNoteRaw: null,
    };
  }
  const value = source.replace(/^[\s,.;:]+/u, '').trim();
  const explicitDepth = DEPTH.exec(value);
  const bareDepth = /^(\d+[,.]\d{1,2})(?:\s*м)?(?:\s+|$)/iu.exec(value);
  const depth = explicitDepth ?? bareDepth;
  const holeDepthCm = depth?.[1] === undefined ? null : metersInCentimeters(depth[1]);
  const spotPositionRaw =
    depth === null || depth.index === undefined
      ? null
      : structural(
          value.slice(depth.index + depth[0].length).replace(/^[\s,.;:]+|[\s,.;:]+$/gu, ''),
        );
  const notes = [
    /\u0432\u043f\u043e\u043b\u0432\u043e\u0434\u044b/iu.test(value) ? 'MIDWATER' : null,
    /\u0441\u043e\s+\u0434\u043d\u0430/iu.test(value) ? 'FROM_BOTTOM' : null,
    /\u043f\u043e\u0432\u0435\u0440\u0445\u0443/iu.test(value) ? 'SURFACE' : null,
  ].filter((value): value is 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' => value !== null);
  const spinningSize = enumObservation<CatchReportSpinningSize>(value, [
    [
      /(?:^|\s)\u043c\u0430\u043b\u0435\u043d\u044c\u043a(?:\u0430\u044f|\u0438\u0439)(?:\s|$)/iu,
      'SMALL',
    ],
    [/(?:^|\s)\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0438\u0439)(?:\s|$)/iu, 'MEDIUM'],
    [/(?:^|\s)\u0431\u043e\u043b\u044c\u0448(?:\u0430\u044f|\u043e\u0439)(?:\s|$)/iu, 'LARGE'],
  ]);
  const spinningSpeed = enumObservation<CatchReportSpinningSpeed>(value, [
    [/(?:^|\s)\u043c\u0435\u0434\u043b\u0435\u043d\u043d(?:\u0430\u044f|\u043e)(?:\s|$)/iu, 'SLOW'],
    [/(?:^|\s)\u0441\u0440\u0435\u0434\u043d(?:\u044f\u044f|\u0435)(?:\s|$)/iu, 'MEDIUM'],
    [/(?:^|\s)\u0431\u044b\u0441\u0442\u0440(?:\u0430\u044f|\u043e)(?:\s|$)/iu, 'FAST'],
  ]);
  const userNoteRaw = /^\(.*\)$/u.test(value) ? value : null;
  return {
    holeDepthCm,
    spotPositionRaw,
    fishingNote: new Set(notes).size === 1 ? (notes[0] ?? null) : null,
    spinningSize,
    spinningSpeed,
    userNoteRaw,
  };
}

function enumObservation<Value extends string>(
  source: string,
  patterns: ReadonlyArray<readonly [RegExp, Value]>,
): Value | null {
  const matches = patterns.filter(([pattern]) => pattern.test(source)).map(([, value]) => value);
  return new Set(matches).size === 1 ? (matches[0] ?? null) : null;
}

function candidateTail(source: string, start: number): { text: string; end: number } {
  const rest = source.slice(start);
  const newline = rest.search(/\r?\n/u);
  const sentence = rest.search(/[.!?](?=\s|[\p{L}]|$)/u);
  const boundaries = [newline, sentence === -1 ? -1 : sentence + 1].filter((value) => value >= 0);
  const end = boundaries.length === 0 ? rest.length : Math.min(...boundaries);
  return { text: rest.slice(0, end), end };
}

function inheritedLocation(
  bodyText: string,
  candidateStart: number,
  locations: Map<string, string>,
): string | null {
  const boundary = bodyText.lastIndexOf('\n\n', candidateStart - 1);
  const paragraphStart = boundary === -1 ? 0 : boundary + 2;
  const preceding = bodyText.slice(paragraphStart, candidateStart);
  const lines = preceding.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = locationHeader(lines[index] ?? '');
    if (candidate === null) continue;
    const match = locations.get(normalized(candidate));
    if (match !== undefined) return match;
    return null;
  }
  return null;
}

function locationHeader(source: string): string | null {
  const stripped = source
    .trim()
    .replace(/^[-*\u2022]\s*/u, '')
    .replace(
      /^(?:\u043b\u043e\u043a\u0430\u0446\u0438\u044f|\u043b\u043e\u043a\u0430)(?![\p{L}\p{N}])\s*[:=-]?\s*/iu,
      '',
    )
    .replace(/^["'\u00ab\u201c]|["'\u00bb\u201d:]$/gu, '')
    .trim();
  return stripped.length === 0 ? null : stripped;
}

function boundedNumberedLocation(source: string, locations: Map<string, string>): string {
  const match = /^локация\s*№\s*\d+\s+(.+)$/iu.exec(source);
  if (match?.[1] === undefined) return source;
  return locations.get(normalized(match[1])) ?? source;
}

function exactNamedSuffix(
  source: string,
  names: Map<string, string>,
): { canonicalName: string; rawName: string; start: number } | null {
  const candidates: Array<{ canonicalName: string; rawName: string; start: number }> = [];
  const recentStart = Math.max(0, source.length - 160);
  for (let start = recentStart; start < source.length; start += 1) {
    const raw = source.slice(start).trim();
    if (raw.length === 0) continue;
    const canonicalName = names.get(normalized(raw));
    if (canonicalName !== undefined) {
      const leading = source.slice(start).length - source.slice(start).trimStart().length;
      candidates.push({ canonicalName, rawName: raw, start: start + leading });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((left, right) => left.start - right.start);
  return candidates[0] ?? null;
}

function uniqueNormalizedNames(values: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const value of values) {
    const key = normalized(value);
    const existing = result.get(key);
    if (existing !== undefined && existing !== value) ambiguous.add(key);
    else result.set(key, value);
  }
  for (const key of ambiguous) result.delete(key);
  return result;
}

function weightInGrams(rawValue: string, rawUnit: string): number | null {
  if (/^\u043a\u0433$/iu.test(rawUnit)) {
    const [whole, fraction = ''] = rawValue.replace(',', '.').split('.');
    if (!/^\d+$/u.test(whole ?? '') || !/^\d{0,3}$/u.test(fraction)) return null;
    const grams = BigInt(whole ?? '0') * 1_000n + BigInt(fraction.padEnd(3, '0') || '0');
    return safePositiveInteger(grams);
  }
  if (!/^\d+$/u.test(rawValue)) return null;
  return safePositiveInteger(BigInt(rawValue));
}

function metersInCentimeters(rawValue: string): number | null {
  const [whole, fraction = ''] = rawValue.replace(',', '.').split('.');
  if (!/^\d+$/u.test(whole ?? '') || !/^\d{0,2}$/u.test(fraction)) return null;
  return safePositiveInteger(BigInt(whole ?? '0') * 100n + BigInt(fraction.padEnd(2, '0') || '0'));
}

function safePositiveInteger(value: bigint): number | null {
  return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function sourceRange(
  bodyText: string,
  startOffset: number,
  endOffset: number,
): CandidateSourceRange {
  return {
    startOffset,
    endOffset,
    startLine: lineAt(bodyText, startOffset),
    endLine: lineAt(bodyText, Math.max(startOffset, endOffset - 1)),
  };
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') line += 1;
  }
  return line;
}

function structural(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalized(value: string): string {
  try {
    return normalizeCatalogName(value).nameNormalized;
  } catch {
    return '';
  }
}
