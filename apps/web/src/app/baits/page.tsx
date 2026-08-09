'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import styles from '../catalog.module.css';
import { listBaits, type PublicBait } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

function BaitGroup({ title, items }: { title: string; items: PublicBait[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{title}</h2>
      <ul className={styles.list}>
        {items.map((bait) => (
          <li className={styles.listItem} key={bait.id}>
            <p className={styles.itemName}>{bait.name}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function BaitsPage() {
  const loadBaits = useCallback((signal: AbortSignal) => listBaits(signal), []);
  const { state, reload } = useApiResource(
    loadBaits,
    'Не удалось загрузить наживки и приманки. Попробуйте ещё раз.',
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
            <Link className={styles.link} href="/fish">
              Рыбы
            </Link>
          </div>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Игровой каталог</p>
          <h1 className={styles.title}>Наживки и приманки</h1>
          <p className={styles.subtitle}>Активные игровые наживки и искусственные приманки.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем наживки и приманки…
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
          <p className={styles.message}>В каталоге пока нет активных наживок и приманок.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <>
            <BaitGroup title="Наживки" items={state.data.filter((bait) => bait.type === 'BAIT')} />
            <BaitGroup
              title="Искусственные приманки"
              items={state.data.filter((bait) => bait.type === 'LURE')}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
