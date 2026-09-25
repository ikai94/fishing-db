'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './records.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import { getCurrentUser } from '@/lib/auth-api';
import { getApiErrorMessage } from '@/lib/api-client';
import { addFavoriteFish, getFavoriteFish, removeFavoriteFish } from '@/lib/fish-favorites-api';
import {
  clearAdminWrongMaxIssue,
  getAdminRecordNotes,
  getAdminWrongMaxIssues,
  getRecords,
  type AdminWrongMaxIssue,
  type RecordsItem,
  type RecordsResponse,
  type RecordsStatus,
  updateAdminNightMark,
  updateAdminRecordNote,
  updateAdminWrongMaxIssue,
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
const FAVORITES_FILTER_PARAM = 'favorites';
const NIGHT_FILTER_PARAM = 'night';
const WRONG_MAX_FILTER_PARAM = 'wrongMax';
const FILTERABLE_STATUSES = [
  'MUTANT',
  'NEAR_MAX',
  'CAN_BEAT',
  'MAXIMUM',
] as const satisfies readonly Exclude<RecordsStatus, 'NO_RECORD' | 'MAX_UNKNOWN' | null>[];
type FilterableStatus = (typeof FILTERABLE_STATUSES)[number];
type AdminNotesState =
  | { kind: 'checking' }
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'ready'; notes: Record<string, string> }
  | { kind: 'error'; message: string };
type FavoriteFishState =
  | { kind: 'checking' }
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      fishIds: ReadonlySet<string>;
      pendingFishIds: ReadonlySet<string>;
      error: string | null;
    };
type WrongMaxIssuesState =
  | { kind: 'checking' }
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; issues: ReadonlyMap<string, AdminWrongMaxIssue> };
type NoteActionIconName = 'add' | 'edit' | 'save' | 'cancel';

