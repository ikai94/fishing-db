import type { CatalogBaitType } from '../../catalog/catalog.constants.js';
import type {
  CatchReportFishingMethod,
  CatchReportFishingNote,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../catch-reports.constants.js';

/** Состояние результата распознавания: найдено, отсутствует или требует решения пользователя. */
export type DraftStatus = 'RESOLVED' | 'MISSING' | 'UNRESOLVED';

/** Blocking запрещает подтверждение Draft, а Warning лишь просит проверить предложенный разбор. */
export type DraftIssueSeverity = 'BLOCKING' | 'WARNING';

/**
 * Точный фрагмент исходной JavaScript-строки.
 * Индексы заданы в UTF-16 code units и позволяют интерфейсу подсветить текст без нормализации.
 */
export interface SourceRange {
  text: string;
  start: number;
  end: number;
}

/**
 * Результат разбора одного поля Draft.
 * RESOLVED допускает null для корректно отсутствующего необязательного значения; MISSING означает
 * отсутствующее обязательное поле, а UNRESOLVED сохраняет найденный текст и причину неоднозначности.
 */
export type DraftField<T> =
  | {
      status: 'RESOLVED';
      sourceText: string | null;
      value: T | null;
      required: boolean;
    }
  | {
      status: 'MISSING';
      sourceText: null;
      value: null;
      required: true;
    }
  | {
      status: 'UNRESOLVED';
      sourceText: string;
      value: null;
      required: boolean;
      code: string;
    };

/** Минимальная публичная ссылка на распознанную сущность каталога без внутренних данных. */
export interface DraftNamedItem {
  id: string;
  name: string;
}

/** Распознанная Location дополнительно несёт игровой номер внутри Base. */
export interface DraftLocation extends DraftNamedItem {
  number: number;
}

/** Тип Bait нужен для детерминированного вывода исторического метода ловли. */
export interface DraftBait extends DraftNamedItem {
  type: CatalogBaitType;
}

/** Машиночитаемая проблема Draft с локализованным пояснением для пользователя. */
export interface DraftIssue {
  severity: DraftIssueSeverity;
  code: string;
  field?: string;
  message: string;
}

/** Неразобранный исходный фрагмент остаётся доступен для ручной проверки и редактирования. */
export type DraftUnresolvedFragment = SourceRange;

/**
 * Полный неперсистентный результат предварительного разбора одной записи.
 * Он хранит предложения по полям, проверку Base↔Fish, проблемы и точные остатки исходного текста;
 * canConfirm отражает только отсутствие blocking-проблем и не выполняет сохранение CatchReport.
 */
export interface CatchReportDraft {
  rawSourceText: string;
  fields: {
    fishingBase: DraftField<DraftNamedItem>;
    location: DraftField<DraftLocation>;
    fish: DraftField<DraftNamedItem>;
    bait: DraftField<DraftBait>;
    weightGrams: DraftField<number>;
    fishingMethod: DraftField<CatchReportFishingMethod>;
    holeDepthCm: DraftField<number>;
    spotPositionRaw: DraftField<string>;
    fishingNote: DraftField<CatchReportFishingNote>;
    spinningSize: DraftField<CatchReportSpinningSize>;
    spinningSpeed: DraftField<CatchReportSpinningSpeed>;
    userNoteRaw: DraftField<string>;
  };
  baseFishMembership: {
    status: DraftStatus;
    baseId: string | null;
    fishId: string | null;
  };
  issues: DraftIssue[];
  unresolvedFragments: DraftUnresolvedFragment[];
  missingRequiredFields: string[];
  canConfirm: boolean;
}

/** Ответ одиночного preview-разбора. */
export interface ParseCatchReportResult {
  draft: CatchReportDraft;
}

/**
 * Одна строка пакетного preview с порядком, физическим номером строки и точными дублями.
 * duplicateIndexes ссылается на индексы кандидатов, а не на номера строк исходного текста.
 */
export interface CatchReportBatchDraftRow {
  index: number;
  sourceLine: number;
  duplicateIndexes: number[];
  draft: CatchReportDraft;
}

/** Упорядоченный результат пакетного разбора непустых физических строк. */
export interface ParseCatchReportBatchResult {
  rows: CatchReportBatchDraftRow[];
}

/** Создаёт успешно распознанное поле, включая допустимый null необязательного значения. */
export function resolvedField<T>(
  value: T | null,
  sourceText: string | null,
  required: boolean,
): DraftField<T> {
  return { status: 'RESOLVED', sourceText, value, required };
}

/** Отмечает отсутствующее обязательное поле, которое пользователь должен заполнить вручную. */
export function missingField<T>(): DraftField<T> {
  return { status: 'MISSING', sourceText: null, value: null, required: true };
}

/** Сохраняет исходный текст поля, которое парсер не смог разрешить однозначно. */
export function unresolvedField<T>(
  sourceText: string,
  code: string,
  required: boolean,
): DraftField<T> {
  return { status: 'UNRESOLVED', sourceText, value: null, required, code };
}
