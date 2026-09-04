'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import { OwnerCatchTable } from './_components/owner-catch-table';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth-api';
import { type CatchReport, deleteCatchReport, listMyCatchReports } from '@/lib/catch-reports-api';
import { useRequiredUser } from '@/lib/use-required-user';

type FeedState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: CatchReport[]; nextCursor: string | null };

export default function MyCatchReportsPage() {
  const userResource = useRequiredUser();

  return (
    <ApplicationShell>
      <section className={styles.page} aria-labelledby="my-catches-title">
        {userResource.state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Проверяем аккаунт…
          </p>
        ) : null}

        {userResource.state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>{userResource.state.message}</p>
            <button className={styles.button} type="button" onClick={userResource.reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {userResource.state.kind === 'ready' ? (
          <MyCatchReportsContent user={userResource.state.user} />
        ) : null}
      </section>
    </ApplicationShell>
  );
}

function MyCatchReportsContent({ user }: { user: AuthUser }) {
  const router = useRouter();
  const [state, setState] = useState<FeedState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const loadMoreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitialPage() {
      try {
        const page = await listMyCatchReports({ limit: 20, signal: controller.signal });
        setState({ kind: 'ready', items: page.items, nextCursor: page.nextCursor });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (isApiError(error) && error.status === 401) {
          router.replace('/login');
          return;
        }

        setState({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить ваши уловы. Попробуйте ещё раз.',
          ),
        });
      }
    }

    void loadInitialPage();
    return () => controller.abort();
  }, [attempt, router]);

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
      const page = await listMyCatchReports({ cursor, limit: 20, signal: controller.signal });
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
      if (controller.signal.aborted) {
        return;
      }

      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      setPaginationError(
        getApiErrorMessage(error, 'Не удалось загрузить следующую страницу. Попробуйте ещё раз.'),
      );
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setIsLoadingMore(false);
      }
    }
  }

  async function handleDelete(report: CatchReport) {
    if (user.isBanned || deletingId !== null) {
      return;
    }

    if (!window.confirm(`Удалить отчёт об улове «${report.fish.name}»? Это действие необратимо.`)) {
      return;
    }

    setDeletingId(report.id);
    setMutationError(null);

    try {
      await deleteCatchReport(report.id);
      setState((current) =>
        current.kind === 'ready'
          ? { ...current, items: current.items.filter((item) => item.id !== report.id) }
          : current,
      );
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.code === 'ACCOUNT_BANNED') {
        setMutationError('Аккаунт заблокирован. Удаление публичных уловов недоступно.');
      } else if (isApiError(error) && error.code === 'CATCH_REPORT_NOT_FOUND') {
        setMutationError('Отчёт уже удалён. Обновите список.');
      } else if (isApiError(error) && error.code === 'CATCH_REPORT_NOT_OWNED') {
        setMutationError('Этот отчёт больше не принадлежит текущему аккаунту.');
      } else {
        setMutationError(
          getApiErrorMessage(error, 'Не удалось удалить отчёт. Попробуйте ещё раз.'),
        );
      }
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Личный архив</p>
          <h1 className={styles.title} id="my-catches-title">
            Мои уловы
          </h1>
          <p className={styles.subtitle}>
            Публичные отчёты пользователя {user.nickname}. Их можно открыть, изменить или удалить.
          </p>
        </div>
        <div>
          {user.isBanned ? (
            <button className={styles.button} type="button" disabled>
              Добавление недоступно
            </button>
          ) : (
            <Link className={styles.primaryLink} href="/catches/new">
              Добавить улов
            </Link>
          )}
        </div>
      </header>

      {user.isBanned ? (
        <p className={`${styles.statusMessage} ${styles.warningMessage}`} role="status">
          Аккаунт заблокирован. Ваши прежние отчёты доступны для чтения, но создание, редактирование
          и удаление отключены.
        </p>
      ) : null}

      {mutationError ? (
        <p className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
          {mutationError}
        </p>
      ) : null}

      {state.kind === 'loading' ? (
        <p className={styles.statusMessage} aria-live="polite">
          Загружаем ваши уловы…
        </p>
      ) : null}

      {state.kind === 'error' ? (
        <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
          <p>{state.message}</p>
          <button className={styles.button} type="button" onClick={retry}>
            Повторить
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && state.items.length === 0 && state.nextCursor === null ? (
        <div className={styles.statusMessage}>
          <p>У вас пока нет опубликованных уловов.</p>
          {!user.isBanned ? (
            <Link className={styles.primaryLink} href="/catches/new">
              Добавить первый улов
            </Link>
          ) : null}
        </div>
      ) : null}

      {state.kind === 'ready' && state.items.length > 0 ? (
        <OwnerCatchTable
          reports={state.items}
          isBanned={user.isBanned}
          deletingId={deletingId}
          onDelete={(report) => void handleDelete(report)}
        />
      ) : null}

      {state.kind === 'ready' && paginationError ? (
        <p className={styles.paginationError} role="alert">
          {paginationError}
        </p>
      ) : null}

      {state.kind === 'ready' && state.nextCursor !== null ? (
        <div className={styles.loadMore}>
          <button
            className={styles.button}
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
  );
}

function mergeReports(current: CatchReport[], next: CatchReport[]): CatchReport[] {
  const knownIds = new Set(current.map((report) => report.id));
  return [...current, ...next.filter((report) => !knownIds.has(report.id))];
}
