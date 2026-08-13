'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../public-catalog.module.css';
import { FishExplorer } from './_components/fish-explorer';
import { getFish } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishDetailPage() {
  const { id: fishId } = useParams<{ id: string }>();
  const loadFish = useCallback((signal: AbortSignal) => getFish(fishId, signal), [fishId]);
  const { state, reload } = useApiResource(
    loadFish,
    'Не удалось загрузить рыбу. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Навигация по каталогу">
          <Link className={styles.backLink} href="/fish">
            ← Все рыбы
          </Link>
          <div className={styles.navGroup}>
            <Link className={styles.navLink} href="/bases">
              Базы
            </Link>
            <Link className={styles.navLink} href="/">
              На главную
            </Link>
          </div>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} role="status">
            Загружаем рыбу…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.statusMessage}>
            <h1 className={styles.sectionTitle}>Рыба не найдена</h1>
            <p>Возможно, она была деактивирована или ссылка устарела.</p>
            <Link className={styles.entityLink} href="/fish">
              Вернуться к списку рыб
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
              <p className={styles.eyebrow}>Рыба</p>
              <h1 className={styles.title}>{state.data.name}</h1>
              <p className={styles.metadata}>
                Активных баз обитания: {state.data.bases.length.toLocaleString('ru-RU')}
              </p>
            </header>
            <FishExplorer fish={state.data} />
          </>
        ) : null}
      </div>
    </main>
  );
}