/** Рисует компактную декоративную иконку действия без отдельной зависимости. */
function NoteActionIcon({ name }: { name: NoteActionIconName }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      {name === 'add' ? <path d="M12 5v14M5 12h14" /> : null}
      {name === 'edit' ? (
        <>
          <path d="m4 20 4.25-1 10.5-10.5a2.12 2.12 0 0 0-3-3L5.25 16Z" />
          <path d="m14.5 6.5 3 3" />
        </>
      ) : null}
      {name === 'save' ? <path d="m5 12 4 4 10-10" /> : null}
      {name === 'cancel' ? <path d="m6 6 12 12M18 6 6 18" /> : null}
    </svg>
  );
}

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
  const [adminNotes, setAdminNotes] = useState<AdminNotesState>({ kind: 'checking' });
  const [favoriteFish, setFavoriteFish] = useState<FavoriteFishState>({ kind: 'checking' });
  const [wrongMaxIssues, setWrongMaxIssues] = useState<WrongMaxIssuesState>({ kind: 'checking' });
  const [nightOverrides, setNightOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [pendingNightFishIds, setPendingNightFishIds] = useState<ReadonlySet<string>>(new Set());
  const [nightMarkError, setNightMarkError] = useState<string | null>(null);
  const pendingFavoriteIds = useRef(new Set<string>());
  const pendingNightIds = useRef(new Set<string>());
  const sort = readRecordsSort(searchParams);
  const selectedStatuses = useMemo(() => readStatusFilters(searchParams), [searchParams]);
  const hideRarest = searchParams.get(HIDE_RAREST_FILTER_PARAM) === 'true';
  const favoritesOnly = searchParams.get(FAVORITES_FILTER_PARAM) === 'true';
  const nightOnly = searchParams.get(NIGHT_FILTER_PARAM) === 'true';
  const wrongMaxOnly = searchParams.get(WRONG_MAX_FILTER_PARAM) === 'true';
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
    const favoritesFiltered =
      favoritesOnly && favoriteFish.kind === 'ready'
        ? rarityFiltered.filter((item) => favoriteFish.fishIds.has(item.fish.id))
        : rarityFiltered;
    const nightFiltered = nightOnly
      ? favoritesFiltered.filter(
          (item) => nightOverrides.get(item.fish.id) ?? item.fish.isNightBiting,
        )
      : favoritesFiltered;
    const wrongMaxFiltered =
      wrongMaxOnly && wrongMaxIssues.kind === 'ready'
        ? nightFiltered.filter((item) => wrongMaxIssues.issues.has(item.fish.id))
        : nightFiltered;
    return sortRecords(wrongMaxFiltered, sort);
  }, [
    favoriteFish,
    favoritesOnly,
    hideRarest,
    nightOnly,
    nightOverrides,
    selectedBaseId,
    selectedStatuses,
    sort,
    state,
    wrongMaxIssues,
    wrongMaxOnly,
  ]);

  useEffect(() => {
    const controller = new AbortController();

    /** После единственной проверки сессии загружает разрешённые персональные ресурсы. */
    async function loadAuthenticatedResources() {
      try {
        const user = await getCurrentUser(controller.signal);
        if (controller.signal.aborted) return;

        setFavoriteFish({ kind: 'loading' });
        void getFavoriteFish(controller.signal).then(
          (response) => {
            if (controller.signal.aborted) return;
            setFavoriteFish({
              kind: 'ready',
              fishIds: new Set(response.items.map((item) => item.fishId)),
              pendingFishIds: new Set(),
              error: null,
            });
          },
          () => {
            if (!controller.signal.aborted) {
              setFavoriteFish({ kind: 'error', message: 'Не удалось загрузить избранное.' });
            }
          },
        );

        if (user.role !== 'ADMIN' || user.isBanned) {
          setAdminNotes({ kind: 'hidden' });
          setWrongMaxIssues({ kind: 'hidden' });
          return;
        }

        setAdminNotes({ kind: 'loading' });
        setWrongMaxIssues({ kind: 'loading' });
        void getAdminRecordNotes(controller.signal).then(
          (response) => {
            if (controller.signal.aborted) return;
            setAdminNotes({
              kind: 'ready',
              notes: Object.fromEntries(response.items.map((item) => [item.fishId, item.note])),
            });
          },
          (error: unknown) => {
            if (!controller.signal.aborted) {
              setAdminNotes({
                kind: 'error',
                message: getApiErrorMessage(error, 'Не удалось загрузить заметки.'),
              });
            }
          },
        );
        void getAdminWrongMaxIssues(controller.signal).then(
          (response) => {
            if (controller.signal.aborted) return;
            setWrongMaxIssues({
              kind: 'ready',
              issues: new Map(response.items.map((item) => [item.fishId, item])),
            });
          },
          (error: unknown) => {
            if (!controller.signal.aborted) {
              setWrongMaxIssues({
                kind: 'error',
                message: getApiErrorMessage(error, 'Не удалось загрузить отметки неверного max.'),
              });
            }
          },
        );
      } catch {
        if (controller.signal.aborted) return;
        setFavoriteFish({ kind: 'hidden' });
        setAdminNotes({ kind: 'hidden' });
        setWrongMaxIssues({ kind: 'hidden' });
      }
    }

    void loadAuthenticatedResources();
    return () => controller.abort();
  }, []);

  /** Обновляет локальную карту только подтверждённым сервером значением заметки. */
  const saveAdminNote = useCallback(async (fishId: string, note: string) => {
    const response = await updateAdminRecordNote(fishId, note);
    setAdminNotes((current) => {
      if (current.kind !== 'ready') return current;
      const notes = { ...current.notes };
      if (response.note.note === null) delete notes[fishId];
      else notes[fishId] = response.note.note;
      return { kind: 'ready', notes };
    });
    return response.note.note;
  }, []);

  /** Оптимистично меняет одну звезду, блокирует повтор и откатывает только эту Fish при ошибке. */
  const toggleFavorite = useCallback(async (fishId: string, selected: boolean) => {
    if (pendingFavoriteIds.current.has(fishId)) return;
    pendingFavoriteIds.current.add(fishId);
    setFavoriteFish((current) => {
      if (current.kind !== 'ready') return current;
      const fishIds = new Set(current.fishIds);
      if (selected) fishIds.add(fishId);
      else fishIds.delete(fishId);
      return {
        ...current,
        fishIds,
        pendingFishIds: new Set([...current.pendingFishIds, fishId]),
        error: null,
      };
    });

    try {
      if (selected) await addFavoriteFish(fishId);
      else await removeFavoriteFish(fishId);
    } catch (error) {
      setFavoriteFish((current) => {
        if (current.kind !== 'ready') return current;
        const fishIds = new Set(current.fishIds);
        if (selected) fishIds.delete(fishId);
        else fishIds.add(fishId);
        return {
          ...current,
          fishIds,
          error: getApiErrorMessage(error, 'Не удалось обновить избранное.'),
        };
      });
    } finally {
      pendingFavoriteIds.current.delete(fishId);
      setFavoriteFish((current) => {
        if (current.kind !== 'ready') return current;
        const pendingFishIds = new Set(current.pendingFishIds);
        pendingFishIds.delete(fishId);
        return { ...current, pendingFishIds };
      });
    }
  }, []);

  /** Оптимистично меняет ночную метку и откатывает её при ошибке ADMIN-запроса. */
  const toggleNightMark = useCallback(async (fishId: string, selected: boolean) => {
    if (pendingNightIds.current.has(fishId)) return;
    pendingNightIds.current.add(fishId);
    setPendingNightFishIds((current) => new Set([...current, fishId]));
    setNightMarkError(null);
    setNightOverrides((current) => new Map(current).set(fishId, selected));

    try {
      const response = await updateAdminNightMark(fishId, selected);
      setNightOverrides((current) => new Map(current).set(fishId, response.fish.isNightBiting));
    } catch (error) {
      setNightOverrides((current) => new Map(current).set(fishId, !selected));
      setNightMarkError(getApiErrorMessage(error, 'Не удалось обновить ночную метку.'));
    } finally {
      pendingNightIds.current.delete(fishId);
      setPendingNightFishIds((current) => {
        const next = new Set(current);
        next.delete(fishId);
        return next;
      });
    }
  }, []);

  /** Сохраняет подтверждённую сервером проблему в общей ADMIN-карте. */
  const saveWrongMaxIssue = useCallback(
    async (fishId: string, expectedWeightGrams: number | null, note: string | null) => {
      const response = await updateAdminWrongMaxIssue(fishId, expectedWeightGrams, note);
      setWrongMaxIssues((current) => {
        if (current.kind !== 'ready') return current;
        return {
          kind: 'ready',
          issues: new Map(current.issues).set(fishId, response.issue),
        };
      });
      return response.issue;
    },
    [],
  );

  /** Снимает проблему только после успешного ответа сервера. */
  const clearWrongMaxIssue = useCallback(async (fishId: string) => {
    await clearAdminWrongMaxIssue(fishId);
    setWrongMaxIssues((current) => {
      if (current.kind !== 'ready') return current;
      const issues = new Map(current.issues);
      issues.delete(fishId);
      return { kind: 'ready', issues };
    });
  }, []);

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

  function setMarkFilter(param: string, selected: boolean) {
    const params = new URLSearchParams(searchParams.toString());
    if (selected) params.set(param, 'true');
    else params.delete(param);
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
            favoriteFish={favoriteFish}
            favoritesOnly={favoritesOnly}
            nightOnly={nightOnly}
            wrongMaxOnly={wrongMaxOnly}
            wrongMaxIssues={wrongMaxIssues}
            nightOverrides={nightOverrides}
            pendingNightFishIds={pendingNightFishIds}
            nightMarkError={nightMarkError}
            sortKey={sort.key}
            sortDirection={sort.direction}
            onBaseFilter={setBaseFilter}
            onStatusFilter={setStatusFilter}
            onHideRarest={setHideRarest}
            onMarkFilter={setMarkFilter}
            onSort={setSort}
            onReset={resetSort}
            adminNotes={adminNotes}
            onSaveNote={saveAdminNote}
            onToggleFavorite={toggleFavorite}
            onToggleNightMark={toggleNightMark}
            onSaveWrongMaxIssue={saveWrongMaxIssue}
            onClearWrongMaxIssue={clearWrongMaxIssue}
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
  favoriteFish: FavoriteFishState;
  favoritesOnly: boolean;
  nightOnly: boolean;
  wrongMaxOnly: boolean;
  wrongMaxIssues: WrongMaxIssuesState;
  nightOverrides: ReadonlyMap<string, boolean>;
  pendingNightFishIds: ReadonlySet<string>;
  nightMarkError: string | null;
  sortKey: RecordsSortKey;
  sortDirection: RecordsSortDirection;
  onBaseFilter: (baseId: string) => void;
  onStatusFilter: (status: FilterableStatus, selected: boolean) => void;
  onHideRarest: (hidden: boolean) => void;
  onSort: (key: Exclude<RecordsSortKey, 'default'>) => void;
  onMarkFilter: (param: string, selected: boolean) => void;
  onReset: () => void;
  adminNotes: AdminNotesState;
  onSaveNote: (fishId: string, note: string) => Promise<string | null>;
  onToggleFavorite: (fishId: string, selected: boolean) => Promise<void>;
  onToggleNightMark: (fishId: string, selected: boolean) => Promise<void>;
  onSaveWrongMaxIssue: (
    fishId: string,
    expectedWeightGrams: number | null,
    note: string | null,
  ) => Promise<AdminWrongMaxIssue>;
  onClearWrongMaxIssue: (fishId: string) => Promise<void>;
};

