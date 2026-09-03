'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from '../../../public-catalog.module.css';
import { getApiErrorMessage } from '@/lib/api-client';
import { type BaitStatistic, listBaitStatistics } from '@/lib/bait-statistics-api';
import { formatBaseFishWeightBounds } from '@/lib/base-fish-weight';
import type { PublicFishDetail } from '@/lib/catalog-api';
import { type FishCatchAggregate, listFishCatchAggregates } from '@/lib/fish-catch-aggregates-api';
import { readFishBaseSelection, writeFishBaseSelection } from '@/lib/fish-base-selection';
import {
  type FishingConditionStatistic,
  listFishingConditionStatistics,
} from '@/lib/fishing-condition-statistics-api';
import { type HoleStatistic, listHoleStatistics } from '@/lib/hole-statistics-api';
import { BaitStatisticsList } from './bait-statistics-list';
import { CommonHoleTable } from './common-hole-table';
import { FishingConditionStatisticsTable } from './fishing-condition-statistics-table';
import { PublicFishCatchTable } from './public-fish-catch-table';

const AGGREGATE_PAGE_SIZE = 20;

type FeedState =
  | { kind: 'idle'; scopeKey: string }
  | { kind: 'loading'; scopeKey: string }
  | {
      kind: 'ready';
      scopeKey: string;
      items: FishCatchAggregate[];
      nextCursor: string | null;
    }
  | { kind: 'error'; scopeKey: string; message: string };

type HoleStatisticsState =
  | { kind: 'idle'; scopeKey: string }
  | { kind: 'loading'; scopeKey: string }
  | { kind: 'ready'; scopeKey: string; items: HoleStatistic[] }
  | { kind: 'error'; scopeKey: string; message: string };

type BaitStatisticsState =
  | { kind: 'idle'; scopeKey: string }
  | { kind: 'loading'; scopeKey: string }
  | { kind: 'ready'; scopeKey: string; items: BaitStatistic[] }
  | { kind: 'error'; scopeKey: string; message: string };

type FishingConditionStatisticsState =
  | { kind: 'idle'; scopeKey: string }
  | { kind: 'loading'; scopeKey: string }
  | { kind: 'ready'; scopeKey: string; items: FishingConditionStatistic[] }
  | { kind: 'error'; scopeKey: string; message: string };

type ActiveRequest = {
  controller: AbortController;
  revision: number;
  scopeKey: string;
};

export function FishExplorer({ fish }: { fish: PublicFishDetail }) {
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const availableBaseIds = useMemo(() => fish.bases.map((base) => base.id), [fish.bases]);
  const urlSelection = readFishBaseSelection(availableBaseIds, searchParams);
  const explorerKey = `${fish.id}:${availableBaseIds.join(',')}`;

  return (
    <FishExplorerState
      key={explorerKey}
      fish={fish}
      availableBaseIds={availableBaseIds}
      urlSelection={urlSelection}
      searchKey={searchKey}
    />
  );
}

