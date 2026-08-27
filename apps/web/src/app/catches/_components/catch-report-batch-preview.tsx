'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { CatchReportDraftPreview } from './catch-report-draft-preview';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { fishingMethodLabel } from '@/lib/catch-report-form';
import {
  type CatchReportBatchDraftRow,
  type CreateCatchReportInput,
  createCatchReportsBatch,
  type ParseCatchReportBatchResult,
} from '@/lib/catch-reports-api';

type RowErrors = Readonly<Record<number, string[]>>;
const CLEAN_ROWS_PAGE_SIZE = 50;

export function CatchReportBatchPreview({
  result,
  canSave,
}: {
  result: ParseCatchReportBatchResult;
  canSave: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<number>>(
    () => new Set(result.rows.map((row) => row.index)),
  );
  const [inputs, setInputs] = useState<ReadonlyMap<number, CreateCatchReportInput | null>>(
    () => new Map(result.rows.map((row) => [row.index, createInputFromDraft(row.draft)])),
  );
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);
  const [visibleCleanCount, setVisibleCleanCount] = useState(CLEAN_ROWS_PAGE_SIZE);

  const updateInput = useCallback((rowIndex: number, input: CreateCatchReportInput | null) => {
    setInputs((current) => {
      if (current.get(rowIndex) === input) return current;
      const next = new Map(current);
      next.set(rowIndex, input);
      return next;
    });
    setRowErrors((current) => {
      if (current[rowIndex] === undefined) return current;
      const next = { ...current };
      delete next[rowIndex];
      return next;
    });
    setFormError(null);
  }, []);

  const rowIsValid = (row: CatchReportBatchDraftRow) =>
    inputs.get(row.index) !== null && (rowErrors[row.index]?.length ?? 0) === 0;
  const selectedRows = result.rows.filter((row) => selected.has(row.index));
  const selectedInvalidCount = selectedRows.filter((row) => !rowIsValid(row)).length;
  const readyCount = result.rows.filter(rowIsValid).length;
  const duplicateCount = result.rows.filter((row) => row.duplicateIndexes.length > 0).length;
  const rankedRows = result.rows
    .map((row, originalOrder) => ({ row, originalOrder }))
    .sort((left, right) => {
      const rankDifference =
        attentionRank(left.row, rowIsValid(left.row)) -
        attentionRank(right.row, rowIsValid(right.row));
      return rankDifference === 0 ? left.originalOrder - right.originalOrder : rankDifference;
    })
    .map(({ row }) => row);
  const problemRows = rankedRows.filter((row) => attentionRank(row, rowIsValid(row)) < 2);
  const cleanRows = rankedRows.filter((row) => attentionRank(row, rowIsValid(row)) === 2);
  const displayRows = [...problemRows, ...cleanRows.slice(0, visibleCleanCount)];
  const canSubmit =
    canSave && selectedRows.length > 0 && selectedInvalidCount === 0 && !isSubmitting;

  async function saveSelected() {
    if (!canSubmit) return;
    const reports: CreateCatchReportInput[] = [];
    for (const row of selectedRows) {
      const input = inputs.get(row.index);
      if (input === null || input === undefined) return;
      reports.push(input);
    }

    setIsSubmitting(true);
    setFormError(null);
    setRowErrors({});
    try {
      const created = await createCatchReportsBatch(reports);
      setCreatedCount(created.createdCount);
      router.refresh();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      setRowErrors(
        indexedBatchErrors(
          error,
          selectedRows.map((row) => row.index),
        ),
      );
      setFormError(getApiErrorMessage(error, 'Не удалось сохранить выбранные уловы.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (createdCount !== null) {
    return (
      <section className={`${styles.message} ${styles.successMessage}`} aria-live="polite">
        <h2 className={styles.forbiddenTitle}>Создано отчётов: {createdCount}</h2>
        <p>Пакет сохранён полностью. Повторная отправка этой формы отключена.</p>
        <div className={styles.inlineActions}>
          <Link className={styles.primaryLink} href="/my/catches">
            Открыть мои уловы
          </Link>
          <Link className={styles.secondaryLink} href="/catches">
            Открыть общую базу
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.batchPreview} aria-labelledby="batch-preview-title">
      <header className={styles.batchSummary} aria-live="polite">
        <div>
          <h2 className={styles.panelTitle} id="batch-preview-title">
            Предпросмотр строк
          </h2>
          <p className={styles.muted}>
            Всего: {result.rows.length}; готово: {readyCount}; выбрано: {selectedRows.length};
            требует исправления: {selectedInvalidCount}; точных дублей: {duplicateCount}.
          </p>
        </div>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!canSubmit}
          onClick={() => void saveSelected()}
        >
          {isSubmitting ? 'Сохраняем пакет…' : `Сохранить ${catchCountLabel(selectedRows.length)}`}
        </button>
      </header>

      {!canSave ? (
        <p className={`${styles.message} ${styles.warningMessage}`}>
          Черновики можно разбирать и исправлять, но сохранение заблокировано.
        </p>
      ) : null}
      {selectedRows.length === 0 ? (
        <p className={styles.formError}>Выберите хотя бы одну строку для сохранения.</p>
      ) : selectedInvalidCount > 0 ? (
        <p className={styles.formError}>Исправьте или исключите все выбранные строки с ошибками.</p>
      ) : null}
      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}

      <div className={styles.batchRows}>
        {displayRows.map((row) => (
          <BatchRow
            key={row.index}
            row={row}
            selected={selected.has(row.index)}
            valid={rowIsValid(row)}
            errors={rowErrors[row.index] ?? []}
            canSave={canSave}
            onInputChange={updateInput}
            onSelectedChange={(nextSelected) => {
              setSelected((current) => {
                const next = new Set(current);
                if (nextSelected) next.add(row.index);
                else next.delete(row.index);
                return next;
              });
              setFormError(null);
            }}
          />
        ))}
      </div>

      {cleanRows.length > visibleCleanCount ? (
        <div className={styles.formActions}>
          <p className={styles.muted}>
            Показано готовых строк: {visibleCleanCount} из {cleanRows.length}.
          </p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() =>
              setVisibleCleanCount((current) =>
                Math.min(current + CLEAN_ROWS_PAGE_SIZE, cleanRows.length),
              )
            }
          >
            Показать ещё {Math.min(CLEAN_ROWS_PAGE_SIZE, cleanRows.length - visibleCleanCount)}
          </button>
        </div>
      ) : null}

      <div className={styles.formActions}>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={!canSubmit}
          onClick={() => void saveSelected()}
        >
          {isSubmitting ? 'Сохраняем пакет…' : `Сохранить ${catchCountLabel(selectedRows.length)}`}
        </button>
      </div>
    </section>
  );
}

