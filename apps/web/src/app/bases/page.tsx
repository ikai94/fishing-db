'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import styles from '../public-catalog.module.css';
import { listFishingBases } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishingBasesPage() {
  const loadBases = useCallback((signal: AbortSignal) => listFishingBases(signal), []);
  const { state, reload } = useApiResource(
    loadBases,
    'Не удалось загрузить список рыболовных баз. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Каталог">
          <Link className={styles.backLink} href="/">
            ← На главную
          </Link>
          <div className={styles.navGroup}>
            <Link className={styles.navLink} href="/fish">
              Рыбы
            </Link>
            <Link className={styles.navLink} href="/baits">
              Наживки и приманки
            </Link>
          </div>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Игровой каталог</p>
          <h1 className={styles.title} id="bases-title">
            Рыболовные базы
          </h1>
          <p className={styles.subtitle}>Активные базы, их локации и виды рыб.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем базы…
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

        {state.kind === 'not-found' ? (
          <p className={styles.statusMessage}>Каталог баз пока недоступен.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length === 0 ? (
          <p className={styles.statusMessage}>В каталоге пока нет активных рыболовных баз.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <div
            aria-label="Таблица рыболовных баз"
            className={styles.tableRegion}
            role="region"
            tabIndex={0}
          >
            <table className={styles.catalogTable} aria-labelledby="bases-title">
              <caption className={styles.visuallyHidden}>
                Рыболовные базы, число активных локаций и рыб
              </caption>
              <thead>
                <tr>
                  <th scope="col">№</th>
                  <th scope="col">База</th>
                  <th className={styles.numericCell} scope="col">
                    Локаций
                  </th>
                  <th className={styles.numericCell} scope="col">
                    Рыб
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((base, index) => (
                  <tr key={base.id}>
                    <td className={styles.rowNumber}>{index + 1}</td>
                    <td>
                      <Link className={styles.entityLink} href={`/bases/${base.id}`}>
                        {base.name}
                      </Link>
                    </td>
                    <td className={styles.numericCell}>{base.locationsCount}</td>
                    <td className={styles.numericCell}>{base.fishCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </main>
  );
}
