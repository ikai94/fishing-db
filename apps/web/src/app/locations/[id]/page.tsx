'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../catalog.module.css';
import { getLocation } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function LocationPage() {
  const { id: locationId } = useParams<{ id: string }>();
  const loadLocation = useCallback(
    (signal: AbortSignal) => getLocation(locationId, signal),
    [locationId],
  );
  const { state, reload } = useApiResource(
    loadLocation,
    'Не удалось загрузить локацию. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Навигация по каталогу">
          <Link className={styles.backLink} href="/bases">
            ← Все базы
          </Link>
          <Link className={styles.link} href="/fish">
            Все рыбы
          </Link>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем локацию…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.message}>
            <h1 className={styles.panelTitle}>Локация не найдена</h1>
            <p>Возможно, локация или её рыболовная база сейчас неактивна.</p>
            <Link className={styles.link} href="/bases">
              Вернуться к базам
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
              <p className={styles.eyebrow}>
                <Link className={styles.backLink} href={`/bases/${state.data.fishingBase.id}`}>
                  {state.data.fishingBase.name}
                </Link>
              </p>
              <h1 className={styles.title}>
                {state.data.number}. {state.data.name}
              </h1>
            </header>

            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Рыбы учитываются на уровне базы</h2>
              <p className={styles.muted}>
                Рыба, связанная с базой «{state.data.fishingBase.name}», теоретически доступна на
                всех её локациях.
              </p>
              <Link className={styles.link} href={`/bases/${state.data.fishingBase.id}`}>
                Открыть рыб базы
              </Link>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
