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

// Сгенерированная игрой связка отделяет рыбу с весом от Base; свободный текст сам по себе
// не считается этой структурной границей.
const CAUGHT_AT = /(?<![\p{L}\p{N}])пойман(?:а|о)?\s+на\s+/giu;

// Location обязана закончиться запятой, а Bait — концом строки или безопасным разделителем.
const SAFE_SUFFIX_BOUNDARY = /^[\s.,;:!?/\\()[\]{}]$/u;
const STRUCTURAL_GAP = /^[\p{White_Space}\p{P}]*$/u;

/** Найденный токен веса вместе с точным источником и результатом строгого числового разбора. */
export interface ParsedWeightToken {
  source: SourceRange;
  value: number | null;
}

/**
 * Структурный результат первого этапа разбора игровой строки.
 * Этап лишь выделяет Fish, вес, Base и общий хвост Location/Bait; каталог и наблюдения разрешаются
 * позже. Значимый текст между структурными частями сохраняется в unresolvedFragments.
 */
export interface ParsedGameLine {
  hasGameCore: boolean;
  fishSource: SourceRange | null;
  weight: ParsedWeightToken | null;
  fishingBaseSource: SourceRange | null;
  locationAndBaitSource: SourceRange | null;
  observationSource: SourceRange;
  unresolvedFragments: SourceRange[];
}

/** Минимальный элемент каталога, допустимый для точного prefix-сопоставления. */
export type CatalogPrefixCandidate = CatalogLookupItem;

/**
 * Самый длинный допустимый префикс каталога, его UNIQUE/AMBIGUOUS-результат и нетронутый остаток.
 */
export interface CatalogPrefixMatch<T extends CatalogPrefixCandidate> {
  resolution: CatalogLookupResolution<T>;
  source: SourceRange;
  remainder: SourceRange;
}

function isWhitespace(value: string): boolean {
  return /^\s$/u.test(value);
}

/**
 * Обрезает только краевые пробелы диапазона и пересчитывает offsets относительно исходной строки.
 * Внутренний текст не нормализуется, чтобы Draft мог показать пользователю точный ввод.
 */
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

/** Выполняет поиск глобальным RegExp с заданной позиции, явно сбрасывая его mutable lastIndex. */
function firstMatchAfter(pattern: RegExp, source: string, start: number): RegExpExecArray | null {
  pattern.lastIndex = start;
  return pattern.exec(source);
}

/** Создаёт точную пустую границу там, где структурный разбор полностью потребил строку. */
function emptyRangeAt(rawSourceText: string, index: number): SourceRange {
  return { text: rawSourceText.slice(index, index), start: index, end: index };
}

/** Оставляет промежуток unresolved, только если в нём есть неструктурный текст. */
function meaningfulGap(rawSourceText: string, start: number, end: number): SourceRange[] {
  const source = trimSourceRange(rawSourceText, start, end);
  return STRUCTURAL_GAP.test(source.text) ? [] : [source];
}

/**
 * Выделяет детерминированное игровое ядро вида «Fish Weight пойман(а) на Base: …».
 * Неполная структура не угадывается: найденные Fish/Weight сохраняются, а оставшийся текст
 * передаётся этапу наблюдений без попытки выдумать Base, Location или Bait.
 */
export function parseGameLine(rawSourceText: string): ParsedGameLine {
  const wholeSource = trimSourceRange(rawSourceText, 0, rawSourceText.length);

  // Вес — первый надёжный разделитель между названием Fish и остальной игровой фразой.
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

  // Связка «пойман(а) на» принимается только после веса, чтобы не захватить ранний свободный текст.
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

  // Двоеточие — обязательная игровая граница между Base и парой Location/Bait.
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

    // Необычная вставка между весом и игровой связкой не теряется и позже станет warning.
    unresolvedFragments: meaningfulGap(rawSourceText, weightSource.end, caughtMatch.index),
  };
}

/** Не позволяет разрезать UTF-16 surrogate pair при переборе границ каталожного префикса. */
function isCodePointBoundary(source: string, index: number): boolean {
  if (index <= 0 || index >= source.length) {
    return true;
  }

  const previous = source.charCodeAt(index - 1);
  const current = source.charCodeAt(index);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

/** Проверяет, что имя Bait не является началом более длинного буквенно-цифрового токена. */
function suffixBoundary(source: string, index: number): boolean {
  if (index >= source.length) {
    return true;
  }

  return SAFE_SUFFIX_BOUNDARY.test(source[index] ?? '');
}

/** Проверяет обязательную запятую после Location, пропуская только промежуточные пробелы. */
function commaBoundary(source: string, index: number): boolean {
  let cursor = index;

  while (cursor < source.length && isWhitespace(source[cursor] ?? '')) {
    cursor += 1;
  }

  return source[cursor] === ',';
}

/**
 * Ищет самый длинный точный нормализованный catalog-prefix с безопасной правой границей.
 * Счётчик останавливает перебор сразу после порога в 128 Unicode code points, связанного с
 * максимальной длиной каталожного имени; fuzzy-match не применяется, а AMBIGUOUS самого длинного
 * префикса возвращается пользователю как есть.
 */
export function matchCatalogPrefix<T extends CatalogPrefixCandidate>(
  rawSourceText: string,
  range: SourceRange,
  candidates: readonly T[],
  expectedBoundary: 'COMMA' | 'SUFFIX',
): CatalogPrefixMatch<T> | null {
  const lookupIndex = buildCatalogLookupIndex(candidates);
  let best: CatalogPrefixMatch<T> | null = null;
  let codePoints = 0;

  // end движется по UTF-16 offsets, а счётчик увеличивается только на целых Unicode code points.
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

    // Последний допустимый результат является самым длинным благодаря направлению перебора.
    best = {
      resolution,
      source,
      remainder: trimSourceRange(rawSourceText, source.end, range.end),
    };
  }

  return best;
}

/**
 * Консервативно делит неизвестный хвост по первой запятой на предполагаемые Location и Bait.
 * Значения остаются unresolved; fallback нужен лишь для продолжения последующих этапов.
 */
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

/** Возвращает точный остаток после распознанного значения и одной ожидаемой запятой. */
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

/**
 * Для нераспознанного Bait отделяет его предполагаемый текст первой точкой от наблюдений.
 * Это не разрешает Bait и не превращает произвольный остаток в пользовательский комментарий.
 */
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
