'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../catalog.module.css';
import { getFishingBase } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function FishingBasePage() {
  const { id: baseId } = useParams<{ id: string }>();
  const loadBase = useCallback((signal: AbortSignal) => getFishingBase(baseId, signal), [baseId]);
  const { state, reload } = useApiResource(
    loadBase,
    'Не удалось загрузить рыболовную базу. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Навигация по каталогу">
          <Link className={styles.backLink} href="/bases">
            ← Все базы
          </Link>
          <Link className={styles.link} href="/">
            На главную
          </Link>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем базу…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.message}>
            <h1 className={styles.panelTitle}>База не найдена</h1>
            <p>Возможно, она была деактивирована или ссылка устарела.</p>
            <Link className={styles.link} href="/bases">
              Вернуться к списку баз
            </Link>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
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

            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Локации</h2>
              {state.data.locations.length === 0 ? (
                <p className={styles.muted}>У этой базы пока нет активных локаций.</p>
              ) : (
                <ol className={styles.list}>
                  {state.data.locations.map((location) => (
                    <li className={styles.listItem} key={location.id}>
                      <div className={styles.itemMain}>
                        <span className={styles.locationNumber}>{location.number}</span>
                        <span className={styles.itemName}>{location.name}</span>
                      </div>
                      <Link className={styles.link} href={`/locations/${location.id}`}>
                        Открыть
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Рыбы базы</h2>
              <p className={styles.muted}>
                Каталог указывает рыб, доступных на этой базе. Он не описывает вероятность улова на
                отдельной локации.
              </p>
              {state.data.fish.length === 0 ? (
                <p className={styles.muted}>Для этой базы пока не указаны активные рыбы.</p>
              ) : (
                <ul className={styles.list}>
                  {state.data.fish.map((fish) => (
                    <li className={styles.listItem} key={fish.id}>
                      <p className={styles.itemName}>{fish.name}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
