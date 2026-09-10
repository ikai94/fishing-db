'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo } from 'react';
import styles from './records.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import {
  getRecords,
  type RecordsItem,
  type RecordsResponse,
  type RecordsStatus,
} from '@/lib/records-api';
import {
  readRecordsSort,
  recordsSortSearch,
  sortRecords,
  type RecordsSortDirection,
  type RecordsSortKey,
} from '@/lib/records-sort';
import { useApiResource } from '@/lib/use-api-resource';

const DATE_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const STATUS_LABELS: Record<Exclude<RecordsStatus, null>, string> = {
  NO_RECORD: 'Нет рекорда',
  CAN_BEAT: 'Можно побить',
  NEAR_MAX: 'Почти максимум',
  MAXIMUM: 'Максимал',
  MUTANT: 'Мутант',
  MAX_UNKNOWN: 'Нет данных о max',
};
const BASE_FILTER_PARAM = 'baseId';
const STATUS_FILTER_PARAM = 'status';
const HIDE_RAREST_FILTER_PARAM = 'hideRarest';
const FILTERABLE_STATUSES = [
  'MUTANT',
  'NEAR_MAX',
  'CAN_BEAT',
  'MAXIMUM',
] as const satisfies readonly Exclude<RecordsStatus, 'NO_RECORD' | 'MAX_UNKNOWN' | null>[];
type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];

export default function RecordsPage() {
  return (
    <Suspense
      fallback={
        <ApplicationShell>
          <p>Загружаем рекорды…</p>
        </ApplicationShell>
      }
    >
      <RecordsContent />
    </Suspense>
  );
}

function RecordsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const load = useCallback((signal: AbortSignal) => getRecords(signal), []);
  const { state, reload } = useApiResource(
    load,
    'Не удалось загрузить рекорды. Попробуйте ещё раз.',
  );
  const sort = readRecordsSort(searchParams);
  const selectedStatuses = useMemo(() => readStatusFilters(searchParams), [searchParams]);
  const hideRarest = searchParams.get(HIDE_RAREST_FILTER_PARAM) === 'true';
  const baseOptions = useMemo(
    () => (state.kind === 'ready' ? caughtAtBaseOptions(state.data.items) : []),
    [state],
  );
  const selectedBaseId = baseOptions.some((base) => base.id === searchParams.get(BASE_FILTER_PARAM))
    ? (searchParams.get(BASE_FILTER_PARAM) ?? '')
    : '';
  const rows = useMemo(() => {
    if (state.kind !== 'ready') return [];
    const baseFiltered =
      selectedBaseId === ''
        ? state.data.items
        : state.data.items.filter((item) => item.record?.fishingBase?.id === selectedBaseId);
    const statusFiltered =
      selectedStatuses.length === 0
        ? baseFiltered
        : baseFiltered.filter(
            (item) =>
              item.status !== null && selectedStatuses.includes(item.status as FilterableStatus),
          );
    const rarityFiltered = hideRarest
      ? statusFiltered.filter((item) => !item.fish.isRarest)
      : statusFiltered;
    return sortRecords(rarityFiltered, sort);
  }, [hideRarest, selectedBaseId, selectedStatuses, sort, state]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const delay =
      new Date(state.data.week.endsAt).getTime() - new Date(state.data.week.serverNow).getTime();
    if (delay <= 0) {
      reload();
      return;
    }
    const timer = setTimeout(reload, Math.min(delay + 250, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [reload, state]);

  function setSort(key: Exclude<RecordsSortKey, 'default'>) {
    const defaultDirection: RecordsSortDirection =
      key === 'name' || key === 'maxBase' || key === 'fishingBase' ? 'asc' : 'desc';
    const direction =
      sort.key === key ? (sort.direction === 'asc' ? 'desc' : 'asc') : defaultDirection;
    const params = new URLSearchParams(searchParams.toString());
    const sortParams = new URLSearchParams(recordsSortSearch({ key, direction }));
    params.set('sort', sortParams.get('sort')!);
    params.set('direction', sortParams.get('direction')!);
    router.replace(recordsHref(params), { scroll: false });
  }

  function setBaseFilter(baseId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (baseId === '') params.delete(BASE_FILTER_PARAM);
    else params.set(BASE_FILTER_PARAM, baseId);
    router.replace(recordsHref(params), { scroll: false });
  }

  function setStatusFilter(status: FilterableStatus, selected: boolean) {
    const nextStatuses = new Set(selectedStatuses);
    if (selected) nextStatuses.add(status);
    else nextStatuses.delete(status);
    const params = new URLSearchParams(searchParams.toString());
    params.delete(STATUS_FILTER_PARAM);
    for (const option of FILTERABLE_STATUSES) {
      if (nextStatuses.has(option)) params.append(STATUS_FILTER_PARAM, option);
    }
    router.replace(recordsHref(params), { scroll: false });
  }

  function setHideRarest(hidden: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (hidden) params.set(HIDE_RAREST_FILTER_PARAM, 'true');
    else params.delete(HIDE_RAREST_FILTER_PARAM);
    router.replace(recordsHref(params), { scroll: false });
  }

  function resetSort() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('sort');
    params.delete('direction');
    router.replace(recordsHref(params), { scroll: false });
  }

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <ShellIcon name="records" />
            </span>
            <h1>Рекорды</h1>
          </div>
          <p>
            Официальные рекорды текущей недели и запас до нормального максимума в нашем каталоге.
          </p>
        </header>
        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем рекорды…
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.error}`} role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}
        {state.kind === 'ready' ? (
          <RecordsTable
            data={state.data}
            rows={rows}
            baseOptions={baseOptions}
            selectedBaseId={selectedBaseId}
            selectedStatuses={selectedStatuses}
            hideRarest={hideRarest}
            sortKey={sort.key}
            sortDirection={sort.direction}
            onBaseFilter={setBaseFilter}
            onStatusFilter={setStatusFilter}
            onHideRarest={setHideRarest}
            onSort={setSort}
            onReset={resetSort}
          />
        ) : null}
      </div>
    </ApplicationShell>
  );
}

type TableProps = {
  data: RecordsResponse;
  rows: RecordsItem[];
  baseOptions: Array<{ id: string; name: string }>;
  selectedBaseId: string;
  selectedStatuses: readonly FilterableStatus[];
  hideRarest: boolean;
  sortKey: RecordsSortKey;
  sortDirection: RecordsSortDirection;
  onBaseFilter: (baseId: string) => void;
  onStatusFilter: (status: FilterableStatus, selected: boolean) => void;
  onHideRarest: (hidden: boolean) => void;
  onSort: (key: Exclude<RecordsSortKey, 'default'>) => void;
  onReset: () => void;
};

function RecordsTable({
  data,
  rows,
  baseOptions,
  selectedBaseId,
  selectedStatuses,
  hideRarest,
  sortKey,
  sortDirection,
  onBaseFilter,
  onStatusFilter,
  onHideRarest,
  onSort,
  onReset,
}: TableProps) {
  const syncMessage =
    data.sync.status === 'WAITING'
      ? 'Ожидаем данные новой недели. Старые рекорды не показываются.'
      : data.sync.status === 'STALE'
        ? 'Показан последний снимок недели; очередное обновление не удалось.'
        : data.sync.lastSuccessAt
          ? `Проверено ${DATE_FORMATTER.format(new Date(data.sync.lastSuccessAt))} МСК`
          : null;
  return (
    <section aria-label="Рекорды недели">
      <div className={styles.toolbar}>
        <div>
          <strong>Порядок:</strong> {sortKey === 'default' ? 'Проще поставить' : 'пользовательский'}{' '}
          · Рыб: {rows.length}
        </div>
        <div className={styles.toolbarControls}>
          <label className={styles.baseFilter} htmlFor="records-base-filter">
            <span>Где пойман</span>
            <select
              id="records-base-filter"
              value={selectedBaseId}
              onChange={(event) => onBaseFilter(event.target.value)}
            >
              <option value="">Все базы</option>
              {baseOptions.map((base) => (
                <option key={base.id} value={base.id}>
                  {base.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.statusFilter}>
            <span id="records-status-filter-label">Статус</span>
            <div
              className={styles.statusOptions}
              role="group"
              aria-labelledby="records-status-filter-label"
            >
              {FILTERABLE_STATUSES.map((status) => (
                <label className={styles.statusOption} key={status}>
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={(event) => onStatusFilter(status, event.target.checked)}
                  />
                  <span>{STATUS_LABELS[status]}</span>
                </label>
              ))}
            </div>
          </div>
          <label className={styles.rarityFilter}>
            <input
              type="checkbox"
              checked={hideRarest}
              onChange={(event) => onHideRarest(event.target.checked)}
            />
            <span>Скрыть редчайших</span>
          </label>
          <button
            className={styles.resetButton}
            type="button"
            disabled={sortKey === 'default'}
            onClick={onReset}
          >
            Сбросить сортировку
          </button>
        </div>
      </div>
      {syncMessage ? (
        <p
          className={`${styles.syncMessage} ${data.sync.status === 'STALE' ? styles.syncWarning : ''}`}
          role={data.sync.status === 'STALE' ? 'status' : undefined}
        >
          {syncMessage}
        </p>
      ) : null}
      <div
        className={styles.tableRegion}
        role="region"
        aria-label="Таблица официальных рекордов"
        tabIndex={0}
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <SortableHeader
                label="Рыба"
                sortName="name"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Рекорд недели"
                sortName="weight"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <th scope="col">Наш max</th>
              <SortableHeader
                label="Запас"
                sortName="headroom"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="Где пойман"
                sortName="fishingBase"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label="База(ы) max"
                sortName="maxBase"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
              <th scope="col">Игрок/дата</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RecordRow key={row.fish.id} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  sortName,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortName: Exclude<RecordsSortKey, 'default'>;
  activeKey: RecordsSortKey;
  direction: RecordsSortDirection;
  onSort: TableProps['onSort'];
}) {
  const active = activeKey === sortName;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button className={styles.sortButton} type="button" onClick={() => onSort(sortName)}>
        {label}
        <span aria-hidden="true">{active ? (direction === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function RecordRow({ row }: { row: RecordsItem }) {
  return (
    <tr>
      <th scope="row">
        <Link
          className={`${styles.fishLink} ${row.fish.isRarest ? styles.rarestFishLink : ''}`}
          href={`/fish/${row.fish.id}`}
        >
          {row.fish.name}
          {row.fish.isRarest ? (
            <span className={styles.rarestDot} aria-hidden="true" title="Редчайший вид" />
          ) : null}
        </Link>
      </th>
      <td>{recordWeight(row)}</td>
      <td className={styles.numeric}>
        {row.normalMaxWeightGrams === null ? '—' : formatCompactWeight(row.normalMaxWeightGrams)}
      </td>
      <td className={styles.numeric}>{formatHeadroom(row)}</td>
      <td>
        {row.record ? (
          row.record.fishingBase?.isActive ? (
            <Link className={styles.baseLink} href={`/bases/${row.record.fishingBase.id}`}>
              {row.record.waterbody}
            </Link>
          ) : (
            row.record.waterbody
          )
        ) : (
          '—'
        )}
      </td>
      <td>
        {row.maxBases.length === 0
          ? '—'
          : row.maxBases.map((base, index) => (
              <span key={base.id}>
                {index > 0 ? ', ' : ''}
                {base.isActive ? (
                  <Link className={styles.baseLink} href={`/bases/${base.id}`}>
                    {base.name}
                  </Link>
                ) : (
                  base.name
                )}
              </span>
            ))}
      </td>
      <td>
        {row.record ? (
          <>
            <span className={styles.player}>{row.record.playerName}</span>
            <span className={styles.secondary}>
              {DATE_FORMATTER.format(new Date(row.record.caughtAt))}
            </span>
          </>
        ) : (
          '—'
        )}
      </td>
      <td>
        <span className={`${styles.status} ${statusClass(row.status)}`}>
          {row.status === null ? '—' : STATUS_LABELS[row.status]}
        </span>
      </td>
    </tr>
  );
}

function caughtAtBaseOptions(items: readonly RecordsItem[]): Array<{ id: string; name: string }> {
  const bases = new Map<string, string>();
  for (const item of items) {
    const base = item.record?.fishingBase;
    if (base !== null && base !== undefined) bases.set(base.id, base.name);
  }
  return [...bases]
    .map(([id, name]) => ({ id, name }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'ru-RU') || left.id.localeCompare(right.id),
    );
}

function readStatusFilters(search: Pick<URLSearchParams, 'getAll'>): FilterableStatus[] {
  const requested = new Set(search.getAll(STATUS_FILTER_PARAM));
  return FILTERABLE_STATUSES.filter((status) => requested.has(status));
}

function recordsHref(params: URLSearchParams): string {
  const search = params.toString();
  return search === '' ? '/records' : `/records?${search}`;
}

function recordWeight(row: RecordsItem) {
  if (row.state === 'UNKNOWN')
    return <span className={`${styles.recordBadge} ${styles.badgeNeutral}`}>Ожидаем данные</span>;
  if (row.state === 'NO_RECORD')
    return (
      <span className={`${styles.recordBadge} ${styles.badgeNeutral}`}>
        Рекорд ещё не установлен
      </span>
    );
  const badge =
    row.status === 'CAN_BEAT'
      ? styles.badgeGreen
      : row.status === 'NEAR_MAX' || row.status === 'MAXIMUM'
        ? styles.badgeYellow
        : row.status === 'MUTANT'
          ? styles.badgeRed
          : styles.badgeNeutral;
  return (
    <span className={`${styles.recordBadge} ${badge}`}>
      {formatCompactWeight(row.record!.weightGrams)}
    </span>
  );
}

function formatHeadroom(row: RecordsItem): string {
  if (row.headroomGrams === null || row.headroomPercent === null) return '—';
  const sign = row.headroomGrams > 0 ? '+' : row.headroomGrams < 0 ? '−' : '';
  const percentSign = row.headroomPercent > 0 ? '+' : row.headroomPercent < 0 ? '−' : '';
  const weight = row.headroomGrams === 0 ? '0 г' : formatCompactWeight(Math.abs(row.headroomGrams));
  return `${sign}${weight} · ${percentSign}${Math.abs(row.headroomPercent).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;
}

function statusClass(status: RecordsStatus): string {
  if (status === 'CAN_BEAT') return styles.statusGreen;
  if (status === 'NEAR_MAX' || status === 'MAXIMUM') return styles.statusYellow;
  if (status === 'MUTANT') return styles.statusRed;
  return styles.statusNeutral;
}
