import { Inject, Injectable } from '@nestjs/common';
import {
  buildCatalogLookupIndex,
  type CatalogLookupResolution,
  resolveCatalogLookup,
} from '../../catalog/catalog-lookup.js';
import type { CatalogBaitType } from '../../catalog/catalog.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CatchReportFishingMethod } from '../catch-reports.constants.js';
import { catchReportErrors } from '../catch-reports.errors.js';
import {
  RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN,
  SPOT_POSITION_RAW_MAX_LENGTH_PATTERN,
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_RAW_SOURCE_TEXT_PATTERN,
  VALID_SPOT_POSITION_RAW_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from '../catch-report-raw-note.js';
import {
  type CatchReportDraft,
  type DraftField,
  type DraftIssue,
  type DraftLocation,
  type DraftNamedItem,
  type DraftBait,
  missingField,
  type ParseCatchReportResult,
  type ParseCatchReportBatchResult,
  resolvedField,
  type SourceRange,
  unresolvedField,
} from './catch-report-parser.types.js';
import {
  CATCH_REPORT_BATCH_MAX_ITEMS,
  duplicateIndexesByCandidate,
  splitCatchReportBatchSource,
} from './catch-report-batch-splitter.js';
import {
  fallbackBaitSource,
  matchCatalogPrefix,
  parseGameLine,
  sourceAfterComma,
  splitLocationAndBaitFallback,
} from './game-line-parser.js';
import { parseObservation } from './observation-parser.js';

/** Однозначно разрешённая сущность вместе с точным текстом, который на неё указал. */
interface ResolvedSource<T> {
  item: T;
  source: SourceRange;
}

/** Location-кандидат ограничивается уже разрешённой FishingBase. */
type LocationCandidate = DraftLocation;

/** Bait-кандидат несёт тип, из которого выводится метод ловли. */
type BaitCandidate = DraftBait;

/** Минимальная форма активного ScreenAnchor для распознавания позиции. */
interface AnchorCandidate {
  name: string;
  nameNormalized: string;
}

/**
 * Абстракция каталога для общего parsing pipeline.
 * Одиночный preview читает данные через Prisma по мере надобности, а пакетный заранее создаёт
 * неизменяемые индексы, чтобы строки одного запроса разбирались по одному загруженному набору.
 */
interface ParserCatalog {
  findBase: (lookupText: string) => Promise<CatalogLookupResolution<DraftNamedItem>>;
  findFish: (lookupText: string) => Promise<CatalogLookupResolution<DraftNamedItem>>;
  listBaits: () => Promise<readonly BaitCandidate[]>;
  listAnchors: () => Promise<readonly AnchorCandidate[]>;
  listLocations: (baseId: string) => Promise<readonly LocationCandidate[]>;
  hasMembership: (baseId: string, fishId: string) => Promise<boolean>;
}

// Сообщения описывают обязательные поля; точная причина хранится отдельно в стабильном issue code.
const FIELD_MESSAGES: Record<string, string> = {
  fishingBase: 'Не удалось определить рыболовную базу',
  location: 'Не удалось определить локацию',
  fish: 'Не удалось определить рыбу',
  bait: 'Не удалось определить наживку или приманку',
  weightGrams: 'Не удалось определить вес',
  fishingMethod: 'Метод ловли нельзя определить без наживки или приманки',
};

/** Создаёт единый NOT_FOUND-результат для отсутствующего источника или fallback-ветки. */
function notFoundLookup<T>(): CatalogLookupResolution<T> {
  return { status: 'NOT_FOUND' };
}

/** Связывает SourceRange с элементом только при строго UNIQUE catalog resolution. */
function resolvedSource<T>(
  source: SourceRange | null,
  resolution: CatalogLookupResolution<T>,
): ResolvedSource<T> | null {
  return source !== null && resolution.status === 'UNIQUE'
    ? { item: resolution.item, source }
    : null;
}

/**
 * Переводит результат обязательного catalog lookup в DraftField, не скрывая разницу между
 * отсутствующим текстом, неизвестным значением и несколькими точными совпадениями.
 */
function requiredCatalogField<T>(
  source: SourceRange | null,
  resolution: CatalogLookupResolution<T>,
  unresolvedCode: string,
  ambiguousCode: string,
): DraftField<T> {
  if (source === null) {
    return missingField();
  }

  if (resolution.status === 'NOT_FOUND') {
    return unresolvedField(source.text, unresolvedCode, true);
  }

  if (resolution.status === 'AMBIGUOUS') {
    return unresolvedField(source.text, ambiguousCode, true);
  }

  return resolvedField(resolution.item, source.text, true);
}

/** Детерминированно выводит исторический метод ловли из типа разрешённой Bait/Lure. */
function methodFromBait(type: CatalogBaitType): CatchReportFishingMethod {
  return type === 'BAIT' ? 'BAIT_FISHING' : 'SPINNING';
}

/** Создаёт blocking issue для одного обязательного поля, если оно ещё не разрешено. */
function issueForField(field: string, fieldValue: DraftField<unknown>): DraftIssue | null {
  if (fieldValue.status === 'RESOLVED') {
    return null;
  }

  return {
    severity: 'BLOCKING',
    code: fieldValue.status === 'MISSING' ? `MISSING_${field.toUpperCase()}` : fieldValue.code,
    field,
    message:
      fieldValue.status === 'UNRESOLVED' && fieldValue.code.endsWith('_AMBIGUOUS')
        ? 'Найдено несколько совпадений. Выберите значение вручную'
        : (FIELD_MESSAGES[field] ?? 'Заполните обязательное поле'),
  };
}

/** Собирает blocking issues только для полей, помеченных обязательными в текущем Draft. */
function fieldIssues(draft: CatchReportDraft): DraftIssue[] {
  const requiredEntries: Array<readonly [string, DraftField<unknown>]> = [
    ['fishingBase', draft.fields.fishingBase],
    ['location', draft.fields.location],
    ['fish', draft.fields.fish],
    ['bait', draft.fields.bait],
    ['weightGrams', draft.fields.weightGrams],
    ['fishingMethod', draft.fields.fishingMethod],
    ['holeDepthCm', draft.fields.holeDepthCm],
    ['spinningSize', draft.fields.spinningSize],
    ['spinningSpeed', draft.fields.spinningSpeed],
  ];

  return requiredEntries
    .filter(([, field]) => field.required)
    .map(([name, field]) => issueForField(name, field))
    .filter((issue): issue is DraftIssue => issue !== null);
}

/**
 * Проверяет предложенный сырой текст позиции или комментария по тем же ограничениям, что запись.
 * Невалидное необязательное значение становится warning и UNRESOLVED, а не тихо обрезается.
 */
function proposedTextIssue(
  field: 'spotPositionRaw' | 'userNoteRaw',
  value: string | null,
): DraftIssue | null {
  if (value === null) return null;

  const isPosition = field === 'spotPositionRaw';
  const lengthPattern = isPosition
    ? SPOT_POSITION_RAW_MAX_LENGTH_PATTERN
    : USER_NOTE_RAW_MAX_LENGTH_PATTERN;
  const validPattern = isPosition ? VALID_SPOT_POSITION_RAW_PATTERN : VALID_USER_NOTE_RAW_PATTERN;

  if (lengthPattern.test(value) && validPattern.test(value)) return null;

  return {
    severity: 'WARNING',
    code: isPosition ? 'INVALID_SPOT_POSITION_RAW' : 'INVALID_USER_NOTE_RAW',
    field,
    message: isPosition
      ? 'Распознанная позиция слишком длинная или содержит управляющие символы'
      : 'Распознанный комментарий слишком длинный или содержит управляющие символы',
  };
}

/**
 * Оркестрирует неперсистентный preview CatchReport: разбирает структуру, разрешает активный
 * каталог, проверяет Base↔Fish и возвращает Draft для подтверждения или ручного исправления.
 * Сервис только читает PostgreSQL и не создаёт CatchReport.
 */
@Injectable()
export class CatchReportParserService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Разбирает одну исходную запись через актуальный активный каталог PostgreSQL. */
  async parse(rawSourceText: string): Promise<ParseCatchReportResult> {
    return this.parseWithCatalog(rawSourceText, this.databaseCatalog());
  }

  /**
   * Выполняет общий детерминированный pipeline поверх переданной реализации каталога.
   * Все неразрешённые части сохраняются в Draft; метод не угадывает значения и не записывает их.
   */
  private async parseWithCatalog(
    rawSourceText: string,
    catalog: ParserCatalog,
  ): Promise<ParseCatchReportResult> {
    // Этап 1: выделяем игровое ядро и точные диапазоны, ещё не обращаясь к каталогу.
    const gameLine = parseGameLine(rawSourceText);
    const baseSource = gameLine.fishingBaseSource;
    const fishSource = gameLine.fishSource;

    // Этап 2: Base/Fish разрешаются параллельно с загрузкой словарей Bait и ScreenAnchor.
    const [baseResolution, fishResolution, baits, anchors] = await Promise.all([
      baseSource === null
        ? Promise.resolve(notFoundLookup<DraftNamedItem>())
        : catalog.findBase(baseSource.text),
      fishSource === null
        ? Promise.resolve(notFoundLookup<DraftNamedItem>())
        : catalog.findFish(fishSource.text),
      catalog.listBaits(),
      catalog.listAnchors(),
    ]);

    const baseResolved = resolvedSource(baseSource, baseResolution);
    const fishResolved = resolvedSource(fishSource, fishResolution);

    // Этап 3: Location зависит от Base, Bait — от границы Location, а метод — только от типа Bait.
    const locationResult = await this.resolveLocation(
      rawSourceText,
      gameLine.locationAndBaitSource,
      baseResolved,
      catalog,
    );
    const baitResult = this.resolveBait(rawSourceText, locationResult.baitAndSuffixSource, baits);
    const fishingMethod =
      baitResult.resolved === null ? null : methodFromBait(baitResult.resolved.item.type);

    // Полностью найденное игровое ядро отдаёт наблюдениям остаток после Bait. При неполном ядре
    // используется консервативный observationSource, подготовленный первым этапом.
    const observationSource =
      gameLine.hasGameCore && baitResult.observationSource !== null
        ? baitResult.observationSource
        : gameLine.observationSource;

    // Этап 4: необязательные наблюдения извлекаются независимо и сохраняют непокрытый текст.
    const observation = parseObservation(rawSourceText, observationSource, fishingMethod, anchors);
    const spotPositionIssue = proposedTextIssue(
      'spotPositionRaw',
      observation.spotPositionRaw?.value ?? null,
    );
    const userNoteIssue = proposedTextIssue('userNoteRaw', observation.userNoteRaw?.value ?? null);

    // Membership проверяется отдельно от разрешения сущностей: точные Base и Fish могут
    // существовать, но их текущая каталожная связь обязательна для будущего сохранения.
    const membership = await this.resolveMembership(
      baseResolved?.item ?? null,
      fishResolved?.item ?? null,
      catalog,
    );
    const fishingBaseField = requiredCatalogField(
      baseSource,
      baseResolution,
      'FISHING_BASE_UNRESOLVED',
      'FISHING_BASE_AMBIGUOUS',
    );
    const fishField = requiredCatalogField(
      fishSource,
      fishResolution,
      'FISH_UNRESOLVED',
      'FISH_AMBIGUOUS',
    );
    const baitField = requiredCatalogField(
      baitResult.source,
      baitResult.resolution,
      'BAIT_UNRESOLVED',
      'BAIT_AMBIGUOUS',
    );
    const methodField: DraftField<CatchReportFishingMethod> =
      fishingMethod !== null
        ? resolvedField(fishingMethod, baitResult.resolved?.source.text ?? null, true)
        : baitResult.source === null
          ? missingField()
          : unresolvedField(baitResult.source.text, 'FISHING_METHOD_UNRESOLVED', true);
    const weightField: DraftField<number> =
      gameLine.weight === null
        ? missingField()
        : gameLine.weight.value === null
          ? unresolvedField(gameLine.weight.source.text, 'INVALID_WEIGHT', true)
          : resolvedField(gameLine.weight.value, gameLine.weight.source.text, true);

    // Этап 5: все промежуточные результаты сводятся в единый публично безопасный Draft.
    const draft: CatchReportDraft = {
      rawSourceText,
      fields: {
        fishingBase: fishingBaseField,
        location: requiredCatalogField(
          locationResult.source,
          locationResult.resolution,
          baseResolved === null ? 'LOCATION_REQUIRES_FISHING_BASE' : 'LOCATION_UNRESOLVED',
          'LOCATION_AMBIGUOUS',
        ),
        fish: fishField,
        bait: baitField,
        weightGrams: weightField,
        fishingMethod: methodField,
        holeDepthCm:
          observation.holeDepthCm !== null
            ? resolvedField(
                observation.holeDepthCm.value,
                observation.holeDepthCm.source.text,
                false,
              )
            : resolvedField(null, null, false),
        spotPositionRaw:
          observation.spotPositionRaw === null
            ? resolvedField(null, null, false)
            : spotPositionIssue !== null
              ? unresolvedField(
                  observation.spotPositionRaw.source.text,
                  spotPositionIssue.code,
                  false,
                )
              : resolvedField(
                  observation.spotPositionRaw.value,
                  observation.spotPositionRaw.source.text,
                  false,
                ),
        fishingNote:
          observation.fishingNote === null
            ? resolvedField(null, null, false)
            : resolvedField(
                observation.fishingNote.value,
                observation.fishingNote.source.text,
                false,
              ),
        spinningSize:
          observation.spinningSize !== null
            ? resolvedField(
                observation.spinningSize.value,
                observation.spinningSize.source.text,
                false,
              )
            : resolvedField(null, null, false),
        spinningSpeed:
          observation.spinningSpeed !== null
            ? resolvedField(
                observation.spinningSpeed.value,
                observation.spinningSpeed.source.text,
                false,
              )
            : resolvedField(null, null, false),
        userNoteRaw:
          observation.userNoteRaw === null
            ? resolvedField(null, null, false)
            : userNoteIssue !== null
              ? unresolvedField(observation.userNoteRaw.source.text, userNoteIssue.code, false)
              : resolvedField(
                  observation.userNoteRaw.value,
                  observation.userNoteRaw.source.text,
                  false,
                ),
      },
      baseFishMembership: {
        status: membership,
        baseId: baseResolved?.item.id ?? null,
        fishId: fishResolved?.item.id ?? null,
      },
      issues: [],
      unresolvedFragments: [...gameLine.unresolvedFragments, ...observation.unresolvedFragments],
      missingRequiredFields: [],
      canConfirm: false,
    };

    // Этап 6: issues производятся после полей, чтобы blocking-решение выводилось из Draft,
    // а не из разрозненных ветвей парсера.
    draft.issues.push(...fieldIssues(draft));

    for (const issue of [spotPositionIssue, userNoteIssue]) {
      if (issue !== null) draft.issues.push(issue);
    }

    if (membership === 'UNRESOLVED' && baseResolved !== null && fishResolved !== null) {
      draft.issues.push({
        severity: 'BLOCKING',
        code: 'FISH_NOT_IN_BASE',
        field: 'fish',
        message: 'Рыба не связана с выбранной рыболовной базой',
      });
    }

    for (const fragment of draft.unresolvedFragments) {
      draft.issues.push({
        severity: 'WARNING',
        code: 'UNRESOLVED_FRAGMENT',
        message: `Не удалось однозначно разобрать фрагмент: ${fragment.text}`,
      });
    }

    draft.missingRequiredFields = Object.entries(draft.fields)
      .filter(([, field]) => field.status === 'MISSING' && field.required)
      .map(([name]) => name);

    // Warning не запрещает подтверждение; только хотя бы один BLOCKING делает Draft неготовым.
    draft.canConfirm = !draft.issues.some((issue) => issue.severity === 'BLOCKING');

    return { draft };
  }

  /**
   * Разбирает каждую непустую физическую строку как независимый Draft, сохраняя порядок.
   * Пакет сначала валидируется целиком, затем использует один загруженный набор каталога;
   * точные дубли не удаляются, а получают warning со ссылкой на другую строку.
   */
  async parseBatch(rawSourceText: string): Promise<ParseCatchReportBatchResult> {
    const candidates = splitCatchReportBatchSource(rawSourceText);
    if (candidates.length > CATCH_REPORT_BATCH_MAX_ITEMS) {
      throw catchReportErrors.batchLimitExceeded();
    }
    for (const candidate of candidates) {
      if (!RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN.test(candidate.rawSourceText)) {
        throw catchReportErrors.batchLineInvalid(
          candidate.sourceLine,
          'запись должна быть не длиннее 20000 символов',
        );
      }
      if (!VALID_RAW_SOURCE_TEXT_PATTERN.test(candidate.rawSourceText)) {
        throw catchReportErrors.batchLineInvalid(
          candidate.sourceLine,
          'запись не может состоять из пробелов или содержать небезопасные символы',
        );
      }
    }

    // Метаданные дублей строятся до параллельного разбора и сравнивают исходные строки побайтно.
    const duplicateIndexes = duplicateIndexesByCandidate(candidates);
    const catalog = await this.batchCatalog();
    const parsed = await Promise.all(
      candidates.map((candidate) => this.parseWithCatalog(candidate.rawSourceText, catalog)),
    );

    return {
      rows: parsed.map(({ draft }, index) => {
        const candidate = candidates[index];
        if (candidate === undefined) throw new RangeError('Batch parser candidate is missing');
        const duplicates = duplicateIndexes.get(candidate.index) ?? [];

        if (duplicates.length > 0) {
          draft.issues.push({
            severity: 'WARNING',
            code: 'DUPLICATE_INPUT_ROW',
            message: `Точная копия исходной строки: ${duplicates
              .map((duplicateIndex) => candidates[duplicateIndex]?.sourceLine)
              .filter((line): line is number => line !== undefined)
              .join(', ')}`,
          });
        }

        return {
          index: candidate.index,
          sourceLine: candidate.sourceLine,
          duplicateIndexes: duplicates,
          draft,
        };
      }),
    };
  }

  /**
   * Разрешает Location только среди активных локаций однозначно найденной Base и требует запятую
   * после каталожного префикса. Без Base или точного совпадения первая запятая лишь разделяет
   * unresolved Location от хвоста Bait, не создавая ложного resolution.
   */
  private async resolveLocation(
    rawSourceText: string,
    locationAndBaitSource: SourceRange | null,
    base: ResolvedSource<DraftNamedItem> | null,
    catalog: ParserCatalog,
  ): Promise<{
    source: SourceRange | null;
    resolution: CatalogLookupResolution<DraftLocation>;
    resolved: ResolvedSource<DraftLocation> | null;
    baitAndSuffixSource: SourceRange | null;
  }> {
    if (locationAndBaitSource === null) {
      return {
        source: null,
        resolution: notFoundLookup(),
        resolved: null,
        baitAndSuffixSource: null,
      };
    }

    if (base !== null) {
      const locations = await catalog.listLocations(base.item.id);
      const match = matchCatalogPrefix(
        rawSourceText,
        locationAndBaitSource,
        locations as LocationCandidate[],
        'COMMA',
      );

      if (match?.resolution.status === 'UNIQUE') {
        const item: DraftLocation = {
          id: match.resolution.item.id,
          number: match.resolution.item.number,
          name: match.resolution.item.name,
        };

        return {
          source: match.source,
          resolution: { status: 'UNIQUE', item },
          resolved: { item, source: match.source },
          baitAndSuffixSource: sourceAfterComma(
            rawSourceText,
            match.source,
            locationAndBaitSource.end,
          ),
        };
      }

      if (match?.resolution.status === 'AMBIGUOUS') {
        // Неоднозначная Location завершает структурное разрешение: выбирать границу Bait опасно.
        return {
          source: match.source,
          resolution: match.resolution,
          resolved: null,
          baitAndSuffixSource: null,
        };
      }
    }

    const fallback = splitLocationAndBaitFallback(rawSourceText, locationAndBaitSource);
    return {
      source: fallback.locationSource,
      resolution: notFoundLookup(),
      resolved: null,
      baitAndSuffixSource: fallback.baitAndSuffixSource,
    };
  }

  /**
   * Ищет самый длинный точный Bait-prefix с безопасной границей и возвращает остаток наблюдений.
   * При отсутствии совпадения fallback отделяет предполагаемый Bait первой точкой, но оставляет
   * его NOT_FOUND; неоднозначность не сокращается до более короткого совпадения.
   */
  private resolveBait(
    rawSourceText: string,
    baitAndSuffixSource: SourceRange | null,
    baits: readonly BaitCandidate[],
  ): {
    source: SourceRange | null;
    resolution: CatalogLookupResolution<DraftBait>;
    resolved: ResolvedSource<DraftBait> | null;
    observationSource: SourceRange | null;
  } {
    if (baitAndSuffixSource === null) {
      return {
        source: null,
        resolution: notFoundLookup(),
        resolved: null,
        observationSource: null,
      };
    }

    const match = matchCatalogPrefix(rawSourceText, baitAndSuffixSource, baits, 'SUFFIX');

    if (match?.resolution.status === 'UNIQUE') {
      const item: DraftBait = {
        id: match.resolution.item.id,
        name: match.resolution.item.name,
        type: match.resolution.item.type,
      };

      return {
        source: match.source,
        resolution: { status: 'UNIQUE', item },
        resolved: { item, source: match.source },
        observationSource: match.remainder,
      };
    }

    if (match?.resolution.status === 'AMBIGUOUS') {
      // Без однозначной границы Bait последующий текст нельзя безопасно назначить наблюдениям.
      return {
        source: match.source,
        resolution: match.resolution,
        resolved: null,
        observationSource: null,
      };
    }

    const fallback = fallbackBaitSource(rawSourceText, baitAndSuffixSource);
    return {
      source: fallback.baitSource.text.length === 0 ? null : fallback.baitSource,
      resolution: notFoundLookup(),
      resolved: null,
      observationSource: fallback.observationSource,
    };
  }

  /**
   * Проверяет текущую Base↔Fish membership после разрешения обеих сущностей.
   * MISSING означает, что проверка невозможна, UNRESOLVED — что точная пара отсутствует в каталоге.
   */
  private async resolveMembership(
    base: DraftNamedItem | null,
    fish: DraftNamedItem | null,
    catalog: ParserCatalog,
  ): Promise<'RESOLVED' | 'MISSING' | 'UNRESOLVED'> {
    if (base === null || fish === null) {
      return 'MISSING';
    }

    return (await catalog.hasMembership(base.id, fish.id)) ? 'RESOLVED' : 'UNRESOLVED';
  }

  /**
   * Создаёт lazy-адаптер одиночного preview поверх Prisma.
   * Каждая операция читает только активные catalog-сущности; membership проверяется по составному
   * ключу и никаких записей или побочных эффектов не выполняет.
   */
  private databaseCatalog(): ParserCatalog {
    return {
      findBase: async (lookupText) => {
        const items = await this.prisma.fishingBase.findMany({
          where: { isActive: true },
          orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        });
        return resolveCatalogLookup(buildCatalogLookupIndex(items), lookupText);
      },
      findFish: async (lookupText) => {
        const items = await this.prisma.fish.findMany({
          where: { isActive: true },
          orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        });
        return resolveCatalogLookup(buildCatalogLookupIndex(items), lookupText);
      },
      listBaits: () =>
        this.prisma.bait.findMany({
          where: { isActive: true },
          orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true, type: true },
        }),
      listAnchors: () =>
        this.prisma.screenAnchor.findMany({
          where: { isActive: true },
          orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
          select: { name: true, nameNormalized: true },
        }),
      listLocations: (baseId) =>
        this.prisma.location.findMany({
          where: {
            fishingBaseId: baseId,
            isActive: true,
            fishingBase: { isActive: true },
          },
          orderBy: [{ number: 'asc' }, { nameNormalized: 'asc' }, { id: 'asc' }],
          select: { id: true, number: true, name: true },
        }),
      hasMembership: async (baseId, fishId) =>
        (await this.prisma.fishingBaseFish.findUnique({
          where: { fishingBaseId_fishId: { fishingBaseId: baseId, fishId } },
          select: { fishingBaseId: true },
        })) !== null,
    };
  }

  /**
   * Загружает активный каталог и все membership одним параллельным набором запросов для batch.
   * Локальные индексы устраняют N+1-запросы и гарантируют одинаковую картину каталога для всех
   * строк конкретного вызова parseBatch.
   */
  private async batchCatalog(): Promise<ParserCatalog> {
    const [bases, fish, baits, anchors, locations, memberships] = await Promise.all([
      this.prisma.fishingBase.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.fish.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      }),
      this.prisma.bait.findMany({
        where: { isActive: true },
        orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, type: true },
      }),
      this.prisma.screenAnchor.findMany({
        where: { isActive: true },
        orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
        select: { name: true, nameNormalized: true },
      }),
      this.prisma.location.findMany({
        where: { isActive: true, fishingBase: { isActive: true } },
        orderBy: [
          { fishingBaseId: 'asc' },
          { number: 'asc' },
          { nameNormalized: 'asc' },
          { id: 'asc' },
        ],
        select: {
          id: true,
          fishingBaseId: true,
          number: true,
          name: true,
        },
      }),
      this.prisma.fishingBaseFish.findMany({
        select: { fishingBaseId: true, fishId: true },
      }),
    ]);

    // Base и Fish используют общий детерминированный lookup, Location индексируются внутри Base.
    const basesByName = buildCatalogLookupIndex(bases);
    const fishByName = buildCatalogLookupIndex(fish);
    const locationsByBase = new Map<string, LocationCandidate[]>();
    for (const location of locations) {
      const items = locationsByBase.get(location.fishingBaseId) ?? [];
      items.push(location);
      locationsByBase.set(location.fishingBaseId, items);
    }

    // Составной строковый ключ нужен только для lookup в памяти и не становится доменной identity.
    const membershipKeys = new Set(
      memberships.map((item) => `${item.fishingBaseId}:${item.fishId}`),
    );

    return {
      findBase: (lookupText) => Promise.resolve(resolveCatalogLookup(basesByName, lookupText)),
      findFish: (lookupText) => Promise.resolve(resolveCatalogLookup(fishByName, lookupText)),
      listBaits: () => Promise.resolve(baits),
      listAnchors: () => Promise.resolve(anchors),
      listLocations: (baseId) => Promise.resolve(locationsByBase.get(baseId) ?? []),
      hasMembership: (baseId, fishId) => Promise.resolve(membershipKeys.has(`${baseId}:${fishId}`)),
    };
  }
}
