'use client';

import Link from 'next/link';
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FishImage } from '@/app/fish/_components/fish-image';
import { getApiErrorMessage } from '@/lib/api-client';
import {
  type BaseFishNotebook,
  type PersonalNotebookFields,
  saveBaseFishNotebookEntry,
  setBaseFishNotebookVisibility,
} from '@/lib/base-fish-notebook-api';
import { filterCatalogItems } from '@/lib/catalog-search';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import { updateAdminNightMark } from '@/lib/records-api';
import styles from './notebook.module.css';
import { NOTEBOOK_SORT_OPTIONS, sortNotebookRows, type NotebookSort } from './notebook-view';

/** Один DOM для таблицы и мобильных карточек сохраняет черновики при смене ширины экрана. */
export function NotebookTable({ notebook }: { notebook: BaseFishNotebook }) {
  return <NotebookContent key={notebook.base.id} notebook={notebook} />;
}

/** Фильтры меняют только видимость и порядок DOM-строк, не размонтируя редакторы и их черновики. */
function NotebookContent({ notebook }: { notebook: BaseFishNotebook }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NotebookSort>('default');
  const [showHidden, setShowHidden] = useState(false);
  const [nightOnly, setNightOnly] = useState(false);
  const [visibility, setVisibility] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [nightOverrides, setNightOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const sortedRows = useMemo(() => sortNotebookRows(notebook.rows, sort), [notebook.rows, sort]);
  const matchingIds = useMemo(
    () =>
      new Set(
        filterCatalogItems(
          notebook.rows.map((row) => row.fish),
          query,
        ).map((fish) => fish.id),
      ),
    [notebook.rows, query],
  );
  const isHidden = (row: BaseFishNotebook['rows'][number]) =>
    visibility.get(row.fish.id) ?? row.isHidden;
  const hiddenCount = notebook.rows.filter(isHidden).length;
  const isNightBiting = (row: BaseFishNotebook['rows'][number]) =>
    nightOverrides.get(row.fish.id) ?? row.fish.isNightBiting;
  const visibleRows = sortedRows.filter(
    (row) =>
      matchingIds.has(row.fish.id) &&
      (showHidden || !isHidden(row)) &&
      (!nightOnly || isNightBiting(row)),
  );
  const rowNumbers = new Map(visibleRows.map((row, index) => [row.fish.id, index + 1]));

  /** Ответ видимости не переносит noteText в состояние редактора и не меняет его черновик. */
  function updateVisibility(fishId: string, hidden: boolean) {
    setVisibility((current) => new Map(current).set(fishId, hidden));
  }

  /** Луна и фильтр используют одно состояние: откат запроса возвращает строку вместе с черновиком. */
  function updateNightStatus(fishId: string, night: boolean) {
    setNightOverrides((current) => new Map(current).set(fishId, night));
  }

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.searchControl}>
          <span>Рыба</span>
          <input
            type="search"
            aria-label="Поиск рыбы"
            placeholder="Поиск по названию"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Очистить поиск"
            title="Очистить поиск"
          >
            ×
          </button>
        ) : null}
        <label>
          <span>Порядок</span>
          <select
            aria-label="Сортировка рыб"
            value={sort}
            onChange={(event) => setSort(event.target.value as NotebookSort)}
          >
            {NOTEBOOK_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.nightToggle}>
          <input
            type="checkbox"
            checked={nightOnly}
            onChange={(event) => setNightOnly(event.target.checked)}
          />
          <svg
            className={styles.filterMoon}
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
          </svg>
          Только ночные
        </label>
        <label className={styles.hiddenToggle}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          Показать скрытые ({hiddenCount})
        </label>
        <span className={styles.resultCount} role="status" aria-live="polite">
          Показано: {visibleRows.length} из {notebook.rows.length}
        </span>
      </div>
      {visibleRows.length === 0 ? (
        <p className={styles.empty}>Нет рыб для выбранных условий.</p>
      ) : null}
      <div className={styles.tableRegion} role="region" aria-label="Блокнот рыб">
        <table className={styles.table} role="table" aria-label="Личные заметки по рыбам базы">
          <colgroup>
            <col className={styles.numberColumn} />
            <col className={styles.fishColumn} />
            <col className={styles.locationsColumn} />
            <col className={styles.noteColumn} />
            <col className={styles.weightColumn} />
            <col className={styles.weightColumn} />
          </colgroup>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                №
              </th>
              <th scope="col" role="columnheader">
                Рыба
              </th>
              <th scope="col" role="columnheader">
                Топ-3 локации
              </th>
              <th scope="col" role="columnheader">
                Заметка
              </th>
              <th scope="col" role="columnheader">
                Мин. вес
              </th>
              <th scope="col" role="columnheader">
                Макс. вес
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {sortedRows.map((row) => (
              <NotebookRow
                key={`${notebook.base.id}:${row.fish.id}`}
                baseId={notebook.base.id}
                row={row}
                number={rowNumbers.get(row.fish.id) ?? 0}
                visible={rowNumbers.has(row.fish.id)}
                isHidden={isHidden(row)}
                onVisibilityChange={updateVisibility}
                isNightBiting={isNightBiting(row)}
                onNightChange={updateNightStatus}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Состояние сохранения относится только к одной личной заметке и не затрагивает соседние строки. */
type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string };

/** Измеряет реальные строки и переносы; сброс высоты позволяет сжать удалённый текст до CSS-минимума. */
function resizeNoteEditor(editor: HTMLTextAreaElement) {
  const style = window.getComputedStyle(editor);
  const border =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);
  // scrollHeight включает padding, но не рамку; редактор использует border-box.
  editor.style.height = 'auto';
  const height = editor.scrollHeight + border;
  const width = editor.getBoundingClientRect().width;
  editor.style.height = `${height}px`;
  return width;
}

/** Независимо сохраняет личные поля и общую ночную метку; ошибка не стирает черновик заметки. */
function NotebookRow({
  baseId,
  row,
  number,
  visible,
  isHidden,
  onVisibilityChange,
  isNightBiting,
  onNightChange,
}: {
  baseId: string;
  row: BaseFishNotebook['rows'][number];
  number: number;
  visible: boolean;
  isHidden: boolean;
  onVisibilityChange: (fishId: string, hidden: boolean) => void;
  isNightBiting: boolean;
  onNightChange: (fishId: string, night: boolean) => void;
}) {
  const [saved, setSaved] = useState<PersonalNotebookFields>({ noteText: row.noteText });
  const [noteText, setNoteText] = useState(row.noteText ?? '');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const request = useRef<AbortController | null>(null);
  const visibilityRequest = useRef<AbortController | null>(null);
  const [visibilityState, setVisibilityState] = useState<SaveState>({ kind: 'idle' });
  const [nightState, setNightState] = useState<SaveState>({ kind: 'idle' });
  const nightRequest = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const measuredWidth = useRef(0);
  const composing = useRef(false);
  const dirty = noteText !== (saved.noteText ?? '');
  const saving = state.kind === 'saving';
  const updatingVisibility = visibilityState.kind === 'saving';
  const updatingNight = nightState.kind === 'saving';
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => visibilityRequest.current?.abort(), []);
  useEffect(() => () => nightRequest.current?.abort(), []);

  // Высота и курсор обновляются до отрисовки; появление кнопок тоже меняет доступную ширину заметки.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    if (!visible) return;
    measuredWidth.current = resizeNoteEditor(editor);
    if (pendingCaret.current !== null) {
      editor.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [noteText, dirty, visible]);

  // Изменение высоты не запускает повторное измерение: наблюдаем только изменение ширины.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    let frame: number | null = null;
    /** Объединяет resize и observer в одно измерение за кадр, не меняя состояние черновика. */
    const scheduleResize = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (editor.closest('tr')?.hidden) return;
        measuredWidth.current = resizeNoteEditor(editor);
      });
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const nextWidth = editor.getBoundingClientRect().width;
            if (nextWidth === measuredWidth.current) return;
            measuredWidth.current = nextWidth;
            scheduleResize();
          });
    observer?.observe(editor);
    // resize учитывает также смену размера шрифта и минимальной высоты на мобильном breakpoint.
    window.addEventListener('resize', scheduleResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  /** Проверка abort не даёт позднему ответу перезаписать другую пару после ухода со страницы. */
  async function save() {
    if (!dirty || request.current !== null) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: 'saving' });
    try {
      const result = await saveBaseFishNotebookEntry(
        baseId,
        row.fish.id,
        { noteText },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSaved(result);
      setNoteText(result.noteText ?? '');
      setState({ kind: 'saved' });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setState({
        kind: 'error',
        message: getApiErrorMessage(
          error,
          'Не удалось сохранить. Черновик сохранён в строке; повторите попытку.',
        ),
      });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  /** Отмена не обращается к API и меняет только черновик этой строки. */
  function cancel() {
    setNoteText(saved.noteText ?? '');
    setState({ kind: 'idle' });
  }

  /** Видимость сохраняется независимо от заметки; ошибка оставляет строку и все её черновики. */
  async function toggleVisibility() {
    if (visibilityRequest.current !== null) return;
    const controller = new AbortController();
    visibilityRequest.current = controller;
    setVisibilityState({ kind: 'saving' });
    try {
      const hidden = await setBaseFishNotebookVisibility(
        baseId,
        row.fish.id,
        !isHidden,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      onVisibilityChange(row.fish.id, hidden);
      setVisibilityState({ kind: 'idle' });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setVisibilityState({
        kind: 'error',
        message: getApiErrorMessage(error, 'Не удалось изменить видимость. Повторите попытку.'),
      });
    } finally {
      if (visibilityRequest.current === controller) visibilityRequest.current = null;
    }
  }

  /** Общая метка Fish сохраняется отдельно от личных полей; ошибка откатывает только луну. */
  async function toggleNightMark() {
    if (nightRequest.current !== null) return;
    const controller = new AbortController();
    const previous = isNightBiting;
    nightRequest.current = controller;
    // Оптимистическая луна сразу показывает выбранное значение; повторный запрос заблокирован ref.
    onNightChange(row.fish.id, !previous);
    setNightState({ kind: 'saving' });
    try {
      const result = await updateAdminNightMark(row.fish.id, !previous, controller.signal);
      if (controller.signal.aborted) return;
      onNightChange(row.fish.id, result.fish.isNightBiting);
      setNightState({ kind: 'idle' });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      onNightChange(row.fish.id, previous);
      setNightState({
        kind: 'error',
        message: getApiErrorMessage(error, 'Не удалось обновить ночную метку. Повторите попытку.'),
      });
    } finally {
      if (nightRequest.current === controller) nightRequest.current = null;
    }
  }

  /** Enter сохраняет строку; Alt+Enter заменяет выделение переводом строки и оставляет курсор после него. */
  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return;
    // keyCode 229 закрывает Enter подтверждения IME в браузерах, где isComposing уже сброшен.
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
      return;
    event.preventDefault();
    if (saving || event.repeat) return;
    if (!event.altKey) {
      void save();
      return;
    }
    const editor = event.currentTarget;
    const start = editor.selectionStart;
    const nextText = `${editor.value.slice(0, start)}\n${editor.value.slice(editor.selectionEnd)}`;
    if (nextText.length > editor.maxLength) return;
    const caret = start + 1;
    if (nextText === noteText) {
      editor.setSelectionRange(caret, caret);
      return;
    }
    pendingCaret.current = caret;
    setNoteText(nextText);
    setState({ kind: 'idle' });
  }

  return (
    <tr role="row" hidden={!visible} className={isHidden ? styles.hiddenRow : undefined}>
      <td className={styles.rowNumber} role="cell">
        <span className={styles.mobileLabel} aria-hidden="true">
          №
        </span>
        {number}
      </td>
      <th className={styles.fishCell} scope="row" role="rowheader">
        <div className={styles.fish}>
          <FishImage fishName={row.fish.name} image={row.fish.image} variant="thumbnail" />
          <Link
            className={`${styles.entityLink} ${row.fish.isRarest ? styles.rarestFishLink : ''}`}
            href={`/fish/${row.fish.id}`}
            title={row.fish.name}
          >
            {row.fish.name}
          </Link>
          <button
            className={`${styles.nightButton} ${isNightBiting ? styles.nightButtonActive : ''}`}
            type="button"
            disabled={updatingNight}
            aria-label={`Ночная рыба — ${row.fish.name}`}
            aria-pressed={isNightBiting}
            aria-busy={updatingNight}
            title={`${isNightBiting ? 'Снять' : 'Добавить'} общую метку ночного клёва для всех баз`}
            onClick={() => void toggleNightMark()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={isNightBiting ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
            </svg>
          </button>
          <button
            className={styles.visibilityButton}
            type="button"
            disabled={updatingVisibility}
            aria-label={`${isHidden ? 'Восстановить' : 'Скрыть'} рыбу — ${row.fish.name}`}
            title={isHidden ? 'Восстановить рыбу' : 'Скрыть рыбу'}
            aria-busy={updatingVisibility}
            onClick={() => void toggleVisibility()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
              {!isHidden ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        </div>
        {updatingNight ? (
          <span className={styles.saveStatus} role="status">
            Сохраняем ночную метку…
          </span>
        ) : null}
        {nightState.kind === 'error' ? (
          <p className={styles.error} role="alert">
            {nightState.message}
          </p>
        ) : null}
        {updatingVisibility ? (
          <span className={styles.saveStatus} role="status">
            {isHidden ? 'Восстанавливаем…' : 'Скрываем…'}
          </span>
        ) : null}
        {visibilityState.kind === 'error' ? (
          <p className={styles.error} role="alert">
            {visibilityState.message}
          </p>
        ) : null}
      </th>
      <td className={styles.locationsCell} role="cell">
        <span className={styles.mobileLabel} aria-hidden="true">
          Топ-3 локации
        </span>
        {row.topLocations.length === 0 ? (
          <span className={styles.empty}>Нет уловов</span>
        ) : (
          <ol className={styles.locations} aria-label={`Топ локаций — ${row.fish.name}`}>
            {row.topLocations.map((location, index) => (
              <li key={location.id}>
                <Link
                  className={styles.entityLink}
                  href={`/locations/${location.id}`}
                  aria-label={`${location.number}. ${location.name} — уловов: ${location.reportsCount}`}
                  title={`${location.number}. ${location.name} — уловов: ${location.reportsCount}`}
                >
                  {location.number}({location.reportsCount})
                </Link>
                {index < row.topLocations.length - 1 ? ', ' : null}
              </li>
            ))}
          </ol>
        )}
      </td>
      <td className={styles.noteCell} role="cell">
        <span className={styles.mobileLabel} aria-hidden="true">
          Заметка
        </span>
        <div className={styles.noteEditor}>
          <textarea
            ref={editorRef}
            className={styles.editor}
            aria-label={`Заметка — ${row.fish.name}`}
            aria-keyshortcuts="Enter Alt+Enter"
            title="Enter — сохранить; Alt+Enter — новая строка"
            maxLength={5000}
            rows={1}
            disabled={saving}
            value={noteText}
            onKeyDown={handleEditorKeyDown}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onChange={(event) => {
              setNoteText(event.target.value);
              setState({ kind: 'idle' });
            }}
          />
          {dirty || saving ? (
            <div className={styles.buttons}>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                aria-label={`Сохранить заметку — ${row.fish.name}`}
                title="Сохранить заметку"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={cancel}
                aria-label={`Отменить изменения — ${row.fish.name}`}
                title="Отменить изменения"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
        <span className={styles.saveStatus} role="status" aria-live="polite">
          {saving ? 'Сохраняем…' : state.kind === 'saved' ? 'Сохранено' : ''}
        </span>
        {state.kind === 'error' ? (
          <p className={styles.error} role="alert">
            {state.message}
          </p>
        ) : null}
      </td>
      <td className={`${styles.weight} ${styles.minWeight}`} role="cell">
        <span className={styles.mobileLabel} aria-hidden="true">
          Мин. вес
        </span>
        {row.minWeightGrams === null ? '—' : formatCompactWeight(row.minWeightGrams)}
      </td>
      <td className={`${styles.weight} ${styles.maxWeight}`} role="cell">
        <span className={styles.mobileLabel} aria-hidden="true">
          Макс. вес
        </span>
        {row.maxWeightGrams === null ? '—' : formatCompactWeight(row.maxWeightGrams)}
      </td>
    </tr>
  );
}
