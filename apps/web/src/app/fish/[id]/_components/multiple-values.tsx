'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './multiple-values.module.css';
import { getApiErrorMessage } from '@/lib/api-client';
import {
  listFishCatchValues,
  type FishCatchAggregate,
  type FishCatchValuesPage,
} from '@/lib/fish-catch-aggregates-api';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';

/** Склоняет короткую подпись раскрытия, включая 11–14 и числа больше двадцати. */
export function formatVariantsCount(count: number): string {
  const ending =
    count % 100 >= 11 && count % 100 <= 14
      ? 'вариантов'
      : count % 10 === 1
        ? 'вариант'
        : count % 10 >= 2 && count % 10 <= 4
          ? 'варианта'
          : 'вариантов';
  return `${count} ${ending}`;
}

/** Форматирует глубину, сохраняя публичный ориентир без нормализации. */
export function formatHoleValue(
  value: Exclude<FishCatchValuesPage['items'][number], string>,
): string {
  const depth =
    value.holeDepthCm === null
      ? null
      : `${formatCentimetersAsMeters(value.holeDepthCm).replace(',', '.')} м`;
  return [depth, value.spotPositionRaw].filter((part) => part !== null).join(' ');
}

/** Раскрытие работает с клавиатуры и касанием, не выходит за пределы узкой таблицы. */
export function MultipleValues({ values, label }: { values: string[]; label: string }) {
  if (!values.length) return <>—</>;
  if (values.length === 1) return <span className={styles.single}>{values[0]}</span>;
  return (
    <details className={styles.disclosure}>
      <summary aria-label={`${label}: ${formatVariantsCount(values.length)}`}>
        {formatVariantsCount(values.length)} <span aria-hidden="true">▾</span>
      </summary>
      <ul aria-label={label}>
        {values.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
    </details>
  );
}

/** Большие комментарии и пары глубина/ориентир читаются лишь при раскрытии строки. */
export function LazyCatchValues({
  row,
  field,
}: {
  row: FishCatchAggregate;
  field: 'comment' | 'hole';
}) {
  const summary = field === 'comment' ? row.userNoteRawSummary : row.holeSpotSummary;
  const loadedOffset = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<FishCatchValuesPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const label = field === 'comment' ? 'Комментарии' : 'Ямы и ориентиры';
  useEffect(() => {
    if (!open || summary.distinctCount < 2 || loadedOffset.current === offset) return;
    const controller = new AbortController();
    void listFishCatchValues(row, field, offset, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          loadedOffset.current = offset;
          setPage((current) => ({
            items: [...(offset ? (current?.items ?? []) : []), ...next.items],
            nextOffset: next.nextOffset,
          }));
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setError(getApiErrorMessage(err, 'Не удалось загрузить варианты.'));
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [row, field, offset, open, attempt, summary.distinctCount]);
  if (summary.distinctCount < 2) {
    const value = summary.value;
    return (
      <MultipleValues
        label={label}
        values={value === null ? [] : [typeof value === 'string' ? value : formatHoleValue(value)]}
      />
    );
  }
  return (
    <details className={styles.disclosure} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={`${label}: ${formatVariantsCount(summary.distinctCount)}`}>
        {formatVariantsCount(summary.distinctCount)} <span aria-hidden="true">▾</span>
      </summary>
      {page ? (
        <ul aria-label={label}>
          {page.items.map((value, index) => (
            <li key={index}>{typeof value === 'string' ? value : formatHoleValue(value)}</li>
          ))}
        </ul>
      ) : null}
      {(!page && !error) || loading ? <p role="status">Загружаем варианты…</p> : null}
      {error ? (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Повторить
          </button>
        </p>
      ) : null}
      {page?.nextOffset !== null && page?.nextOffset !== undefined && !error ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError(null);
            setOffset(page.nextOffset!);
          }}
        >
          Ещё варианты
        </button>
      ) : null}
    </details>
  );
}
