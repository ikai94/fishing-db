'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import styles from './page.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import {
  catalogSearchItemHref,
  catalogSearchItemKindLabel,
  searchCatalog,
  type PublicCatalogSearchResult,
} from '@/lib/catalog-api';
import { catalogSearchTokens } from '@/lib/catalog-search';

const FULL_SEARCH_LIMIT = 100;

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; result: PublicCatalogSearchResult }
  | { kind: 'error' };

export function CatalogSearchPage() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const searchKey = searchParams.toString();

  return <CatalogSearchRuntime key={searchKey} urlQuery={urlQuery} />;
}

function CatalogSearchRuntime({ urlQuery }: { urlQuery: string }) {
  const router = useRouter();
  const inputId = useId();
  const revision = useRef(0);
  const [draft, setDraft] = useState(urlQuery);
  const [attempt, setAttempt] = useState(0);
  const [composing, setComposing] = useState(false);
  const searchable = catalogSearchTokens(urlQuery).length > 0;
  const [state, setState] = useState<SearchState>({ kind: searchable ? 'loading' : 'idle' });

  useEffect(() => {
    if (!searchable) return;

    const requestRevision = ++revision.current;
    const controller = new AbortController();
    void searchCatalog(urlQuery, FULL_SEARCH_LIMIT, controller.signal).then(
      (result) => {
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        setState({ kind: 'ready', result });
      },
      () => {
        if (controller.signal.aborted || requestRevision !== revision.current) return;
        setState({ kind: 'error' });
      },
    );

    return () => controller.abort();
  }, [attempt, searchable, urlQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composing) return;
    const nextQuery = draft.trim();
    revision.current += 1;
    const href = nextQuery
      ? `/search?${new URLSearchParams({ q: nextQuery }).toString()}`
      : '/search';
    if (nextQuery === urlQuery.trim()) {
      setState({ kind: searchable ? 'loading' : 'idle' });
      setAttempt((current) => current + 1);
    } else {
      router.push(href);
    }
  }

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <ShellIcon name="search" />
            </span>
            <h1 className={styles.title}>Поиск по каталогу</h1>
          </div>
          <p className={styles.subtitle}>Рыбы, базы, локации, наживки и приманки.</p>
        </header>

        <form className={styles.searchForm} role="search" onSubmit={submit}>
          <label className={styles.searchLabel} htmlFor={inputId}>
            Поисковый запрос
          </label>
          <div className={styles.searchRow}>
            <input
              autoComplete="off"
              className={styles.searchInput}
              id={inputId}
              onChange={(event) => setDraft(event.target.value)}
              onCompositionEnd={(event) => {
                setComposing(false);
                setDraft(event.currentTarget.value);
              }}
              onCompositionStart={() => setComposing(true)}
              placeholder="Например, белый амур"
              type="search"
              value={draft}
            />
            <button className={styles.searchButton} type="submit">
              Найти
            </button>
          </div>
        </form>

        {!searchable ? (
          <p className={styles.statusMessage}>Введите название или его часть.</p>
        ) : null}
        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Ищем по каталогу…
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>Не удалось выполнить поиск. Попробуйте ещё раз.</p>
            <button
              className={styles.retryButton}
              type="button"
              onClick={() => {
                revision.current += 1;
                setState({ kind: 'loading' });
                setAttempt((current) => current + 1);
              }}
            >
              Повторить
            </button>
          </div>
        ) : null}
        {state.kind === 'ready' ? (
          <section aria-labelledby="search-results-title">
            <h2 className={styles.resultsTitle} id="search-results-title">
              Результаты для «{urlQuery.trim()}»
            </h2>
            <p className={styles.resultCount} aria-live="polite">
              Найдено: {state.result.total}
              {state.result.total > state.result.items.length
                ? ` · показаны первые ${state.result.items.length}`
                : ''}
            </p>
            {state.result.items.length === 0 ? (
              <p className={styles.statusMessage}>Ничего не найдено.</p>
            ) : (
              <ul className={styles.resultList} aria-label="Результаты поиска по каталогу">
                {state.result.items.map((item) => (
                  <li className={styles.resultItem} key={`${item.kind}:${item.id}`}>
                    <Link className={styles.resultLink} href={catalogSearchItemHref(item)}>
                      <span className={styles.resultName}>{item.name}</span>
                      <span className={styles.resultMeta}>
                        {catalogSearchItemKindLabel(item)}
                        {item.kind === 'LOCATION'
                          ? ` · ${item.fishingBase.name}, № ${item.number}`
                          : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </ApplicationShell>
  );
}
