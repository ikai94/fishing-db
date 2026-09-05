'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import styles from './application-shell.module.css';
import {
  catalogSearchItemHref,
  catalogSearchItemKindLabel,
  searchCatalog,
  type PublicCatalogSearchItem,
} from '@/lib/catalog-api';
import { catalogSearchTokens } from '@/lib/catalog-search';
import { ShellIcon } from './shell-icon';

const AUTOCOMPLETE_LIMIT = 100;
const AUTOCOMPLETE_DELAY_MS = 200;
const AUTOCOMPLETE_GROUP_LIMIT = 3;
const AUTOCOMPLETE_GROUP_ORDER = [
  'FISH',
  'FISHING_BASE',
  'LOCATION',
  'BAIT',
] as const satisfies readonly PublicCatalogSearchItem['kind'][];

const GROUP_LABELS: Readonly<Record<PublicCatalogSearchItem['kind'], string>> = {
  FISHING_BASE: 'Базы',
  LOCATION: 'Локации',
  FISH: 'Рыбы',
  BAIT: 'Наживки и приманки',
};

type AutocompleteState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: PublicCatalogSearchItem[]; total: number }
  | { kind: 'error' };

function autocompleteEnabled(query: string): boolean {
  return catalogSearchTokens(query).join('').length >= 2;
}

function fullSearchHref(query: string): string {
  return `/search?${new URLSearchParams({ q: query.trim() }).toString()}`;
}

type AutocompleteGroup = {
  kind: PublicCatalogSearchItem['kind'];
  label: string;
  total: number;
  options: Array<{ item: PublicCatalogSearchItem; optionIndex: number }>;
};

function groupAutocompleteItems(items: readonly PublicCatalogSearchItem[]): AutocompleteGroup[] {
  const grouped = new Map<PublicCatalogSearchItem['kind'], PublicCatalogSearchItem[]>();

  for (const item of items) {
    const groupItems = grouped.get(item.kind) ?? [];
    groupItems.push(item);
    grouped.set(item.kind, groupItems);
  }

  let optionIndex = 0;
  return AUTOCOMPLETE_GROUP_ORDER.flatMap((kind) => {
    const groupItems = grouped.get(kind);
    if (groupItems === undefined) return [];

    return {
      kind,
      label: GROUP_LABELS[kind],
      total: groupItems.length,
      options: groupItems.slice(0, AUTOCOMPLETE_GROUP_LIMIT).map((item) => ({
        item,
        optionIndex: optionIndex++,
      })),
    };
  });
}

