'use client';

import { useRouter } from 'next/navigation';
import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { CatchReportBatchPreview } from './catch-report-batch-preview';
import { CatchReportFormCatalogProvider } from './catch-report-form-catalog-context';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { validateBatchRawSourceText } from '@/lib/catch-report-form';
import { type ParseCatchReportBatchResult, parseCatchReportBatch } from '@/lib/catch-reports-api';

function rawOffsetForTextareaOffset(rawSourceText: string, textareaOffset: number): number {
  let rawOffset = 0;
  let displayedOffset = 0;

  while (rawOffset < rawSourceText.length && displayedOffset < textareaOffset) {
    if (rawSourceText[rawOffset] === '\r') {
      rawOffset += rawSourceText[rawOffset + 1] === '\n' ? 2 : 1;
    } else {
      rawOffset += 1;
    }
    displayedOffset += 1;
  }

  return rawOffset;
}

function displayedLength(value: string): number {
  return textareaDisplayValue(value).length;
}

function textareaDisplayValue(value: string): string {
  return value.replace(/\r\n?|\n/gu, '\n');
}

function preserveRawLineEndingsAfterTextareaEdit(
  rawSourceText: string,
  nextDisplayedText: string,
): string {
  const previousDisplayedText = textareaDisplayValue(rawSourceText);
  if (previousDisplayedText === nextDisplayedText) return rawSourceText;

  let prefixLength = 0;
  const sharedLength = Math.min(previousDisplayedText.length, nextDisplayedText.length);
  while (
    prefixLength < sharedLength &&
    previousDisplayedText[prefixLength] === nextDisplayedText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousDisplayedText.length - prefixLength &&
    suffixLength < nextDisplayedText.length - prefixLength &&
    previousDisplayedText[previousDisplayedText.length - suffixLength - 1] ===
      nextDisplayedText[nextDisplayedText.length - suffixLength - 1]
  ) {
    suffixLength += 1;
  }

  const rawPrefixEnd = rawOffsetForTextareaOffset(rawSourceText, prefixLength);
  const rawSuffixStart = rawOffsetForTextareaOffset(
    rawSourceText,
    previousDisplayedText.length - suffixLength,
  );
  const nextReplacementEnd = nextDisplayedText.length - suffixLength;

  return `${rawSourceText.slice(0, rawPrefixEnd)}${nextDisplayedText.slice(
    prefixLength,
    nextReplacementEnd,
  )}${rawSourceText.slice(rawSuffixStart)}`;
}

export function NotebookCatchEntry({ canSave }: { canSave: boolean }) {
  const router = useRouter();
  const [rawSourceText, setRawSourceText] = useState('');
  const [preview, setPreview] = useState<{
    key: number;
    result: ParseCatchReportBatchResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelectionRef = useRef<number | null>(null);
  const revisionRef = useRef(0);
  const activeRequestRef = useRef<{
    controller: AbortController;
    revision: number;
  } | null>(null);

  useEffect(
    () => () => {
      revisionRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const selection = pendingSelectionRef.current;
    if (selection === null) return;

    pendingSelectionRef.current = null;
    textareaRef.current?.setSelectionRange(selection, selection);
  }, [rawSourceText]);

  function updateSource(nextSource: string) {
    revisionRef.current += 1;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    setRawSourceText(nextSource);
    setPreview(null);
    setError(null);
    setIsParsing(false);
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text/plain');
    const selectionStart = event.currentTarget.selectionStart;
    const selectionEnd = event.currentTarget.selectionEnd;
    const rawStart = rawOffsetForTextareaOffset(rawSourceText, selectionStart);
    const rawEnd = rawOffsetForTextareaOffset(rawSourceText, selectionEnd);

    pendingSelectionRef.current = selectionStart + displayedLength(pastedText);
    updateSource(`${rawSourceText.slice(0, rawStart)}${pastedText}${rawSourceText.slice(rawEnd)}`);
  }

  async function handleParse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;

    let source: string;
    try {
      source = validateBatchRawSourceText(rawSourceText);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : 'Некорректная запись.');
      setIsParsing(false);
      return;
    }

    const controller = new AbortController();
    const request = { controller, revision };
    activeRequestRef.current = request;
    setIsParsing(true);
    setError(null);
    try {
      const parsedResult = await parseCatchReportBatch(source, controller.signal);
      if (activeRequestRef.current !== request || revisionRef.current !== revision) return;
      setPreview({ key: revision, result: parsedResult });
    } catch (parseError) {
      if (activeRequestRef.current !== request || revisionRef.current !== revision) return;
      if (isApiError(parseError) && parseError.status === 401) {
        router.replace('/login');
        return;
      }
      setError(getApiErrorMessage(parseError, 'Не удалось проверить запись. Попробуйте ещё раз.'));
    } finally {
      if (activeRequestRef.current === request && revisionRef.current === revision) {
        activeRequestRef.current = null;
        setIsParsing(false);
      }
    }
  }

  return (
    <div className={styles.previewStack}>
      <section className={`${styles.panel} ${styles.notebookPanel}`}>
        <h2 className={styles.panelTitle}>Вставьте уловы из игрового блокнота</h2>
        <p className={styles.muted}>
          Одна непустая строка — один отдельный улов. Ничего не сохранится до подтверждения пакета.
        </p>
        <form className={styles.form} onSubmit={handleParse} noValidate>
          <label className={styles.label} htmlFor="notebook-source">
            Исходные записи
          </label>
          <textarea
            ref={textareaRef}
            className={`${styles.textarea} ${styles.sourceTextarea}`}
            id="notebook-source"
            value={rawSourceText}
            onChange={(event) =>
              updateSource(
                preserveRawLineEndingsAfterTextareaEdit(rawSourceText, event.target.value),
              )
            }
            onPaste={handlePaste}
            placeholder={
              'Налим 15,88 кг. Поймана на Амур: Понтонный мост, Лягушка…\nКижуч 7,242 кг…'
            }
          />
          <p className={styles.fieldHint}>
            Каждая непустая физическая строка разбирается независимо и сохраняется точно.
          </p>
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <button className={styles.primaryButton} type="submit" disabled={isParsing}>
              {isParsing ? 'Разбираем…' : 'Разобрать'}
            </button>
          </div>
        </form>
      </section>
      {preview ? (
        <CatchReportFormCatalogProvider key={preview.key}>
          <CatchReportBatchPreview result={preview.result} canSave={canSave} />
        </CatchReportFormCatalogProvider>
      ) : null}
    </div>
  );
}
