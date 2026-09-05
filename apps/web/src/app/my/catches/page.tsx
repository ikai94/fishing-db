'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import { OwnerCatchTable } from './_components/owner-catch-table';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth-api';
import { type CatchReport, deleteCatchReport, listMyCatchReports } from '@/lib/catch-reports-api';
import {
  personalCatchArchiveHref,
  readPersonalCatchArchiveFilters,
  type PersonalCatchArchiveFilters,
} from '@/lib/personal-catch-navigation';
import {
  getPersonalCatchStatistics,
  listPersonalCatchRecords,
  type PersonalCatchRecord,
  type PersonalCatchStatistics,
} from '@/lib/personal-catch-statistics-api';
import { useRequiredUser } from '@/lib/use-required-user';

type FeedState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: CatchReport[]; nextCursor: string | null };

export default function MyCatchReportsPage() {
  return (
    <Suspense fallback={<MyCatchReportsRouteFallback />}>
      <MyCatchReportsRoute />
    </Suspense>
  );
}

function MyCatchReportsRouteFallback() {
  return (
    <ApplicationShell>
      <section className={styles.page} aria-label="Личный архив">
        <p className={styles.statusMessage} aria-live="polite">
          Загружаем личный архив…
        </p>
      </section>
    </ApplicationShell>
  );
}

function MyCatchReportsRoute() {
  const userResource = useRequiredUser();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const view = searchParams.get('view') === 'statistics' ? 'statistics' : 'archive';
  const filters = readPersonalCatchArchiveFilters(searchParams);

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
          view === 'statistics' ? (
            <PersonalStatisticsContent user={userResource.state.user} searchKey={searchKey} />
          ) : (
            <MyCatchReportsContent
              key={searchKey}
              user={userResource.state.user}
              filters={filters}
            />
          )
        ) : null}
      </section>
    </ApplicationShell>
  );
}

function MyCatchReportsContent({
  user,
  filters,
}: {
  user: AuthUser;
  filters: PersonalCatchArchiveFilters;
}) {
  const router = useRouter();
  const { source, fishId, baseId, locationId, baitId } = filters;
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
        const page = await listMyCatchReports({
          source,
          fishId,
          baseId,
          locationId,
          baitId,
          limit: 20,
          signal: controller.signal,
        });
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
  }, [attempt, baitId, baseId, fishId, locationId, router, source]);

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
      const page = await listMyCatchReports({
        ...filters,
        cursor,
        limit: 20,
        signal: controller.signal,
      });
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

      <ViewNavigation active="archive" />

      {hasArchiveFilters(filters) ? (
        <div className={styles.filters} aria-label="Фильтры архива">
          {filters.source ? (
            <span className={styles.filterChip}>Только собственные отчёты</span>
          ) : null}
          {archiveFilterEntries(filters, state.kind === 'ready' ? state.items[0] : undefined).map(
            (entry) => (
              <span className={styles.filterChip} key={entry.key}>
                {entry.label}
                <Link
                  className={styles.removeFilter}
                  href={clearArchiveFilterHref(filters, entry.key)}
                  aria-label={`Убрать фильтр «${entry.label}»`}
                >
                  ×
                </Link>
              </span>
            ),
          )}
          {hasEntityArchiveFilters(filters) ? (
            <Link
              className={styles.actionLink}
              href={filters.source ? '/my/catches?source=native' : '/my/catches'}
            >
              Сбросить фильтры
            </Link>
          ) : null}
          {filters.source ? (
            <Link className={styles.actionLink} href="/my/catches">
              Весь архив
            </Link>
          ) : null}
        </div>
      ) : null}

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

type StatisticsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: PersonalCatchStatistics };
type RecordsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: PersonalCatchRecord[]; nextCursor: string | null };

