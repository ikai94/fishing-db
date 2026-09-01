'use client';

import { useCallback } from 'react';
import styles from './application-shell.module.css';
import { getCatalogSummary } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

const countFormatter = new Intl.NumberFormat('ru-RU');

export function SidebarStatistics() {
  const loadSummary = useCallback((signal: AbortSignal) => getCatalogSummary(signal), []);
  const { state, reload } = useApiResource(loadSummary, 'Не удалось загрузить статистику.');
  const summary = state.kind === 'ready' ? state.data : null;
  const unavailable = state.kind === 'error' || state.kind === 'not-found';

  return (
    <section className={styles.statistics} aria-label="Статистика базы">
      <dl className={styles.statisticsList} aria-busy={state.kind === 'loading'} aria-live="polite">
        <div>
          <dt>Рыб внесено</dt>
          <dd>{summary === null ? '—' : countFormatter.format(summary.catchReportsCount)}</dd>
        </div>
        <div>
          <dt>Пользователей</dt>
          <dd>{summary === null ? '—' : countFormatter.format(summary.registeredUsersCount)}</dd>
        </div>
      </dl>
      {unavailable ? (
        <button
          className={styles.compactRetry}
          type="button"
          onClick={reload}
          title={state.kind === 'error' ? state.message : undefined}
        >
          Повторить
        </button>
      ) : null}
    </section>
  );
}
