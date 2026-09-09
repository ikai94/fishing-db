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
  MUTANT: 'Мутант',
  MAX_UNKNOWN: 'Нет данных о max',
};

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
  const rows = useMemo(
    () => (state.kind === 'ready' ? sortRecords(state.data.items, sort) : []),
    [sort, state],
  );

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
    const defaultDirection: RecordsSortDirection = key === 'name' ? 'asc' : 'desc';
    const direction =
      sort.key === key ? (sort.direction === 'asc' ? 'desc' : 'asc') : defaultDirection;
    router.replace(`/records?${recordsSortSearch({ key, direction })}`, { scroll: false });
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
            sortKey={sort.key}
            sortDirection={sort.direction}
            onSort={setSort}
            onReset={() => router.replace('/records', { scroll: false })}
          />
        ) : null}
      </div>
    </ApplicationShell>
  );
}

type TableProps = {
  data: RecordsResponse;
  rows: RecordsItem[];
  sortKey: RecordsSortKey;
  sortDirection: RecordsSortDirection;
  onSort: (key: Exclude<RecordsSortKey, 'default'>) => void;
  onReset: () => void;
};

function RecordsTable({ data, rows, sortKey, sortDirection, onSort, onReset }: TableProps) {
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
        <button
          className={styles.resetButton}
          type="button"
          disabled={sortKey === 'default'}
          onClick={onReset}
        >
          Сбросить сортировку
        </button>
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
              <th scope="col">Где пойман</th>
              <th scope="col">Игрок/дата</th>
              <th scope="col">Наш max</th>
              <th scope="col">База(ы) max</th>
              <SortableHeader
                label="Запас"
                sortName="headroom"
                activeKey={sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
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
  sortName: 'name' | 'weight' | 'headroom';
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
        <Link className={styles.fishLink} href={`/fish/${row.fish.id}`}>
          {row.fish.name}
        </Link>
      </th>
      <td>{recordWeight(row)}</td>
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
      <td className={styles.numeric}>
        {row.normalMaxWeightGrams === null ? '—' : formatCompactWeight(row.normalMaxWeightGrams)}
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
      <td className={styles.numeric}>{formatHeadroom(row)}</td>
      <td>
        <span className={`${styles.status} ${statusClass(row.status)}`}>
          {row.status === null ? '—' : STATUS_LABELS[row.status]}
        </span>
      </td>
    </tr>
  );
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
    row.headroomGrams === null
      ? styles.badgeNeutral
      : row.headroomGrams > 10
        ? styles.badgeGreen
        : row.headroomGrams >= 0
          ? styles.badgeYellow
          : styles.badgeRed;
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
  if (status === 'NEAR_MAX') return styles.statusYellow;
  if (status === 'MUTANT') return styles.statusRed;
  return styles.statusNeutral;
}