function FishExplorerState({
  fish,
  availableBaseIds,
  urlSelection,
  searchKey,
}: {
  fish: PublicFishDetail;
  availableBaseIds: string[];
  urlSelection: string[];
  searchKey: string;
}) {
  const router = useRouter();
  const [previousSearchKey, setPreviousSearchKey] = useState(searchKey);
  const [selectedBaseIds, setSelectedBaseIds] = useState(urlSelection);
  const [hasChangedScope, setHasChangedScope] = useState(false);

  if (previousSearchKey !== searchKey) {
    setPreviousSearchKey(searchKey);
    if (!sameSelection(selectedBaseIds, urlSelection)) setHasChangedScope(true);
    setSelectedBaseIds(urlSelection);
  }

  const selectedKey = useMemo(
    () => [...new Set(selectedBaseIds)].sort().join(','),
    [selectedBaseIds],
  );
  const canonicalSelectedBaseIds = useMemo(
    () => (selectedKey.length === 0 ? [] : selectedKey.split(',')),
    [selectedKey],
  );
  const scopeKey = `${fish.id}:${selectedKey}`;
  const selectedSet = useMemo(() => new Set(canonicalSelectedBaseIds), [canonicalSelectedBaseIds]);

  function updateSelection(nextIds: Iterable<string>) {
    const nextSet = new Set(nextIds);
    const nextSelection = availableBaseIds.filter((id) => nextSet.has(id));
    const nextSearch = writeFishBaseSelection(searchKey, availableBaseIds, nextSelection);
    const path = `/fish/${encodeURIComponent(fish.id)}${nextSearch ? `?${nextSearch}` : ''}`;

    if (!sameSelection(selectedBaseIds, nextSelection)) setHasChangedScope(true);
    setSelectedBaseIds(nextSelection);
    router.replace(path, { scroll: false });
  }

  function toggleBase(baseId: string) {
    const next = new Set(selectedSet);
    if (next.has(baseId)) next.delete(baseId);
    else next.add(baseId);
    updateSelection(next);
  }

  return (
    <div className={styles.fishExplorerLayout}>
      <aside className={styles.fishExplorerSidebar} aria-label="Фильтр по базам">
        <BaseMembershipSelector
          bases={fish.bases}
          selectedBaseIds={selectedSet}
          onToggle={toggleBase}
          onSelectAll={() => updateSelection(availableBaseIds)}
          onClearAll={() => updateSelection([])}
        />
      </aside>

      <div className={styles.fishExplorerContent}>
        <FishConditionStatistics
          key={`fishing-condition-statistics:${scopeKey}`}
          fishId={fish.id}
          selectedBaseIds={canonicalSelectedBaseIds}
          scopeKey={scopeKey}
          loadingMessage={
            hasChangedScope
              ? 'Обновляем статистику условий ловли…'
              : 'Загружаем статистику условий ловли…'
          }
        />

        <FishBaitStatistics
          key={`bait-statistics:${scopeKey}`}
          fishId={fish.id}
          selectedBaseIds={canonicalSelectedBaseIds}
          scopeKey={scopeKey}
          loadingMessage={
            hasChangedScope
              ? 'Обновляем статистику наживок и приманок…'
              : 'Загружаем статистику наживок и приманок…'
          }
        />

        <FishHoleStatistics
          key={`statistics:${scopeKey}`}
          fishId={fish.id}
          selectedBaseIds={canonicalSelectedBaseIds}
          scopeKey={scopeKey}
          loadingMessage={hasChangedScope ? 'Обновляем статистику…' : 'Загружаем статистику…'}
        />

        <FishReportFeed
          key={`reports:${scopeKey}`}
          fishId={fish.id}
          selectedBaseIds={canonicalSelectedBaseIds}
          scopeKey={scopeKey}
          loadingMessage={hasChangedScope ? 'Обновляем уловы…' : 'Загружаем уловы…'}
        />
      </div>
    </div>
  );
}