function BatchRow({
  row,
  selected,
  valid,
  errors,
  canSave,
  onInputChange,
  onSelectedChange,
}: {
  row: CatchReportBatchDraftRow;
  selected: boolean;
  valid: boolean;
  errors: string[];
  canSave: boolean;
  onInputChange: (rowIndex: number, input: CreateCatchReportInput | null) => void;
  onSelectedChange: (selected: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(!valid);
  const fishingMethod = resolvedValue(row.draft.fields?.fishingMethod);
  const updateInput = useCallback(
    (input: CreateCatchReportInput | null) => onInputChange(row.index, input),
    [onInputChange, row.index],
  );
  return (
    <article className={`${styles.batchRow} ${selected ? '' : styles.excludedBatchRow}`}>
      <header className={styles.batchRowHeader}>
        <label className={styles.batchSelection}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange(event.target.checked)}
          />
          Сохранить строку {row.sourceLine}
        </label>
        <span
          className={`${styles.draftStatus} ${valid ? styles.resolvedStatus : styles.unresolvedStatus}`}
        >
          {valid ? 'Готова' : 'Нужно исправить'}
        </span>
      </header>
      <p className={styles.batchRawSource}>{row.draft.rawSourceText}</p>
      {fishingMethod !== null ? (
        <p className={styles.muted}>Способ ловли: {fishingMethodLabel(fishingMethod)}</p>
      ) : null}
      {row.duplicateIndexes.length > 0 ? (
        <p className={styles.warningIssue}>
          Точная копия другой строки пакета. Строка не объединена и будет сохранена отдельно.
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul className={styles.batchRowErrors} role="alert">
          {errors.map((error, index) => (
            <li key={`${error}:${index}`}>{error}</li>
          ))}
        </ul>
      ) : null}
      {row.draft.issues.some((issue) => issue.severity === 'BLOCKING') ? (
        <ul className={styles.batchRowErrors}>
          {row.draft.issues
            .filter((issue) => issue.severity === 'BLOCKING')
            .map((issue, index) => (
              <li key={`${issue.code}:${index}`}>{issue.message}</li>
            ))}
        </ul>
      ) : null}
      {row.draft.issues.some((issue) => issue.severity === 'WARNING') ? (
        <ul className={styles.batchRowErrors}>
          {row.draft.issues
            .filter((issue) => issue.severity === 'WARNING')
            .map((issue, index) => (
              <li key={`${issue.code}:${index}`}>{issue.message}</li>
            ))}
        </ul>
      ) : null}
      <details
        open={expanded || !valid}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className={styles.batchRowSummary}>Проверить и изменить поля</summary>
        {expanded || !valid ? (
          <div className={styles.batchRowEditor}>
            <CatchReportDraftPreview
              draft={row.draft}
              canSave={canSave && selected}
              embeddedBatchRow
              onCreateInputChange={updateInput}
            />
          </div>
        ) : null}
      </details>
    </article>
  );
}

function createInputFromDraft(
  draft: CatchReportBatchDraftRow['draft'],
): CreateCatchReportInput | null {
  if (!draft.canConfirm || draft.baseFishMembership?.status !== 'RESOLVED') return null;
  const location = resolvedValue(draft.fields.location);
  const fish = resolvedValue(draft.fields.fish);
  const bait = resolvedValue(draft.fields.bait);
  const weightGrams = resolvedValue(draft.fields.weightGrams);
  const fishingMethod = resolvedValue(draft.fields.fishingMethod);
  if (
    location === null ||
    fish === null ||
    bait === null ||
    weightGrams === null ||
    fishingMethod === null
  ) {
    return null;
  }

  return {
    locationId: location.id,
    fishId: fish.id,
    baitId: bait.id,
    weightGrams,
    holeDepthCm: resolvedValue(draft.fields.holeDepthCm),
    spotPositionRaw: resolvedValue(draft.fields.spotPositionRaw),
    fishingNote: resolvedValue(draft.fields.fishingNote),
    spinningSize: resolvedValue(draft.fields.spinningSize),
    spinningSpeed: resolvedValue(draft.fields.spinningSpeed),
    userNoteRaw: resolvedValue(draft.fields.userNoteRaw),
    rawSourceText: draft.rawSourceText,
  };
}

function resolvedValue<T>(field: { status: string; value: T | null } | undefined): T | null {
  return field?.status === 'RESOLVED' ? field.value : null;
}

function indexedBatchErrors(error: unknown, originalRowIndexes: readonly number[]): RowErrors {
  if (!isApiError(error)) return {};
  const result: Record<number, string[]> = {};

  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const match = /^reports\.(\d+)(?:\.|$)/u.exec(field);
    if (match?.[1] === undefined) continue;
    const requestIndex = Number(match[1]);
    const originalIndex = originalRowIndexes[requestIndex];
    if (originalIndex === undefined) continue;
    result[originalIndex] = [...(result[originalIndex] ?? []), ...messages];
  }

  return result;
}

function attentionRank(row: CatchReportBatchDraftRow, valid: boolean): number {
  if (!valid) return 0;
  if (
    row.duplicateIndexes.length > 0 ||
    row.draft.unresolvedFragments.length > 0 ||
    row.draft.issues.some((issue) => issue.severity === 'WARNING')
  ) {
    return 1;
  }
  return 2;
}

function catchCountLabel(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 14
      ? 'уловов'
      : last === 1
        ? 'улов'
        : last >= 2 && last <= 4
          ? 'улова'
          : 'уловов';
  return `${value} ${suffix}`;
}
