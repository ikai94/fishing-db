'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import styles from '../catch-reports.module.css';
import { CatchReportList } from './_components/catch-report-list';
import { getApiErrorMessage } from '@/lib/api-client';
import { type CatchReport, listCatchReports } from '@/lib/catch-reports-api';

type FeedState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: CatchReport[]; nextCursor: string | null };

export default function CatchReportsPage() {
  const [state, setState] = useState<FeedState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialPage() {
      try {
        const page = await listCatchReports({ limit: 20, signal: controller.signal });
        setState({ kind: 'ready', items: page.items, nextCursor: page.nextCursor });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setState({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить отчёты об уловах. Попробуйте ещё раз.',
          ),
        });
      }
    }

    void loadInitialPage();
    return () => controller.abort();
  }, [attempt]);

  useEffect(
    () => () => {
      loadMoreController.current?.abort();
    },
    [],
  );

  function retry() {
    setState({ kind: 'loading' });
    setPaginationError(null);
    setAttempt((current) => current + 1);
  }

  async function loadMore() {
    if (state.kind !== 'ready' || state.nextCursor === null || isLoadingMore) {
      return;
    }

    const cursor = state.nextCursor;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setIsLoadingMore(true);
    setPaginationError(null);

    try {
      const page = await listCatchReports({ cursor, limit: 20, signal: controller.signal });

      setState((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              items: mergeReports(current.items, page.items),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        setPaginationError(
          getApiErrorMessage(error, 'Не удалось загрузить следующую страницу. Попробуйте ещё раз.'),
        );
      }
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setIsLoadingMore(false);
      }
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Навигация по уловам">
          <Link className={styles.backLink} href="/">
            ← На главную
          </Link>
          <div className={styles.pageActions}>
            <Link className={styles.secondaryLink} href="/my/catches">
              Мои уловы
            </Link>
            <Link className={styles.primaryLink} href="/catches/new">
              Добавить улов
            </Link>
          </div>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Совместная база</p>
          <h1 className={styles.title}>Уловы игроков</h1>
          <p className={styles.subtitle}>
            Публичные отчёты о рыбах, местах, наживках и найденных ямках.
          </p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем уловы…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' && state.items.length === 0 ? (
          <div className={styles.message}>
            <p>Публичных отчётов пока нет. Можно добавить первый улов.</p>
            <Link className={styles.primaryLink} href="/catches/new">
              Добавить улов
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' && state.items.length > 0 ? (
          <>
            <CatchReportList reports={state.items} />
            {paginationError ? (
              <p className={styles.paginationError} role="alert">
                {paginationError}
              </p>
            ) : null}
            {state.nextCursor !== null ? (
              <div className={styles.loadMore}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  aria-busy={isLoadingMore}
                >
                  {isLoadingMore ? 'Загружаем…' : 'Показать ещё'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function mergeReports(current: CatchReport[], next: CatchReport[]): CatchReport[] {
  const knownIds = new Set(current.map((report) => report.id));
  return [...current, ...next.filter((report) => !knownIds.has(report.id))];
}
