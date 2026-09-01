'use client';

import { useCallback, useId, useMemo, useState } from 'react';
import styles from './page.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { listBaits, type PublicBait } from '@/lib/catalog-api';
import {
  catalogSearchTokens,
  filterCatalogItems,
  sortCatalogItemsByName,
} from '@/lib/catalog-search';
import { useApiResource } from '@/lib/use-api-resource';
import { BaitImage } from './bait-image';

type BaitTypeFilter = 'ALL' | PublicBait['type'];

const BAIT_TYPE_FILTERS: ReadonlyArray<{ id: BaitTypeFilter; label: string }> = [
  { id: 'ALL', label: 'Все' },
  { id: 'BAIT', label: 'Наживки' },
  { id: 'LURE', label: 'Искусственные приманки' },
];

function baitTypeLabel(type: PublicBait['type']): string {
  return type === 'BAIT' ? 'Наживка' : 'Приманка';
}

export default function BaitsPage() {
  const loadBaits = useCallback((signal: AbortSignal) => listBaits(signal), []);
  const { state, reload } = useApiResource(
    loadBaits,
    'Не удалось загрузить наживки и приманки. Попробуйте ещё раз.',
  );
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<BaitTypeFilter>('ALL');
  const searchId = useId();
  const sortedBaits = useMemo(
    () => (state.kind === 'ready' ? sortCatalogItemsByName(state.data) : []),
    [state],
  );
  const isSearchActive = catalogSearchTokens(query).length > 0;
  const displayedBaits = useMemo(() => {
    const typeFiltered =
      activeType === 'ALL' ? sortedBaits : sortedBaits.filter((bait) => bait.type === activeType);

    return filterCatalogItems(typeFiltered, query);
  }, [activeType, query, sortedBaits]);

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <ShellIcon name="bait" />
            </span>
            <h1 className={styles.title}>Наживки</h1>
          </div>
          <p className={styles.subtitle}>Активные игровые наживки и искусственные приманки.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем наживки и приманки…
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
          <p className={styles.statusMessage}>В каталоге пока нет активных наживок и приманок.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <section aria-labelledby="bait-list-title">
            <h2 className={styles.visuallyHidden} id="bait-list-title">
              Список наживок и приманок
            </h2>
            <div className={styles.filterDock}>
              <fieldset className={styles.typeFilter}>
                <legend className={styles.visuallyHidden}>Фильтр по типу</legend>
                {BAIT_TYPE_FILTERS.map((filter) => {
                  const isActive = activeType === filter.id;

                  return (
                    <button
                      className={`${styles.typeButton} ${isActive ? styles.typeButtonActive : ''}`}
                      type="button"
                      aria-pressed={isActive}
                      key={filter.id}
                      onClick={() => setActiveType(filter.id)}
                    >
                      {filter.label}
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
                    placeholder="Например, мотыль"
                    type="search"
                    value={query}
                  />
                </div>
                {isSearchActive ? (
                  <span className={styles.searchScope}>
                    {activeType === 'ALL' ? 'Поиск по всему каталогу' : 'Поиск в выбранном типе'}
                  </span>
                ) : null}
              </div>
            </div>
            <p className={styles.resultCount} aria-live="polite">
              {isSearchActive
                ? `Найдено: ${displayedBaits.length}`
                : `Позиций: ${displayedBaits.length}`}
            </p>
            {displayedBaits.length === 0 ? (
              <p className={styles.sectionLead}>
                {isSearchActive ? 'Ничего не найдено.' : 'В выбранном типе пока нет позиций.'}
              </p>
            ) : (
              <ul className={styles.baitList} aria-label="Наживки и приманки каталога">
                {displayedBaits.map((bait) => (
                  <li className={styles.baitItem} key={bait.id}>
                    <BaitImage baitName={bait.name} image={bait.image} />
                    <span className={styles.baitName}>{bait.name}</span>
                    <span
                      className={`${styles.typeMarker} ${
                        bait.type === 'BAIT' ? styles.baitMarker : styles.lureMarker
                      }`}
                    >
                      {baitTypeLabel(bait.type)}
                    </span>
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
