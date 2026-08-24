'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../public-catalog.module.css';
import { LocationObservations } from './_components/location-observations';
import { getLocation } from '@/lib/catalog-api';
import { getLocationObservations } from '@/lib/catch-reports-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function LocationPage() {
  const { id: locationId } = useParams<{ id: string }>();
  const loadLocation = useCallback(
    async (signal: AbortSignal) => {
      const [location, observations] = await Promise.all([
        getLocation(locationId, signal),
        getLocationObservations(locationId, signal),
      ]);
      return { location, observations };
    },
    [locationId],
  );
  const { state, reload } = useApiResource(
    loadLocation,
    'Не удалось загрузить локацию. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Навигация по каталогу">
          <Link className={styles.backLink} href="/bases">
            ← Все базы
          </Link>
          <Link className={styles.navLink} href="/fish">
            Все рыбы
          </Link>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем локацию…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.statusMessage}>
            <h1 className={styles.sectionTitle}>Локация не найдена</h1>
            <p>Возможно, локация или её рыболовная база сейчас неактивна.</p>
            <Link className={styles.entityLink} href="/bases">
              Вернуться к базам
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
              <p className={styles.eyebrow}>Локация</p>
              <h1 className={styles.title}>
                {state.data.location.number}. {state.data.location.name}
              </h1>
              <p className={styles.metadata}>
                Рыболовная база:{' '}
                <Link
                  className={styles.entityLink}
                  href={`/bases/${state.data.location.fishingBase.id}`}
                >
                  {state.data.location.fishingBase.name}
                </Link>
              </p>
              <p className={styles.metadata}>
                <Link
                  className={styles.entityLink}
                  href={`/bases/${state.data.location.fishingBase.id}#fish`}
                >
                  Каталог рыб базы «{state.data.location.fishingBase.name}»
                </Link>
              </p>
            </header>

            <LocationObservations
              baseId={state.data.location.fishingBase.id}
              data={state.data.observations}
              key={state.data.location.id}
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
