'use client';

import { useRouter } from 'next/navigation';
import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { CatchReportDraftPreview } from './catch-report-draft-preview';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { validateRawSourceText } from '@/lib/catch-report-form';
import { type CatchReportDraft, parseCatchReport } from '@/lib/catch-reports-api';

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
  const [draft, setDraft] = useState<CatchReportDraft | null>(null);
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
    setDraft(null);
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
      source = validateRawSourceText(rawSourceText);
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
      const parsedDraft = await parseCatchReport(source, controller.signal);
      if (activeRequestRef.current !== request || revisionRef.current !== revision) return;
      setDraft(parsedDraft);
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
        <h2 className={styles.panelTitle}>Вставьте запись из игрового блокнота</h2>
        <p className={styles.muted}>
          Сначала мы покажем черновик. Ничего не сохранится до вашего подтверждения.
        </p>
        <form className={styles.form} onSubmit={handleParse} noValidate>
          <label className={styles.label} htmlFor="notebook-source">
            Исходная запись
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
            placeholder="Шамбардия Валберга 40 грамм…"
          />
          <p className={styles.fieldHint}>
            Исходник сохранится точно, но будет доступен только вам.
          </p>
          {error ? (
            <p className={styles.formError} role="alert">
              {error}
            </p>
          ) : null}
          <div className={styles.formActions}>
            <button className={styles.primaryButton} type="submit" disabled={isParsing}>
              {isParsing ? 'Проверяем…' : 'Проверить'}
            </button>
          </div>
        </form>
      </section>
      {draft ? <CatchReportDraftPreview draft={draft} canSave={canSave} /> : null}
    </div>
  );
}