function PersonalStatisticsContent({ user, searchKey }: { user: AuthUser; searchKey: string }) {
  const router = useRouter();
  const loadMoreController = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [statistics, setStatistics] = useState<StatisticsState>({ kind: 'loading' });
  const [records, setRecords] = useState<RecordsState>({ kind: 'loading' });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadMoreController.current?.abort();
    void getPersonalCatchStatistics(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setStatistics({ kind: 'ready', value });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.status === 401) return router.replace('/login');
        setStatistics({
          kind: 'error',
          message: getApiErrorMessage(error, 'Не удалось загрузить личную статистику.'),
        });
      },
    );
    void listPersonalCatchRecords({ limit: 50, signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) setRecords({ kind: 'ready', ...page });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.status === 401) return router.replace('/login');
        setRecords({
          kind: 'error',
          message: getApiErrorMessage(error, 'Не удалось загрузить личные рекорды.'),
        });
      },
    );
    return () => {
      controller.abort();
      loadMoreController.current?.abort();
    };
  }, [attempt, router, searchKey]);

  async function loadMoreRecords() {
    if (records.kind !== 'ready' || records.nextCursor === null || isLoadingMore) return;
    const controller = new AbortController();
    loadMoreController.current?.abort();
    loadMoreController.current = controller;
    setIsLoadingMore(true);
    setPaginationError(null);
    try {
      const page = await listPersonalCatchRecords({
        limit: 50,
        cursor: records.nextCursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted || loadMoreController.current !== controller) return;
      setRecords((current) =>
        current.kind === 'ready'
          ? {
              kind: 'ready',
              items: mergeRecords(current.items, page.items),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      setPaginationError(getApiErrorMessage(error, 'Не удалось загрузить следующие рекорды.'));
    } finally {
      if (loadMoreController.current === controller) {
        loadMoreController.current = null;
        setIsLoadingMore(false);
      }
    }
  }

  function retry() {
    setStatistics({ kind: 'loading' });
    setRecords({ kind: 'loading' });
    setAttempt((current) => current + 1);
  }

  return (
    <>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Личный архив</p>
          <h1 className={styles.title} id="my-catches-title">
            Статистика и рекорды
          </h1>
          <p className={styles.subtitle}>Только собственные отчёты пользователя {user.nickname}.</p>
        </div>
      </header>
      <ViewNavigation active="statistics" />

      {statistics.kind === 'loading' || records.kind === 'loading' ? (
        <p className={styles.statusMessage} aria-live="polite">
          Загружаем статистику…
        </p>
      ) : null}
      {statistics.kind === 'error' || records.kind === 'error' ? (
        <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
          <p>
            {statistics.kind === 'error'
              ? statistics.message
              : records.kind === 'error'
                ? records.message
                : ''}
          </p>
          <button className={styles.button} type="button" onClick={retry}>
            Повторить
          </button>
        </div>
      ) : null}

      {statistics.kind === 'ready' ? (
        <>
          <p className={styles.summaryLine}>
            Уловов: <strong>{statistics.value.totalCatches.toLocaleString('ru-RU')}</strong>
            {' · '}Видов рыб:{' '}
            <strong>{statistics.value.uniqueFishCount.toLocaleString('ru-RU')}</strong>
            {' · '}За всё время
          </p>
          <p className={styles.scopeNote}>Внешний импорт не учитывается.</p>
          <div className={styles.rankingsGrid}>
            <RankingTable title="Рыбы" items={statistics.value.topFish} filterKey="fishId" />
            <RankingTable title="Базы" items={statistics.value.topBases} filterKey="baseId" />
            <LocationRankingTable items={statistics.value.topLocations} />
            <RankingTable
              title="Наживки и приманки"
              items={statistics.value.topBaits}
              filterKey="baitId"
            />
          </div>
        </>
      ) : null}

      {records.kind === 'ready' ? (
        <section className={styles.recordsSection} aria-labelledby="records-title">
          <h2 id="records-title">Рекорды по рыбам</h2>
          {records.items.length === 0 ? (
            <p className={styles.statusMessage}>Личных рекордов пока нет.</p>
          ) : (
            <RecordsTable records={records.items} />
          )}
          {paginationError ? (
            <p className={styles.paginationError} role="alert">
              {paginationError}
            </p>
          ) : null}
          {records.nextCursor ? (
            <div className={styles.loadMore}>
              <button
                className={styles.button}
                type="button"
                disabled={isLoadingMore}
                onClick={() => void loadMoreRecords()}
              >
                {isLoadingMore ? 'Загружаем…' : 'Показать ещё'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function ViewNavigation({ active }: { active: 'archive' | 'statistics' }) {
  return (
    <nav className={styles.viewNavigation} aria-label="Разделы личных уловов">
      <Link aria-current={active === 'archive' ? 'page' : undefined} href="/my/catches">
        Уловы
      </Link>
      <Link
        aria-current={active === 'statistics' ? 'page' : undefined}
        href="/my/catches?view=statistics"
      >
        Статистика и рекорды
      </Link>
    </nav>
  );
}

function RankingTable({
  title,
  items,
  filterKey,
}: {
  title: string;
  items: PersonalCatchStatistics['topFish'];
  filterKey: 'fishId' | 'baseId' | 'baitId';
}) {
  return (
    <section className={styles.rankingSection}>
      <h2>{title}</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Название</th>
            <th scope="col">Уловов</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ item, reportsCount }) => (
            <tr key={item.id}>
              <th scope="row">
                <Link href={personalCatchArchiveHref({ source: 'native', [filterKey]: item.id })}>
                  {item.name}
                </Link>
                {item.isActive ? null : <span className={styles.inactive}>неактивно</span>}
              </th>
              <td>{reportsCount.toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? <p>Нет данных.</p> : null}
    </section>
  );
}

function LocationRankingTable({ items }: { items: PersonalCatchStatistics['topLocations'] }) {
  return (
    <section className={styles.rankingSection}>
      <h2>Локации</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">База · локация</th>
            <th scope="col">Уловов</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ location, fishingBase, reportsCount }) => (
            <tr key={location.id}>
              <th scope="row">
                <Link
                  href={personalCatchArchiveHref({ source: 'native', locationId: location.id })}
                >
                  {fishingBase.name} · {location.number}. {location.name}
                </Link>
                {location.isActive && fishingBase.isActive ? null : (
                  <span className={styles.inactive}>неактивно</span>
                )}
              </th>
              <td>{reportsCount.toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 ? <p>Нет данных.</p> : null}
    </section>
  );
}

function RecordsTable({ records }: { records: PersonalCatchRecord[] }) {
  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label="Таблица личных рекордов"
      tabIndex={0}
    >
      <table className={styles.recordsTable}>
        <caption className={styles.visuallyHidden}>Личные рекорды по рыбам</caption>
        <thead>
          <tr>
            <th scope="col">Рыба</th>
            <th scope="col">Максимальный вес</th>
            <th scope="col">База · локация</th>
            <th scope="col">Наживка</th>
            <th scope="col">Отчёт добавлен</th>
            <th scope="col">Отчёт</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.fish.id}>
              <th scope="row">
                {record.fish.name}
                {record.fish.isActive ? null : <span className={styles.inactive}>неактивно</span>}
              </th>
              <td>{record.maxWeightGrams.toLocaleString('ru-RU')} г</td>
              <td>
                {record.representativeReport.fishingBase.name} ·{' '}
                {record.representativeReport.location.number}.{' '}
                {record.representativeReport.location.name}
              </td>
              <td>{record.representativeReport.bait.name}</td>
              <td>
                <time dateTime={record.representativeReport.createdAt}>
                  {new Date(record.representativeReport.createdAt).toLocaleDateString('ru-RU', {
                    timeZone: 'Europe/Moscow',
                  })}
                </time>
              </td>
              <td>
                <Link href={`/catches/${record.representativeReport.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function hasArchiveFilters(filters: PersonalCatchArchiveFilters): boolean {
  return Object.values(filters).some(Boolean);
}

type EntityArchiveFilterKey = 'fishId' | 'baseId' | 'locationId' | 'baitId';

function hasEntityArchiveFilters(filters: PersonalCatchArchiveFilters): boolean {
  return Boolean(filters.fishId || filters.baseId || filters.locationId || filters.baitId);
}

function archiveFilterEntries(
  filters: PersonalCatchArchiveFilters,
  report?: CatchReport,
): Array<{ key: EntityArchiveFilterKey; label: string }> {
  const entries: Array<{ key: EntityArchiveFilterKey; label: string }> = [];
  if (filters.fishId) {
    entries.push({ key: 'fishId', label: `Рыба: ${report?.fish.name ?? filters.fishId}` });
  }
  if (filters.baseId) {
    entries.push({ key: 'baseId', label: `База: ${report?.fishingBase.name ?? filters.baseId}` });
  }
  if (filters.locationId) {
    entries.push({
      key: 'locationId',
      label: `Локация: ${
        report
          ? `${report.fishingBase.name} · ${report.location.number}. ${report.location.name}`
          : filters.locationId
      }`,
    });
  }
  if (filters.baitId) {
    entries.push({ key: 'baitId', label: `Наживка: ${report?.bait.name ?? filters.baitId}` });
  }
  return entries;
}

function clearArchiveFilterHref(
  filters: PersonalCatchArchiveFilters,
  key: EntityArchiveFilterKey,
): string {
  const next = { ...filters };
  delete next[key];
  return personalCatchArchiveHref(next);
}

function mergeRecords(
  current: PersonalCatchRecord[],
  next: PersonalCatchRecord[],
): PersonalCatchRecord[] {
  const knownFishIds = new Set(current.map((record) => record.fish.id));
  return [...current, ...next.filter((record) => !knownFishIds.has(record.fish.id))];
}

function mergeReports(current: CatchReport[], next: CatchReport[]): CatchReport[] {
  const knownIds = new Set(current.map((report) => report.id));
  return [...current, ...next.filter((report) => !knownIds.has(report.id))];
}
