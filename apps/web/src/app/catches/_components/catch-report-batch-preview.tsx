'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { CatchReportDraftPreview } from './catch-report-draft-preview';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import {
  type CatchReportBatchDraftRow,
  type CreateCatchReportInput,
  createCatchReportsBatch,
  type ParseCatchReportBatchResult,
} from '@/lib/catch-reports-api';

type RowErrors = Readonly<Record<number, string[]>>;

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
    () => new Map(result.rows.map((row) => [row.index, null])),
  );
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdCount, setCreatedCount] = useState<number | null>(null);

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

  const selectedRows = result.rows.filter((row) => selected.has(row.index));
  const selectedInvalidCount = selectedRows.filter((row) => inputs.get(row.index) === null).length;
  const readyCount = result.rows.filter((row) => inputs.get(row.index) !== null).length;
  const duplicateCount = result.rows.filter((row) => row.duplicateIndexes.length > 0).length;
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
        {result.rows.map((row) => (
          <BatchRow
            key={row.index}
            row={row}
            selected={selected.has(row.index)}
            valid={inputs.get(row.index) !== null}
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
      <details open={!row.draft.canConfirm}>
        <summary className={styles.batchRowSummary}>Проверить и изменить поля</summary>
        <div className={styles.batchRowEditor}>
          <CatchReportDraftPreview
            draft={row.draft}
            canSave={canSave && selected}
            embeddedBatchRow
            onCreateInputChange={updateInput}
          />
        </div>
      </details>
    </article>
  );
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

function catchCountLabel(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 14 ? 'уловов' : last === 1 ? 'улов' : last < 5 ? 'улова' : 'уловов';
  return `${value} ${suffix}`;
}
