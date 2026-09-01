'use client';

import Link from 'next/link';
import { useCallback, useId, useMemo, useState } from 'react';
import styles from './page.module.css';
import { FishImage } from './_components/fish-image';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { listFish } from '@/lib/catalog-api';
import {
  catalogSearchTokens,
  FISH_ALPHABET_GROUPS,
  filterCatalogItems,
  filterFishByAlphabetGroup,
  sortCatalogItemsByName,
  type FishAlphabetGroupId,
} from '@/lib/catalog-search';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishPage() {
  const loadFish = useCallback((signal: AbortSignal) => listFish(signal), []);
  const { state, reload } = useApiResource(
    loadFish,
    'Не удалось загрузить список рыб. Попробуйте ещё раз.',
  );
  const [query, setQuery] = useState('');
  const [activeAlphabetGroup, setActiveAlphabetGroup] = useState<FishAlphabetGroupId>('all');
  const searchId = useId();
  const sortedFish = useMemo(
    () => (state.kind === 'ready' ? sortCatalogItemsByName(state.data) : []),
    [state],
  );
  const isSearchActive = catalogSearchTokens(query).length > 0;
  const displayedFish = useMemo(
    () =>
      isSearchActive
        ? filterCatalogItems(sortedFish, query)
        : filterFishByAlphabetGroup(sortedFish, activeAlphabetGroup),
    [activeAlphabetGroup, isSearchActive, query, sortedFish],
  );

  function selectAlphabetGroup(groupId: FishAlphabetGroupId) {
    setActiveAlphabetGroup(groupId);
    setQuery('');
  }

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <ShellIcon name="fish" />
            </span>
            <h1 className={styles.title}>Рыбы</h1>
          </div>
          <p className={styles.subtitle}>Глобальный список активных видов рыб.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем рыб…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'not-found' || (state.kind === 'ready' && state.data.length === 0) ? (
          <p className={styles.statusMessage}>В каталоге пока нет активных рыб.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <section className={styles.section} aria-labelledby="fish-list-title">
            <h2 className={styles.visuallyHidden} id="fish-list-title">
              Список рыб
            </h2>
            <div className={styles.fishFilterDock}>
              <fieldset className={styles.alphabetFilter}>
                <legend className={styles.visuallyHidden}>Фильтр рыб по первой букве</legend>
                {FISH_ALPHABET_GROUPS.map((group) => {
                  const isActive = activeAlphabetGroup === group.id;
                  return (
                    <button
                      className={`${styles.alphabetButton} ${isActive ? styles.alphabetButtonActive : ''}`}
                      type="button"
                      aria-pressed={isActive}
                      key={group.id}
                      onClick={() => selectAlphabetGroup(group.id)}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </fieldset>
              <div className={styles.searchField}>
                <label className={styles.searchLabel} htmlFor={searchId}>
                  Поиск по названию
                </label>
                <div className={styles.searchControl}>
                  <span className={styles.searchIcon}>
                    <ShellIcon name="search" />
                  </span>
                  <input
                    className={styles.searchInput}
                    id={searchId}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Например, сом"
                    type="search"
                    value={query}
                  />
                </div>
                {isSearchActive ? (
                  <span className={styles.searchScope}>Поиск по всему каталогу</span>
                ) : null}
              </div>
            </div>
            <p className={styles.resultCount} aria-live="polite">
              {isSearchActive ? `Найдено: ${displayedFish.length}` : `Рыб: ${displayedFish.length}`}
            </p>
            {displayedFish.length === 0 ? (
              <p className={styles.sectionLead}>
                {isSearchActive ? 'Ничего не найдено.' : 'В этой группе рыб пока нет.'}
              </p>
            ) : (
              <ul className={styles.fishReferenceList} aria-label="Рыбы каталога">
                {displayedFish.map((fish) => (
                  <li className={styles.fishReferenceItem} key={fish.id}>
                    <div className={styles.fishReferenceRow}>
                      <FishImage fishName={fish.name} image={fish.image} variant="thumbnail" />
                      <Link className={styles.entityLink} href={`/fish/${fish.id}`}>
                        {fish.name}
                      </Link>
                    </div>
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