export function GlobalCatalogSearch() {
  const router = useRouter();
  const inputId = useId();
  const panelId = useId();
  const revision = useRef(0);
  const [query, setQuery] = useState('');
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AutocompleteState>({ kind: 'idle' });
  const enabled = !composing && autocompleteEnabled(query);
  const open = focused && enabled;
  const items = state.kind === 'ready' ? state.items : [];
  const groups = groupAutocompleteItems(items);
  const visibleItems = groups.flatMap((group) => group.options.map(({ item }) => item));

  useEffect(() => {
    if (!enabled) return;

    const requestRevision = revision.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setState({ kind: 'loading' });
      void searchCatalog(query, AUTOCOMPLETE_LIMIT, controller.signal).then(
        (result) => {
          if (controller.signal.aborted || requestRevision !== revision.current) return;
          setState({ kind: 'ready', ...result });
          setActiveIndex(-1);
        },
        () => {
          if (controller.signal.aborted || requestRevision !== revision.current) return;
          setState({ kind: 'error' });
          setActiveIndex(-1);
        },
      );
    }, AUTOCOMPLETE_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, enabled, query]);

  function changeQuery(event: ChangeEvent<HTMLInputElement>) {
    revision.current += 1;
    const nextQuery = event.target.value;
    setQuery(nextQuery);
    setState({ kind: autocompleteEnabled(nextQuery) ? 'loading' : 'idle' });
    setActiveIndex(-1);
  }

  function startComposition() {
    revision.current += 1;
    setComposing(true);
    setState({ kind: 'idle' });
    setActiveIndex(-1);
  }

  function endComposition(event: CompositionEvent<HTMLInputElement>) {
    revision.current += 1;
    setComposing(false);
    const nextQuery = event.currentTarget.value;
    setQuery(nextQuery);
    setState({ kind: autocompleteEnabled(nextQuery) ? 'loading' : 'idle' });
  }

  function goToItem(item: PublicCatalogSearchItem) {
    setFocused(false);
    router.push(catalogSearchItemHref(item));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing || !autocompleteEnabled(query)) return;
    const activeItem = visibleItems[activeIndex];
    if (activeItem !== undefined) {
      goToItem(activeItem);
      return;
    }
    setFocused(false);
    router.push(fullSearchHref(query));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composing || event.nativeEvent.isComposing) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setFocused(false);
      event.currentTarget.blur();
      return;
    }
    if (!open || visibleItems.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? visibleItems.length - 1 : current - 1));
    }
  }

  return (
    <form
      className={styles.globalSearch}
      role="search"
      onSubmit={submit}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <label className={styles.visuallyHidden} htmlFor={inputId}>
        Поиск по каталогу
      </label>
      <div className={styles.globalSearchControl}>
        <span className={styles.globalSearchIcon}>
          <ShellIcon name="search" />
        </span>
        <input
          aria-activedescendant={activeIndex >= 0 ? `${panelId}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={panelId}
          aria-expanded={open}
          autoComplete="off"
          className={styles.globalSearchInput}
          id={inputId}
          onChange={changeQuery}
          onCompositionEnd={endComposition}
          onCompositionStart={startComposition}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Рыба, база, локация или наживка"
          role="combobox"
          type="search"
          value={query}
        />
      </div>

      {open ? (
        <div className={styles.globalSearchPanel} id={panelId}>
          {state.kind === 'loading' ? (
            <p className={styles.globalSearchStatus} role="status">
              Ищем…
            </p>
          ) : null}
          {state.kind === 'error' ? (
            <div className={styles.globalSearchStatus} role="alert">
              Не удалось выполнить поиск.{' '}
              <button
                className={styles.globalSearchRetry}
                type="button"
                onClick={() => {
                  revision.current += 1;
                  setAttempt((current) => current + 1);
                }}
              >
                Повторить
              </button>
            </div>
          ) : null}
          {state.kind === 'ready' && items.length === 0 ? (
            <p className={styles.globalSearchStatus} role="status">
              Ничего не найдено
            </p>
          ) : null}
          {state.kind === 'ready' && items.length > 0 ? (
            <ul className={styles.globalSearchOptions} role="listbox">
              {groups.map((group, groupIndex) => {
                const groupHeaderId = `${panelId}-group-${groupIndex}`;

                return (
                  <li className={styles.globalSearchGroup} key={group.kind} role="presentation">
                    <div className={styles.globalSearchGroupHeader} id={groupHeaderId}>
                      <span>{group.label}</span>
                      <span className={styles.globalSearchGroupCount}>{group.total}</span>
                    </div>
                    <ul
                      aria-labelledby={groupHeaderId}
                      className={styles.globalSearchGroupOptions}
                      role="group"
                    >
                      {group.options.map(({ item, optionIndex }) => (
                        <li
                          aria-selected={optionIndex === activeIndex}
                          className={`${styles.globalSearchOption} ${
                            optionIndex === activeIndex ? styles.globalSearchOptionActive : ''
                          }`}
                          id={`${panelId}-option-${optionIndex}`}
                          key={`${item.kind}:${item.id}`}
                          role="option"
                          onMouseEnter={() => setActiveIndex(optionIndex)}
                        >
                          <Link
                            href={catalogSearchItemHref(item)}
                            onClick={() => setFocused(false)}
                            onFocus={() => setActiveIndex(optionIndex)}
                          >
                            <span className={styles.globalSearchResultName}>{item.name}</span>
                            {item.kind === 'LOCATION' || item.kind === 'BAIT' ? (
                              <span className={styles.globalSearchResultMeta}>
                                {item.kind === 'LOCATION'
                                  ? `${item.fishingBase.name} · № ${item.number}`
                                  : catalogSearchItemKindLabel(item)}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {state.kind === 'ready' && state.total > 0 ? (
            <Link className={styles.globalSearchAll} href={fullSearchHref(query)}>
              Все результаты ({state.total})
            </Link>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