function BaseMembershipSelector({
  bases,
  selectedBaseIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  bases: PublicFishDetail['bases'];
  selectedBaseIds: ReadonlySet<string>;
  onToggle: (baseId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const idPrefix = useId().replace(/:/g, '');
  const selectedCount = selectedBaseIds.size;

  return (
    <fieldset className={styles.membershipFieldset}>
      <legend>Базы обитания</legend>
      <div className={styles.membershipToolbar}>
        <div className={styles.navGroup}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onSelectAll}
            disabled={bases.length === 0 || selectedCount === bases.length}
          >
            Выбрать все
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onClearAll}
            disabled={selectedCount === 0}
          >
            Снять все
          </button>
        </div>
        <p className={styles.metadata} aria-live="polite">
          {selectedCount === 0 ? 'Все базы' : `Выбрано ${selectedCount} из ${bases.length}`}
        </p>
      </div>

      {bases.length === 0 ? (
        <p className={styles.statusMessage}>Активных баз обитания пока нет.</p>
      ) : (
        <ul className={styles.membershipGrid}>
          {bases.map((base, index) => {
            const checkboxId = `${idPrefix}-base-${index}`;
            return (
              <li className={styles.membershipItem} key={base.id}>
                <label className={styles.checkboxControl} htmlFor={checkboxId}>
                  <input
                    className={styles.checkbox}
                    id={checkboxId}
                    type="checkbox"
                    checked={selectedBaseIds.has(base.id)}
                    onChange={() => onToggle(base.id)}
                  />
                  <span className={styles.visuallyHidden}>Учитывать базу «{base.name}»</span>
                </label>
                <Link className={styles.entityLink} href={`/bases/${base.id}`}>
                  {base.name}
                </Link>
                <span className={styles.membershipWeight}>{formatBaseFishWeightBounds(base)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export function FishConditionStatistics({
  fishId,
  selectedBaseIds,
  scopeKey,
  loadingMessage = 'Загружаем статистику условий ловли…',
}: {
  fishId: string;
  selectedBaseIds: readonly string[];
  scopeKey: string;
  loadingMessage?: string;
}) {
  const revisionRef = useRef(0);
  const requestRef = useRef<ActiveRequest | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FishingConditionStatisticsState>(() => ({
    kind: 'loading',
    scopeKey,
  }));

  useEffect(() => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    requestRef.current?.controller.abort();
    requestRef.current = null;

    const controller = new AbortController();
    const request = { controller, revision, scopeKey };
    requestRef.current = request;

    async function loadStatistics() {
      try {
        const items = await listFishingConditionStatistics({
          fishId,
          baseIds: [...selectedBaseIds],
          signal: controller.signal,
        });
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({ kind: 'ready', scopeKey, items });
      } catch (error) {
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({
          kind: 'error',
          scopeKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить статистику условий ловли. Попробуйте ещё раз.',
          ),
        });
      } finally {
        if (isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) {
          requestRef.current = null;
        }
      }
    }

    void loadStatistics();
    return () => {
      controller.abort();
      if (requestRef.current === request) requestRef.current = null;
    };
  }, [attempt, fishId, scopeKey, selectedBaseIds]);

  useEffect(
    () => () => {
      revisionRef.current += 1;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    },
    [],
  );

  function retry() {
    setState({ kind: 'loading', scopeKey });
    setAttempt((current) => current + 1);
  }

  const currentState = state.scopeKey === scopeKey ? state : null;
  const isLoading = currentState === null || currentState.kind === 'loading';

  return (
    <section
      className={styles.resultsRegion}
      aria-labelledby="fish-fishing-condition-statistics-heading"
      aria-busy={isLoading}
    >
      <details className={styles.conditionDisclosure}>
        <summary className={styles.conditionDisclosureSummary}>
          <span className={styles.sectionTitle} id="fish-fishing-condition-statistics-heading">
            Условия ловли в уловах
          </span>
        </summary>
        <div className={styles.conditionDisclosureContent}>
          {isLoading ? (
            <p className={styles.statusMessage} role="status">
              {loadingMessage}
            </p>
          ) : null}

          {currentState?.kind === 'error' ? (
            <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
              <p>{currentState.message}</p>
              <button className={styles.secondaryButton} type="button" onClick={retry}>
                Повторить загрузку статистики условий ловли
              </button>
            </div>
          ) : null}

          {currentState?.kind === 'ready' && currentState.items.length === 0 ? (
            <p className={styles.statusMessage}>
              Для выбранного охвата данных об условиях ловли пока нет.
            </p>
          ) : null}

          {currentState?.kind === 'ready' && currentState.items.length > 0 ? (
            <FishingConditionStatisticsTable items={currentState.items} />
          ) : null}
        </div>
      </details>
    </section>
  );
}

export function FishBaitStatistics({
  fishId,
  selectedBaseIds,
  scopeKey,
  loadingMessage = 'Загружаем статистику наживок и приманок…',
}: {
  fishId: string;
  selectedBaseIds: readonly string[];
  scopeKey: string;
  loadingMessage?: string;
}) {
  const revisionRef = useRef(0);
  const requestRef = useRef<ActiveRequest | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<BaitStatisticsState>(() => ({
    kind: 'loading',
    scopeKey,
  }));

  useEffect(() => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    requestRef.current?.controller.abort();
    requestRef.current = null;

    const controller = new AbortController();
    const request = { controller, revision, scopeKey };
    requestRef.current = request;

    async function loadStatistics() {
      try {
        const items = await listBaitStatistics({
          fishId,
          baseIds: [...selectedBaseIds],
          signal: controller.signal,
        });
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({ kind: 'ready', scopeKey, items });
      } catch (error) {
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({
          kind: 'error',
          scopeKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить статистику наживок и приманок. Попробуйте ещё раз.',
          ),
        });
      } finally {
        if (isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) {
          requestRef.current = null;
        }
      }
    }

    void loadStatistics();
    return () => {
      controller.abort();
      if (requestRef.current === request) requestRef.current = null;
    };
  }, [attempt, fishId, scopeKey, selectedBaseIds]);

  useEffect(
    () => () => {
      revisionRef.current += 1;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    },
    [],
  );

  function retry() {
    setState({ kind: 'loading', scopeKey });
    setAttempt((current) => current + 1);
  }

  const currentState = state.scopeKey === scopeKey ? state : null;
  const isLoading = currentState === null || currentState.kind === 'loading';

  return (
    <section
      className={styles.resultsRegion}
      aria-labelledby="fish-bait-statistics-heading"
      aria-busy={isLoading}
    >
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="fish-bait-statistics-heading">
          На что ловится
        </h2>
      </div>

      {isLoading ? (
        <p className={styles.statusMessage} role="status">
          {loadingMessage}
        </p>
      ) : null}

      {currentState?.kind === 'error' ? (
        <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
          <p>{currentState.message}</p>
          <button className={styles.secondaryButton} type="button" onClick={retry}>
            Повторить загрузку статистики наживок и приманок
          </button>
        </div>
      ) : null}

      {currentState?.kind === 'ready' && currentState.items.length === 0 ? (
        <p className={styles.statusMessage}>
          Для выбранного охвата данных о наживках и приманках пока нет.
        </p>
      ) : null}

      {currentState?.kind === 'ready' && currentState.items.length > 0 ? (
        <BaitStatisticsList items={currentState.items} />
      ) : null}
    </section>
  );
}

export function FishHoleStatistics({
  fishId,
  selectedBaseIds,
  scopeKey,
  loadingMessage = 'Загружаем статистику…',
}: {
  fishId: string;
  selectedBaseIds: readonly string[];
  scopeKey: string;
  loadingMessage?: string;
}) {
  const revisionRef = useRef(0);
  const requestRef = useRef<ActiveRequest | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<HoleStatisticsState>(() => ({
    kind: 'loading',
    scopeKey,
  }));

  useEffect(() => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    requestRef.current?.controller.abort();
    requestRef.current = null;

    const controller = new AbortController();
    const request = { controller, revision, scopeKey };
    requestRef.current = request;

    async function loadStatistics() {
      try {
        const items = await listHoleStatistics({
          fishId,
          baseIds: selectedBaseIds,
          signal: controller.signal,
        });
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({ kind: 'ready', scopeKey, items });
      } catch (error) {
        if (!isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) return;
        setState({
          kind: 'error',
          scopeKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить статистику точек. Попробуйте ещё раз.',
          ),
        });
      } finally {
        if (isCurrentRequest(requestRef.current, request, scopeKey, revisionRef.current)) {
          requestRef.current = null;
        }
      }
    }

    void loadStatistics();
    return () => {
      controller.abort();
      if (requestRef.current === request) requestRef.current = null;
    };
  }, [attempt, fishId, scopeKey, selectedBaseIds]);

  useEffect(
    () => () => {
      revisionRef.current += 1;
      requestRef.current?.controller.abort();
      requestRef.current = null;
    },
    [],
  );

  function retry() {
    setState({ kind: 'loading', scopeKey });
    setAttempt((current) => current + 1);
  }

  const currentState = state.scopeKey === scopeKey ? state : null;
  const isLoading = currentState === null || currentState.kind === 'loading';

  return (
    <section
      className={styles.resultsRegion}
      aria-labelledby="fish-hole-statistics-heading"
      aria-busy={isLoading}
    >
      <details className={styles.conditionDisclosure}>
        <summary className={styles.conditionDisclosureSummary}>
          <span className={styles.sectionTitle} id="fish-hole-statistics-heading">
            Общие ямы и точки
          </span>
        </summary>
        <div className={styles.conditionDisclosureContent}>
          {isLoading ? (
            <p className={styles.statusMessage} role="status">
              {loadingMessage}
            </p>
          ) : null}

          {currentState?.kind === 'error' ? (
            <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
              <p>{currentState.message}</p>
              <button className={styles.secondaryButton} type="button" onClick={retry}>
                Повторить загрузку статистики
              </button>
            </div>
          ) : null}

          {currentState?.kind === 'ready' && currentState.items.length === 0 ? (
            <p className={styles.statusMessage}>Для выбранных баз пока недостаточно данных.</p>
          ) : null}

          {currentState?.kind === 'ready' && currentState.items.length > 0 ? (
            <CommonHoleTable items={currentState.items} />
          ) : null}
        </div>
      </details>
    </section>
  );
}

export function FishReportFeed({
  fishId,
  selectedBaseIds,
  scopeKey,
  loadingMessage = 'Загружаем уловы…',
}: {
  fishId: string;
  selectedBaseIds: readonly string[];
  scopeKey: string;
  loadingMessage?: string;
}) {
  const revisionRef = useRef(0);
  const initialRequestRef = useRef<ActiveRequest | null>(null);
  const loadMoreRequestRef = useRef<ActiveRequest | null>(null);
  const paginationSentinelRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<FeedState>(() => ({ kind: 'loading', scopeKey }));
  const [loadingMoreScope, setLoadingMoreScope] = useState<string | null>(null);
  const [paginationError, setPaginationError] = useState<{
    scopeKey: string;
    message: string;
  } | null>(null);
  const isLoadingMore = loadingMoreScope === scopeKey;

  useEffect(() => {
    const revision = revisionRef.current + 1;
    revisionRef.current = revision;
    initialRequestRef.current?.controller.abort();
    loadMoreRequestRef.current?.controller.abort();
    initialRequestRef.current = null;
    loadMoreRequestRef.current = null;

    const controller = new AbortController();
    const request = { controller, revision, scopeKey };
    initialRequestRef.current = request;

    async function loadInitialPage() {
      try {
        const page = await listFishCatchAggregates({
          fishId,
          baseIds: [...selectedBaseIds],
          limit: AGGREGATE_PAGE_SIZE,
          signal: controller.signal,
        });
        if (!isCurrentRequest(initialRequestRef.current, request, scopeKey, revisionRef.current))
          return;
        setState({
          kind: 'ready',
          scopeKey,
          items: page.items,
          nextCursor: page.nextCursor,
        });
      } catch (error) {
        if (!isCurrentRequest(initialRequestRef.current, request, scopeKey, revisionRef.current))
          return;
        setState({
          kind: 'error',
          scopeKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить уловы этой рыбы. Попробуйте ещё раз.',
          ),
        });
      } finally {
        if (isCurrentRequest(initialRequestRef.current, request, scopeKey, revisionRef.current)) {
          initialRequestRef.current = null;
        }
      }
    }

    void loadInitialPage();
    return () => {
      controller.abort();
      if (initialRequestRef.current === request) initialRequestRef.current = null;
    };
  }, [attempt, fishId, scopeKey, selectedBaseIds]);

  useEffect(
    () => () => {
      revisionRef.current += 1;
      initialRequestRef.current?.controller.abort();
      loadMoreRequestRef.current?.controller.abort();
      initialRequestRef.current = null;
      loadMoreRequestRef.current = null;
    },
    [],
  );

  function retry() {
    setState({ kind: 'loading', scopeKey });
    setAttempt((current) => current + 1);
  }

  const loadMore = useCallback(async () => {
    if (
      state.kind !== 'ready' ||
      state.scopeKey !== scopeKey ||
      state.nextCursor === null ||
      loadMoreRequestRef.current !== null
    ) {
      return;
    }

    const controller = new AbortController();
    const request = { controller, revision: revisionRef.current, scopeKey };
    const cursor = state.nextCursor;
    loadMoreRequestRef.current = request;
    setLoadingMoreScope(scopeKey);
    setPaginationError(null);

    try {
      const page = await listFishCatchAggregates({
        fishId,
        baseIds: [...selectedBaseIds],
        cursor,
        limit: AGGREGATE_PAGE_SIZE,
        signal: controller.signal,
      });
      if (!isCurrentRequest(loadMoreRequestRef.current, request, scopeKey, revisionRef.current))
        return;
      setState((current) =>
        current.kind === 'ready' && current.scopeKey === scopeKey
          ? {
              kind: 'ready',
              scopeKey,
              items: mergeAggregateRows(current.items, page.items),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (error) {
      if (!isCurrentRequest(loadMoreRequestRef.current, request, scopeKey, revisionRef.current))
        return;
      setPaginationError({
        scopeKey,
        message: getApiErrorMessage(
          error,
          'Не удалось загрузить следующую страницу. Попробуйте ещё раз.',
        ),
      });
    } finally {
      if (isCurrentRequest(loadMoreRequestRef.current, request, scopeKey, revisionRef.current)) {
        loadMoreRequestRef.current = null;
        setLoadingMoreScope((current) => (current === scopeKey ? null : current));
      }
    }
  }, [fishId, scopeKey, selectedBaseIds, state]);

  const currentState = state.scopeKey === scopeKey ? state : null;
  const currentPaginationError =
    paginationError?.scopeKey === scopeKey ? paginationError.message : null;
  const isRefreshing = currentState === null || currentState.kind === 'loading';

  useEffect(() => {
    if (
      currentState?.kind !== 'ready' ||
      currentState.nextCursor === null ||
      isLoadingMore ||
      currentPaginationError !== null ||
      paginationSentinelRef.current === null ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '240px 0px' },
    );
    observer.observe(paginationSentinelRef.current);

    return () => observer.disconnect();
  }, [currentPaginationError, currentState, isLoadingMore, loadMore]);

  return (
    <section
      className={styles.resultsRegion}
      aria-labelledby="fish-catches-heading"
      aria-busy={isRefreshing || isLoadingMore}
    >
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle} id="fish-catches-heading">
          Уловы
        </h2>
      </div>

      {currentState === null || currentState.kind === 'loading' ? (
        <p className={styles.statusMessage} role="status">
          {loadingMessage}
        </p>
      ) : null}

      {currentState?.kind === 'error' ? (
        <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
          <p>{currentState.message}</p>
          <button className={styles.secondaryButton} type="button" onClick={retry}>
            Повторить
          </button>
        </div>
      ) : null}

      {currentState?.kind === 'ready' && currentState.items.length === 0 ? (
        <p className={styles.statusMessage}>Для выбранных баз уловов пока нет.</p>
      ) : null}

      {currentState?.kind === 'ready' && currentState.items.length > 0 ? (
        <>
          <PublicFishCatchTable rows={currentState.items} />
          {currentPaginationError ? (
            <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
              <p>{currentPaginationError}</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => void loadMore()}
              >
                Повторить загрузку
              </button>
            </div>
          ) : null}
          {currentState.nextCursor !== null ? (
            <div
              ref={paginationSentinelRef}
              className={styles.paginationSentinel}
              data-fish-catch-pagination-sentinel=""
              aria-hidden="true"
            />
          ) : null}
          {isLoadingMore ? (
            <p className={styles.paginationStatus} role="status">
              Загружаем ещё…
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function isCurrentRequest(
  activeRequest: ActiveRequest | null,
  request: ActiveRequest,
  currentScopeKey: string,
  currentRevision: number,
): boolean {
  return (
    activeRequest === request &&
    request.revision === currentRevision &&
    request.scopeKey === currentScopeKey
  );
}

function aggregateIdentity(row: FishCatchAggregate): string {
  return [row.fish.id, row.fishingBase.id, row.location.id, row.bait.id].join('\0');
}

function mergeAggregateRows(
  current: FishCatchAggregate[],
  next: FishCatchAggregate[],
): FishCatchAggregate[] {
  const knownIds = new Set(current.map(aggregateIdentity));
  return [...current, ...next.filter((row) => !knownIds.has(aggregateIdentity(row)))];
}

function sameSelection(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length && current.every((id, index) => id === next[index]);
}
