'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import styles from '../catalog.module.css';
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
            <Link className={styles.link} href="/fish">
              Рыбы
            </Link>
            <Link className={styles.link} href="/baits">
              Наживки и приманки
            </Link>
          </div>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Игровой каталог</p>
          <h1 className={styles.title}>Рыболовные базы</h1>
          <p className={styles.subtitle}>
            Выберите базу, чтобы посмотреть её пронумерованные локации.
          </p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем базы…
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

        {state.kind === 'not-found' ? (
          <p className={styles.message}>Каталог баз пока недоступен.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length === 0 ? (
          <p className={styles.message}>В каталоге пока нет активных рыболовных баз.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <section className={styles.grid} aria-label="Рыболовные базы">
            {state.data.map((base) => (
              <Link className={styles.card} href={`/bases/${base.id}`} key={base.id}>
                <h2 className={styles.cardTitle}>{base.name}</h2>
              </Link>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
