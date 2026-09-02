'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../public-catalog.module.css';
import { FishExplorer } from './_components/fish-explorer';
import { FishImage } from '../_components/fish-image';
import { ApplicationShell } from '@/components/application-shell/application-shell';
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
    <ApplicationShell>
      <div className={styles.page}>
        <nav className={styles.sectionNavigation} aria-label="Навигация по разделу">
          <Link className={styles.sectionLink} href="/fish">
            Рыбы
          </Link>
          {state.kind === 'ready' ? (
            <>
              <span className={styles.navigationSeparator} aria-hidden="true">
                /
              </span>
              <span className={styles.navigationCurrent} aria-current="page">
                {state.data.name}
              </span>
            </>
          ) : null}
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
            <header className={`${styles.header} ${styles.fishDetailHeader}`}>
              <div>
                <h1 className={styles.title}>{state.data.name}</h1>
                <p className={styles.metadata}>
                  Активных баз обитания: {state.data.bases.length.toLocaleString('ru-RU')}
                </p>
              </div>
              <FishImage fishName={state.data.name} image={state.data.image} variant="detail" />
            </header>
            <FishExplorer fish={state.data} />
          </>
        ) : null}
      </div>
    </ApplicationShell>
  );
}
