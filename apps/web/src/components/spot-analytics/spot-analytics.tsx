'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './spot-analytics.module.css';
import { getApiErrorMessage } from '@/lib/api-client';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';
import {
  listSpotEvidence,
  listSpotStatistics,
  type SpotEvidencePage,
  type SpotStatistic,
  type SpotStatisticsPage,
  type SpotStatisticsScope,
} from '@/lib/spot-statistics-api';

const PAGE_SIZE = 25;
const EVIDENCE_PAGE_SIZE = 25;

type LoadState =
  | { kind: 'loading'; requestKey: string }
  | { kind: 'error'; requestKey: string; message: string }
  | { kind: 'ready'; requestKey: string; page: SpotStatisticsPage };

export function SpotAnalytics({
  scope,
  showPlace,
  showFishCount,
  disabled = false,
}: {
  scope: SpotStatisticsScope;
  showPlace: boolean;
  showFishCount: boolean;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  const fishId = scope.kind === 'fish' ? scope.fishId : undefined;
  const locationId = scope.kind === 'location' ? scope.locationId : undefined;
  const baseIdsKey = scope.kind === 'fish' ? [...new Set(scope.baseIds)].sort().join(',') : '';
  const fishIdsKey =
    scope.kind === 'location' && scope.fishIds !== undefined
      ? [...new Set(scope.fishIds)].sort().join(',')
      : undefined;
  const scopeKey = `${scope.kind}:${fishId ?? ''}:${locationId ?? ''}:${baseIdsKey}:${fishIdsKey ?? '*'}`;
  const requestKey = `${scopeKey}:${offset}:${attempt}`;
  const [state, setState] = useState<LoadState>({ kind: 'loading', requestKey });
  const [previousScopeKey, setPreviousScopeKey] = useState(scopeKey);
  if (previousScopeKey !== scopeKey) {
    setPreviousScopeKey(scopeKey);
    setOffset(0);
    setExpandedGroupKey(null);
  }

  useEffect(() => {
    if (disabled) return;

    const controller = new AbortController();
    const requestScope: SpotStatisticsScope =
      fishId !== undefined
        ? { kind: 'fish', fishId, baseIds: baseIdsKey === '' ? [] : baseIdsKey.split(',') }
        : {
            kind: 'location',
            locationId: locationId as string,
            ...(fishIdsKey === undefined
              ? {}
              : { fishIds: fishIdsKey === '' ? [] : fishIdsKey.split(',') }),
          };
    void listSpotStatistics({
      scope: requestScope,
      limit: PAGE_SIZE,
      offset,
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) setState({ kind: 'ready', requestKey, page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          requestKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить статистику ям и точек. Попробуйте ещё раз.',
          ),
        });
      });
    return () => controller.abort();
  }, [baseIdsKey, disabled, fishId, fishIdsKey, locationId, offset, requestKey]);

  const headingId = `spot-analytics-${scope.kind}`;
  const currentState: LoadState =
    state.requestKey === requestKey ? state : { kind: 'loading', requestKey };
  const page = currentState.kind === 'ready' ? currentState.page : null;

  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      aria-busy={!disabled && currentState.kind === 'loading'}
    >
      <details>
        <summary className={styles.summary}>
          <span className={styles.title} id={headingId} role="heading" aria-level={2}>
            Ямы и точки
          </span>
          {page !== null && page.totalGroups > 0 ? (
            <span className={styles.pageCount}>
              {offset + 1}–{Math.min(offset + page.items.length, page.totalGroups)} из{' '}
              {page.totalGroups.toLocaleString('ru-RU')}
            </span>
          ) : null}
        </summary>

        <div className={styles.content}>
          {disabled ? <p className={styles.status}>Выберите хотя бы одну рыбу.</p> : null}
          {!disabled && currentState.kind === 'loading' ? (
            <p className={styles.status} role="status">
              Загружаем статистику ям и точек…
            </p>
          ) : null}
          {!disabled && currentState.kind === 'error' ? (
            <div className={`${styles.status} ${styles.error}`} role="alert">
              <p>{currentState.message}</p>
              <button
                className={styles.button}
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {!disabled && page !== null ? (
            <>
              <p className={styles.coverage}>
                Отчётов в выборке: {page.scopedReportsCount.toLocaleString('ru-RU')} · без глубины и
                позиции: {page.unlocatedReportsCount.toLocaleString('ru-RU')}
              </p>
              {page.items.length === 0 ? (
                <p className={styles.status}>
                  Для выбранной области нет наблюдений с глубиной или позицией.
                </p>
              ) : (
                <SpotTable
                  expandedGroupKey={expandedGroupKey}
                  items={page.items}
                  startNumber={offset + 1}
                  scope={scope}
                  showFishCount={showFishCount}
                  showPlace={showPlace}
                  onToggleEvidence={(groupKey) =>
                    setExpandedGroupKey((current) => (current === groupKey ? null : groupKey))
                  }
                />
              )}
              {page.totalGroups > PAGE_SIZE ? (
                <nav className={styles.pagination} aria-label="Страницы статистики ям и точек">
                  <button
                    className={styles.button}
                    type="button"
                    disabled={offset === 0}
                    onClick={() => {
                      setExpandedGroupKey(null);
                      setOffset((value) => Math.max(0, value - PAGE_SIZE));
                    }}
                  >
                    Назад
                  </button>
                  <button
                    className={styles.button}
                    type="button"
                    disabled={offset + page.items.length >= page.totalGroups}
                    onClick={() => {
                      setExpandedGroupKey(null);
                      setOffset((value) => value + PAGE_SIZE);
                    }}
                  >
                    Далее
                  </button>
                </nav>
              ) : null}
            </>
          ) : null}
        </div>
      </details>
    </section>
  );
}