function RecordsTable({
  data,
  rows,
  baseOptions,
  selectedBaseId,
  selectedStatuses,
  hideRarest,
  sortKey,
  favoriteFish,
  favoritesOnly,
  nightOnly,
  wrongMaxOnly,
  wrongMaxIssues,
  nightOverrides,
  pendingNightFishIds,
  nightMarkError,
  sortDirection,
  onBaseFilter,
  onStatusFilter,
  onHideRarest,
  onSort,
  onReset,
  onMarkFilter,
  adminNotes,
  onSaveNote,
  onToggleFavorite,
  onToggleNightMark,
  onSaveWrongMaxIssue,
  onClearWrongMaxIssue,
}: TableProps) {
  const syncMessage =
    data.sync.status === 'WAITING'
      ? 'Ожидаем данные новой недели. Старые рекорды не показываются.'
      : data.sync.status === 'STALE'
        ? 'Показан последний снимок недели; очередное обновление не удалось.'
        : data.sync.lastSuccessAt
          ? `Проверено ${DATE_FORMATTER.format(new Date(data.sync.lastSuccessAt))} МСК`
          : null;
  const favoriteError =
    favoriteFish.kind === 'error'
      ? favoriteFish.message
      : favoriteFish.kind === 'ready'
        ? favoriteFish.error
        : null;
  const isAdmin = wrongMaxIssues.kind !== 'checking' && wrongMaxIssues.kind !== 'hidden';
  const issueError = wrongMaxIssues.kind === 'error' ? wrongMaxIssues.message : null;
  const selectedMarksCount =
    Number(favoritesOnly) + Number(nightOnly) + Number(isAdmin && wrongMaxOnly);
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
          {favoriteFish.kind === 'ready' ? (
            <details className={styles.marksFilter}>
              <summary>Метки{selectedMarksCount > 0 ? ` · ${selectedMarksCount}` : ''}</summary>
              <div className={styles.marksOptions} role="group" aria-label="Метки">
                <label>
                  <input
                    type="checkbox"
                    checked={favoritesOnly}
                    onChange={(event) => onMarkFilter(FAVORITES_FILTER_PARAM, event.target.checked)}
                  />
                  <span>★ Избранные</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={nightOnly}
                    onChange={(event) => onMarkFilter(NIGHT_FILTER_PARAM, event.target.checked)}
                  />
                  <span>🌙 Ночные</span>
                </label>
                {wrongMaxIssues.kind === 'ready' ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={wrongMaxOnly}
                      onChange={(event) =>
                        onMarkFilter(WRONG_MAX_FILTER_PARAM, event.target.checked)
                      }
                    />
                    <span>⚠ Неверный наш max</span>
                  </label>
                ) : null}
              </div>
            </details>
          ) : null}
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
      {favoriteError || issueError || nightMarkError ? (
        <p className={styles.favoriteError} role="alert">
          {favoriteError ?? issueError ?? nightMarkError}
        </p>
      ) : null}
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
        <table
          className={`${styles.table} ${adminNotes.kind !== 'checking' && adminNotes.kind !== 'hidden' ? styles.adminTable : ''}`}
        >
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
              {adminNotes.kind !== 'checking' && adminNotes.kind !== 'hidden' ? (
                <th scope="col">Заметка</th>
              ) : null}
              <th scope="col">Игрок/дата</th>
              <th scope="col">Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <RecordRow
                key={row.fish.id}
                row={row}
                adminNotes={adminNotes}
                favorite={
                  favoriteFish.kind === 'ready' ? favoriteFish.fishIds.has(row.fish.id) : null
                }
                favoritePending={
                  favoriteFish.kind === 'ready' && favoriteFish.pendingFishIds.has(row.fish.id)
                }
                isAdmin={isAdmin}
                isNightBiting={nightOverrides.get(row.fish.id) ?? row.fish.isNightBiting}
                nightPending={pendingNightFishIds.has(row.fish.id)}
                wrongMaxIssue={
                  wrongMaxIssues.kind === 'ready'
                    ? (wrongMaxIssues.issues.get(row.fish.id) ?? null)
                    : undefined
                }
                onSaveNote={onSaveNote}
                onToggleFavorite={onToggleFavorite}
                onToggleNightMark={onToggleNightMark}
                onSaveWrongMaxIssue={onSaveWrongMaxIssue}
                onClearWrongMaxIssue={onClearWrongMaxIssue}
              />
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

