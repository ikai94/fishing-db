'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import styles from '../../public-catalog.module.css';
import { getFishingBase } from '@/lib/catalog-api';
import {
  catalogSearchTokens,
  compareCatalogItemsByName,
  filterCatalogItems,
  sortCatalogItemsByName,
} from '@/lib/catalog-search';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishingBasePage() {
  const { id: baseId } = useParams<{ id: string }>();
  const loadBase = useCallback((signal: AbortSignal) => getFishingBase(baseId, signal), [baseId]);
  const { state, reload } = useApiResource(
    loadBase,
    'Не удалось загрузить рыболовную базу. Попробуйте ещё раз.',
  );
  const [fishQuery, setFishQuery] = useState('');
  const fishSearchId = useId();
  const locations = useMemo(
    () =>
      state.kind === 'ready'
        ? [...state.data.locations].sort(
            (left, right) => left.number - right.number || compareCatalogItemsByName(left, right),
          )
        : [],
    [state],
  );
  const fish = useMemo(
    () => (state.kind === 'ready' ? sortCatalogItemsByName(state.data.fish) : []),
    [state],
  );
  const filteredFish = useMemo(() => filterCatalogItems(fish, fishQuery), [fish, fishQuery]);
  const isFishSearchActive = catalogSearchTokens(fishQuery).length > 0;

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Навигация по каталогу">
          <Link className={styles.backLink} href="/bases">
            ← Все базы
          </Link>
          <Link className={styles.navLink} href="/">
            На главную
          </Link>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем базу…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.statusMessage}>
            <h1 className={styles.sectionTitle}>База не найдена</h1>
            <p>Возможно, она была деактивирована или ссылка устарела.</p>
            <Link className={styles.entityLink} href="/bases">
              Вернуться к списку баз
            </Link>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <header className={styles.header}>
              <p className={styles.eyebrow}>Рыболовная база</p>
              <h1 className={styles.title}>{state.data.name}</h1>
            </header>

            <div className={styles.baseReferenceGrid}>
              <section
                className={`${styles.section} ${styles.baseReferencePane}`}
                id="locations"
                aria-labelledby="base-locations-title"
              >
                <h2 className={styles.sectionTitle} id="base-locations-title">
                  Локации
                </h2>
                {locations.length === 0 ? (
                  <p className={styles.sectionLead}>У этой базы пока нет активных локаций.</p>
                ) : (
                  <ol className={styles.locationList}>
                    {locations.map((location) => (
                      <li className={styles.locationItem} key={location.id} value={location.number}>
                        <Link className={styles.entityLink} href={`/locations/${location.id}`}>
                          {location.name}
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section
                className={`${styles.section} ${styles.baseReferencePane}`}
                id="fish"
                aria-labelledby="base-fish-title"
              >
                <h2 className={styles.sectionTitle} id="base-fish-title">
                  Рыбы
                </h2>
                <p className={styles.sectionLead}>
                  Каталог указывает рыб, доступных на этой базе. Он не описывает вероятность улова
                  на отдельной локации.
                </p>
                {fish.length === 0 ? (
                  <p className={styles.sectionLead}>Для этой базы пока не указаны активные рыбы.</p>
                ) : (
                  <>
                    <div className={styles.searchField}>
                      <label className={styles.searchLabel} htmlFor={fishSearchId}>
                        Поиск по рыбам
                      </label>
                      <input
                        className={styles.searchInput}
                        id={fishSearchId}
                        onChange={(event) => setFishQuery(event.target.value)}
                        placeholder="Например, сом"
                        type="search"
                        value={fishQuery}
                      />
                    </div>
                    {isFishSearchActive ? (
                      <p className={styles.resultCount} aria-live="polite">
                        Найдено: {filteredFish.length} из {fish.length}
                      </p>
                    ) : null}
                    {filteredFish.length === 0 ? (
                      <p className={styles.sectionLead}>Ничего не найдено.</p>
                    ) : (
                      <ul className={styles.verticalFishList}>
                        {filteredFish.map((fishItem) => (
                          <li className={styles.fishItem} key={fishItem.id}>
                            <Link className={styles.entityLink} href={`/fish/${fishItem.id}`}>
                              {fishItem.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
