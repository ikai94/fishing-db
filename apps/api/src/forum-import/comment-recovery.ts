import { CatchReportParserService } from '../catch-reports/parser/catch-report-parser.service.js';
import type { CatchReportDraft } from '../catch-reports/parser/catch-report-parser.types.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { CatalogSnapshot } from './catalog-source.js';
import type { CandidateIdentityBoundary } from './candidate-identity-manifest.js';
import type { StagingCandidate } from './staging.js';
import { EXTERNAL_IMPORT_KEY_PREFIX } from './identity.js';
import { FORUM83_IMPORT_KEY_PREFIX } from './forum83/constants.js';

/** Только два уже принятых пространства исторических форумных наблюдений. */
export const COMMENT_RECOVERY_PREFIXES = [EXTERNAL_IMPORT_KEY_PREFIX, FORUM83_IMPORT_KEY_PREFIX];

/** Исторические поля сверяются со staging, но никогда не предлагаются к изменению. */
export const RECOVERY_STRUCTURED_FIELDS = [
  'contributorKey',
  'fishId',
  'baitId',
  'locationId',
  'weightGrams',
  'fishingMethod',
  'holeDepthCm',
  'spotPositionRaw',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
] as const;

/** Минимальный снимок строки для сверки; внутренние ключи остаются в локальных артефактах. */
export interface RecoveryRow {
  id: string;
  importKey: string | null;
  contributorKey: string;
  fishId: string;
  baitId: string;
  locationId: string;
  weightGrams: number;
  fishingMethod: string;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: string | null;
  spinningSize: string | null;
  spinningSpeed: string | null;
  userNoteRaw: string | null;
  rawSourceText: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Проверяет полный ключ, чтобы похожие будущие пространства не попали в recovery. */
export function isHistoricalForumKey(key: string | null): key is string {
  return (
    key !== null &&
    COMMENT_RECOVERY_PREFIXES.some(
      (prefix) => key.startsWith(prefix) && /^[0-9a-f]{64}$/u.test(key.slice(prefix.length)),
    )
  );
}

/** Сверяет идентичность и сохранённую структуру без сегодняшних правил активации каталога. */
export function frozenDifferences(row: RecoveryRow, candidate: StagingCandidate): string[] {
  const expected = {
    ...candidate,
    fishId: candidate.resolution.fish.id,
    baitId: candidate.resolution.bait.id,
    locationId: candidate.resolution.location.id,
  };
  return RECOVERY_STRUCTURED_FIELDS.filter((field) => row[field] !== expected[field]);
}

/** Различает пропуск источника, повторную identity и однозначное точное совпадение. */
export function classifyRecoveryMatch(
  row: RecoveryRow,
  sources: readonly StagingCandidate[],
): { status: 'EXACT' | 'MISSING' | 'AMBIGUOUS' | 'MISMATCH'; fields: string[] } {
  if (!isHistoricalForumKey(row.importKey)) throw new Error('Out-of-scope recovery row');
  if (sources.length === 0) return { status: 'MISSING', fields: [] };
  if (sources.length !== 1) return { status: 'AMBIGUOUS', fields: ['duplicateImportKey'] };
  const candidate = sources[0];
  if (candidate === undefined || candidate.importKey !== row.importKey) {
    throw new Error('Recovery lookup did not use the exact importKey');
  }
  const fields = frozenDifferences(row, candidate);
  if (candidate.status !== 'USABLE_COMPLETE') fields.push('frozenStatus');
  return { status: fields.length === 0 ? 'EXACT' : 'MISMATCH', fields };
}

/**
 * Выделяет исходную физическую игровую строку в замороженном диапазоне.
 * У forum83 старый диапазон заканчивался первой точкой: читаем оставшийся хвост той же строки,
 * но никогда не пересекаем начало другого кандидата и не присваиваем чужую строку комментария.
 */
export function recoverySourceLine(
  body: string,
  boundary: CandidateIdentityBoundary,
  boundaries: readonly CandidateIdentityBoundary[],
  extendForum83: boolean,
): { source: string | null; reason: string | null } {
  const { startOffset: start, endOffset: end } = boundary;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end > body.length
  ) {
    return { source: null, reason: 'INVALID_SOURCE_RANGE' };
  }
  if (
    boundaries.some(
      (other) => other !== boundary && other.startOffset < end && other.endOffset > start,
    )
  ) {
    return { source: null, reason: 'OVERLAPPING_SOURCE_RANGES' };
  }
  let limit = end;
  if (extendForum83) {
    const after = body.slice(end).search(/[\r\n]/u);
    const lineEnd = after < 0 ? body.length : end + after;
    const next = boundaries
      .filter((other) => other.startOffset >= end)
      .reduce((minimum, other) => Math.min(minimum, other.startOffset), body.length);
    limit = Math.min(lineEnd, next);
  }
  const lines = body.slice(start, limit).split(/\r\n|[\r\n]/u);
  const marker = /(?<![\p{L}\p{N}])пойман(?:а|о|ы)?\s+на\s+/giu;
  const gameLines = lines.filter((line) => Array.from(line.matchAll(marker)).length > 0);
  if (gameLines.length === 0) return { source: null, reason: 'NO_GAME_LINE' };
  const source = gameLines[0];
  if (
    gameLines.length !== 1 ||
    source === undefined ||
    Array.from(source.matchAll(marker)).length !== 1
  ) {
    return { source: null, reason: 'MULTIPLE_GAME_CORES' };
  }
  return { source, reason: null };
}

