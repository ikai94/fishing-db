'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import styles from '../catalog.module.css';
import { listFish } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishPage() {
  const loadFish = useCallback((signal: AbortSignal) => listFish(signal), []);
  const { state, reload } = useApiResource(
    loadFish,
    'Не удалось загрузить список рыб. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Каталог">
          <Link className={styles.backLink} href="/">
            ← На главную
          </Link>
          <div className={styles.navGroup}>
            <Link className={styles.link} href="/bases">
              Базы
            </Link>
            <Link className={styles.link} href="/baits">
              Наживки и приманки
            </Link>
          </div>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Игровой каталог</p>
          <h1 className={styles.title}>Рыбы</h1>
          <p className={styles.subtitle}>Глобальный список активных видов рыб.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем рыб…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'not-found' || (state.kind === 'ready' && state.data.length === 0) ? (
          <p className={styles.message}>В каталоге пока нет активных рыб.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <section className={styles.panel}>
            <ul className={styles.list}>
              {state.data.map((fish) => (
                <li className={styles.listItem} key={fish.id}>
                  <p className={styles.itemName}>{fish.name}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  );
}