function RecordRow({
  row,
  adminNotes,
  favorite,
  favoritePending,
  isAdmin,
  isNightBiting,
  nightPending,
  wrongMaxIssue,
  onSaveNote,
  onToggleFavorite,
  onToggleNightMark,
  onSaveWrongMaxIssue,
  onClearWrongMaxIssue,
}: {
  row: RecordsItem;
  adminNotes: AdminNotesState;
  favorite: boolean | null;
  favoritePending: boolean;
  isAdmin: boolean;
  isNightBiting: boolean;
  nightPending: boolean;
  wrongMaxIssue: AdminWrongMaxIssue | null | undefined;
  onSaveNote: TableProps['onSaveNote'];
  onToggleFavorite: TableProps['onToggleFavorite'];
  onToggleNightMark: TableProps['onToggleNightMark'];
  onSaveWrongMaxIssue: TableProps['onSaveWrongMaxIssue'];
  onClearWrongMaxIssue: TableProps['onClearWrongMaxIssue'];
}) {
  return (
    <tr>
      <th scope="row">
        <div className={styles.fishCell}>
          <Link
            className={`${styles.fishLink} ${row.fish.isRarest ? styles.rarestFishLink : ''}`}
            href={`/fish/${row.fish.id}`}
          >
            {row.fish.name}
            {row.fish.isRarest ? (
              <span className={styles.rarestDot} aria-hidden="true" title="Редчайший вид" />
            ) : null}
          </Link>
          {favorite !== null ? (
            <button
              className={`${styles.favoriteButton} ${favorite ? styles.favoriteButtonActive : ''}`}
              type="button"
              aria-label={`${favorite ? 'Удалить' : 'Добавить'} ${row.fish.name} ${favorite ? 'из избранного' : 'в избранное'}`}
              aria-pressed={favorite}
              title={favorite ? 'Удалить из избранного' : 'Добавить в избранное'}
              disabled={favoritePending}
              onClick={() => void onToggleFavorite(row.fish.id, !favorite)}
            >
              <span aria-hidden="true">★</span>
            </button>
          ) : null}
          {isAdmin ? (
            <button
              className={`${styles.nightButton} ${isNightBiting ? styles.nightButtonActive : ''}`}
              type="button"
              aria-label={`${isNightBiting ? 'Снять ночную метку с' : 'Отметить как ночную'} ${row.fish.name}`}
              title={isNightBiting ? 'Ночная рыба' : 'Отметить как ночную'}
              aria-pressed={isNightBiting}
              disabled={nightPending}
              onClick={() => void onToggleNightMark(row.fish.id, !isNightBiting)}
            >
              <span aria-hidden="true">🌙</span>
            </button>
          ) : isNightBiting ? (
            <span
              className={styles.nightMark}
              aria-label={`Ночная рыба: ${row.fish.name}`}
              title="Ночная рыба"
            >
              🌙
            </span>
          ) : null}
        </div>
      </th>
      <td>{recordWeight(row)}</td>
      <td className={styles.numeric}>
        <div className={styles.maxCell}>
          <span>
            {row.normalMaxWeightGrams === null
              ? '—'
              : formatCompactWeight(row.normalMaxWeightGrams)}
          </span>
          {wrongMaxIssue !== undefined ? (
            <WrongMaxIssueEditor
              fishId={row.fish.id}
              fishName={row.fish.name}
              issue={wrongMaxIssue}
              onSave={onSaveWrongMaxIssue}
              onClear={onClearWrongMaxIssue}
            />
          ) : null}
        </div>
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
      {adminNotes.kind !== 'checking' && adminNotes.kind !== 'hidden' ? (
        <td className={styles.noteCell}>
          {adminNotes.kind === 'loading' ? (
            <span className={styles.secondary}>Загружаем…</span>
          ) : adminNotes.kind === 'error' ? (
            <span className={styles.noteError}>{adminNotes.message}</span>
          ) : (
            <RecordNoteEditor
              fishId={row.fish.id}
              fishName={row.fish.name}
              note={adminNotes.notes[row.fish.id] ?? ''}
              onSave={onSaveNote}
            />
          )}
        </td>
      ) : null}
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

/** Редактирует приватную проблему max, сохраняя исходное вычисленное значение рядом. */
function WrongMaxIssueEditor({
  fishId,
  fishName,
  issue,
  onSave,
  onClear,
}: {
  fishId: string;
  fishName: string;
  issue: AdminWrongMaxIssue | null;
  onSave: TableProps['onSaveWrongMaxIssue'];
  onClear: TableProps['onClearWrongMaxIssue'];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftWeight, setDraftWeight] = useState(issue?.expectedWeightGrams?.toString() ?? '');
  const [draftNote, setDraftNote] = useState(issue?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  function openEditor() {
    setDraftWeight(issue?.expectedWeightGrams?.toString() ?? '');
    setDraftNote(issue?.note ?? '');
    setError(null);
    setIsEditing(true);
  }

  function cancel() {
    if (isSaving) return;
    setIsEditing(false);
    setError(null);
  }

  async function save() {
    if (savingRef.current) return;
    const normalizedWeight = draftWeight.trim();
    const expectedWeightGrams = normalizedWeight === '' ? null : Number(normalizedWeight);
    if (
      expectedWeightGrams !== null &&
      (!Number.isInteger(expectedWeightGrams) || expectedWeightGrams <= 0)
    ) {
      setError('Укажите положительный целый вес в граммах.');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await onSave(fishId, expectedWeightGrams, draftNote.trim() || null);
      setDraftWeight(saved.expectedWeightGrams?.toString() ?? '');
      setDraftNote(saved.note ?? '');
      setIsEditing(false);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Не удалось сохранить проблему max.'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  async function clear() {
    if (savingRef.current || issue === null) return;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await onClear(fishId);
      setIsEditing(false);
    } catch (clearError) {
      setError(getApiErrorMessage(clearError, 'Не удалось снять проблему max.'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    const actionLabel =
      issue === null
        ? `Отметить неверный Наш max для ${fishName}`
        : `Изменить проблему Наш max для ${fishName}`;
    const issueTitle =
      issue === null
        ? actionLabel
        : [
            'Неверный Наш max',
            issue.expectedWeightGrams === null
              ? null
              : `ожидается ${formatCompactWeight(issue.expectedWeightGrams)}`,
            issue.note,
          ]
            .filter(Boolean)
            .join(' · ');
    return (
      <button
        className={`${styles.issueMarkButton} ${issue ? styles.issueMarkButtonActive : ''}`}
        type="button"
        aria-label={actionLabel}
        title={issueTitle}
        onClick={openEditor}
      >
        <span aria-hidden="true">{issue ? '⚠' : '+'}</span>
      </button>
    );
  }

  return (
    <div
      className={styles.wrongMaxEditor}
      role="group"
      aria-label={`Проблема Наш max для ${fishName}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        aria-label={`Ожидаемый правильный вес для ${fishName}`}
        placeholder="Вес, г"
        value={draftWeight}
        disabled={isSaving}
        onChange={(event) => setDraftWeight(event.target.value)}
      />
      <input
        type="text"
        maxLength={500}
        aria-label={`Пояснение проблемы max для ${fishName}`}
        placeholder="Пояснение"
        value={draftNote}
        disabled={isSaving}
        onChange={(event) => setDraftNote(event.target.value)}
      />
      <div className={styles.wrongMaxActions}>
        <button
          type="button"
          disabled={isSaving}
          aria-label="Сохранить проблему max"
          title="Сохранить проблему max"
          onClick={() => void save()}
        >
          ✓
        </button>
        {issue ? (
          <button
            type="button"
            disabled={isSaving}
            aria-label="Снять проблему max"
            title="Снять проблему max"
            onClick={() => void clear()}
          >
            −
          </button>
        ) : null}
        <button
          type="button"
          disabled={isSaving}
          aria-label="Отменить проблему max"
          title="Отменить проблему max"
          onClick={cancel}
        >
          ×
        </button>
      </div>
      {error ? (
        <span className={styles.noteError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/** Управляет локальным режимом inline-редактирования одной ADMIN-заметки. */
function RecordNoteEditor({
  fishId,
  fishName,
  note,
  onSave,
}: {
  fishId: string;
  fishName: string;
  note: string;
  onSave: TableProps['onSaveNote'];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  function cancel() {
    if (isSaving) return;
    setDraft(note);
    setError(null);
    setIsEditing(false);
  }

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await onSave(fishId, draft);
      setDraft(saved ?? '');
      setIsEditing(false);
    } catch (saveError) {
      setError(getApiErrorMessage(saveError, 'Не удалось сохранить заметку.'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    const actionLabel = note === '' ? 'Добавить заметку' : 'Изменить заметку';
    return (
      <div className={styles.noteView}>
        {note === '' ? null : <span>{note}</span>}
        <button
          className={styles.noteActionButton}
          type="button"
          aria-label={actionLabel}
          title={actionLabel}
          onClick={() => {
            setDraft(note);
            setError(null);
            setIsEditing(true);
          }}
        >
          <NoteActionIcon name={note === '' ? 'add' : 'edit'} />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.noteEditor}>
      <input
        type="text"
        aria-label={`Заметка для ${fishName}`}
        maxLength={500}
        value={draft}
        disabled={isSaving}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void save();
          }
        }}
      />
      <button
        className={styles.noteActionButton}
        type="button"
        aria-label="Сохранить заметку"
        title="Сохранить заметку"
        disabled={isSaving}
        onClick={() => void save()}
      >
        <NoteActionIcon name="save" />
      </button>
      <button
        className={styles.noteActionButton}
        type="button"
        aria-label="Отменить редактирование"
        title="Отменить редактирование"
        disabled={isSaving}
        onClick={cancel}
      >
        <NoteActionIcon name="cancel" />
      </button>
      {error ? (
        <span className={styles.noteError} role="alert">
          {error}
        </span>
      ) : null}
    </div>
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