/**
 * Даёт текущему сервису тот же активный каталог из одного read-only снимка, устраняя N+1.
 * Адаптер предоставляет только чтение; parseBatch использует общий pipeline приложения.
 */
export function snapshotCommentParser(
  catalog: CatalogSnapshot,
  anchors: readonly { name: string; nameNormalized: string }[],
): CatchReportParserService {
  const bases = catalog.fishingBases.filter((item) => item.isActive);
  const baseIds = new Set(bases.map((item) => item.id));
  const reader = {
    fishingBase: { findMany: () => Promise.resolve(bases) },
    fish: { findMany: () => Promise.resolve(catalog.fish.filter((item) => item.isActive)) },
    bait: { findMany: () => Promise.resolve(catalog.baits.filter((item) => item.isActive)) },
    screenAnchor: { findMany: () => Promise.resolve(anchors) },
    location: {
      findMany: () =>
        Promise.resolve(
          catalog.locations.filter((item) => item.isActive && baseIds.has(item.fishingBaseId)),
        ),
    },
    fishingBaseFish: { findMany: () => Promise.resolve(catalog.memberships) },
  };
  return new CatchReportParserService(reader as unknown as PrismaService);
}

/** Текущий parser может расходиться с историей: регистрируем значения, историю не исправляем. */
export function currentParserDifferences(row: RecoveryRow, draft: CatchReportDraft): string[] {
  const fields = draft.fields;
  const values = {
    fishId: fields.fish.value?.id ?? null,
    baitId: fields.bait.value?.id ?? null,
    locationId: fields.location.value?.id ?? null,
    weightGrams: fields.weightGrams.value,
    fishingMethod: fields.fishingMethod.value,
    holeDepthCm: fields.holeDepthCm.value,
    spotPositionRaw: fields.spotPositionRaw.value,
    fishingNote: fields.fishingNote.value,
    spinningSize: fields.spinningSize.value,
    spinningSpeed: fields.spinningSpeed.value,
  };
  return (Object.keys(values) as Array<keyof typeof values>).filter(
    (field) => row[field] !== values[field],
  );
}

/**
 * Разрешает исключительно null → валидный комментарий при совпадении обязательного ядра.
 * Необязательные наблюдения могут отличаться: это диагностика, а не причина переписывать историю.
 */
export function recoveredCommentDecision(
  row: RecoveryRow,
  draft: CatchReportDraft,
): {
  status: 'PRESERVED' | 'NO_COMMENT' | 'HELD' | 'CANDIDATE';
  note: string | null;
  reason: string | null;
} {
  if (row.userNoteRaw !== null) return { status: 'PRESERVED', note: null, reason: null };
  const comment = draft.fields.userNoteRaw;
  if (comment.status !== 'RESOLVED') {
    return {
      status: 'HELD',
      note: null,
      reason: comment.status === 'UNRESOLVED' ? comment.code : 'MISSING_COMMENT',
    };
  }
  if (comment.value === null || comment.value === '')
    return { status: 'NO_COMMENT', note: null, reason: null };
  if (
    currentParserDifferences(row, draft).some((field) =>
      ['fishId', 'baitId', 'locationId', 'weightGrams', 'fishingMethod'].includes(field),
    )
  ) {
    return { status: 'HELD', note: null, reason: 'CORE_MISMATCH' };
  }
  return { status: 'CANDIDATE', note: comment.value, reason: null };
}