function SpotTable({
  items,
  scope,
  showPlace,
  showFishCount,
  expandedGroupKey,
  startNumber,
  onToggleEvidence,
}: {
  items: readonly SpotStatistic[];
  scope: SpotStatisticsScope;
  showPlace: boolean;
  showFishCount: boolean;
  expandedGroupKey: string | null;
  startNumber: number;
  onToggleEvidence: (groupKey: string) => void;
}) {
  const columnCount = 7 + Number(showPlace) + Number(showFishCount);
  return (
    <div className={styles.tableRegion} role="region" aria-label="Таблица ям и точек" tabIndex={0}>
      <table aria-label="Таблица ям и точек" className={styles.table}>
        <thead>
          <tr>
            <th scope="col">№</th>
            {showPlace ? <th scope="col">База · Локация</th> : null}
            <th scope="col">Глубина</th>
            <th scope="col">Позиция</th>
            <th scope="col">Рыбаков</th>
            <th scope="col">Уловов</th>
            {showFishCount ? <th scope="col">Рыб</th> : null}
            <th scope="col">Топ наживок / приманок</th>
            <th scope="col">Добавлено</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <SpotRows
              columnCount={columnCount}
              expanded={expandedGroupKey === item.groupKey}
              item={item}
              key={item.groupKey}
              number={startNumber + index}
              onToggle={() => onToggleEvidence(item.groupKey)}
              scope={scope}
              showFishCount={showFishCount}
              showPlace={showPlace}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpotRows({
  item,
  number,
  scope,
  showPlace,
  showFishCount,
  expanded,
  columnCount,
  onToggle,
}: {
  item: SpotStatistic;
  number: number;
  scope: SpotStatisticsScope;
  showPlace: boolean;
  showFishCount: boolean;
  expanded: boolean;
  columnCount: number;
  onToggle: () => void;
}) {
  return (
    <>
      <tr>
        <th className={styles.number} scope="row">
          {number}
        </th>
        {showPlace ? <td>{formatPlace(item)}</td> : null}
        <td className={styles.numeric}>
          {item.holeDepthCm === null ? (
            <span className={styles.muted}>не указана</span>
          ) : (
            `${formatCentimetersAsMeters(item.holeDepthCm)} м`
          )}
        </td>
        <td>{item.spotPosition ?? <span className={styles.muted}>не указана</span>}</td>
        <td className={styles.numeric}>{item.contributorCount.toLocaleString('ru-RU')}</td>
        <td className={styles.numeric}>
          <button
            className={styles.evidenceButton}
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            {item.reportsCount.toLocaleString('ru-RU')}
          </button>
        </td>
        {showFishCount ? (
          <td className={styles.numeric}>{item.fishCount.toLocaleString('ru-RU')}</td>
        ) : null}
        <td>{formatTopBaits(item)}</td>
        <td className={styles.date}>
          <time dateTime={item.latestReportCreatedAt}>
            {formatDate(item.latestReportCreatedAt)}
          </time>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.evidenceRow}>
          <td colSpan={columnCount}>
            <SpotEvidence groupKey={item.groupKey} scope={scope} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function formatPlace(item: SpotStatistic) {
  const baseActive = item.fishingBase.isActive;
  const locationActive = baseActive && item.location.isActive;
  return (
    <>
      {baseActive ? (
        <Link className={styles.tableLink} href={`/bases/${item.fishingBase.id}`}>
          {item.fishingBase.name}
        </Link>
      ) : (
        item.fishingBase.name
      )}
      {', '}
      {locationActive ? (
        <Link className={styles.tableLink} href={`/locations/${item.location.id}`}>
          {item.location.number}. {item.location.name}
        </Link>
      ) : (
        <>
          {item.location.number}. {item.location.name}
        </>
      )}
    </>
  );
}

function formatTopBaits(item: SpotStatistic): string {
  if (item.topBaits.length === 0) return '—';
  return item.topBaits
    .map((entry) => `${entry.bait.name} — ${entry.contributorCount}/${entry.reportsCount}`)
    .join('; ');
}

function SpotEvidence({ scope, groupKey }: { scope: SpotStatisticsScope; groupKey: string }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; page: SpotEvidencePage }
  >({ kind: 'loading' });
  const [items, setItems] = useState<SpotEvidencePage['items']>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void listSpotEvidence({
      scope,
      groupKey,
      limit: EVIDENCE_PAGE_SIZE,
      cursor,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems((current) => (cursor === undefined ? page.items : [...current, ...page.items]));
        setState({ kind: 'ready', page });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: getApiErrorMessage(error, 'Не удалось загрузить исходные наблюдения.'),
        });
      });
    return () => controller.abort();
  }, [attempt, cursor, groupKey, scope]);

  if (state.kind === 'loading' && items.length === 0)
    return <p className={styles.evidenceStatus}>Загружаем наблюдения…</p>;
  if (state.kind === 'error')
    return (
      <div className={styles.evidence} role="alert">
        <p className={styles.evidenceError}>{state.message}</p>
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          Повторить загрузку наблюдений
        </button>
      </div>
    );

  return (
    <div className={styles.evidence}>
      <table className={styles.evidenceTable}>
        <thead>
          <tr>
            <th>Отчёт</th>
            <th>Рыба</th>
            <th>Вес</th>
            <th>Наживка / приманка</th>
            <th>Автор</th>
            <th>Дата</th>
          </tr>
        </thead>
        <tbody>
          {items.map((report) => (
            <tr key={report.id}>
              <td>
                <Link className={styles.tableLink} href={`/catches/${report.id}`}>
                  Открыть
                </Link>
              </td>
              <td>{report.fish.name}</td>
              <td className={styles.numeric}>{formatCompactWeight(report.weightGrams)}</td>
              <td>{report.bait.name}</td>
              <td>{report.author.nickname}</td>
              <td className={styles.date}>
                <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {state.kind === 'loading' ? <p className={styles.evidenceStatus}>Загружаем ещё…</p> : null}
      {state.kind === 'ready' && state.page.nextCursor !== null ? (
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            setState({ kind: 'loading' });
            setCursor(state.page.nextCursor ?? undefined);
          }}
        >
          Показать ещё
        </button>
      ) : null}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        timeZone: 'Europe/Moscow',
      });
}
