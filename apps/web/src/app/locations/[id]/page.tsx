'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../bases-locations.module.css';
import { LocationObservations } from './_components/location-observations';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
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
    <ApplicationShell>
      <div className={styles.page}>
        <nav className={styles.sectionNavigation} aria-label="Навигация по разделу">
          <Link className={styles.sectionLink} href="/bases">
            Базы и локации
          </Link>
          {state.kind === 'ready' ? (
            <>
              <span className={styles.navigationSeparator} aria-hidden="true">
                /
              </span>
              <Link
                className={styles.sectionLink}
                href={`/bases/${state.data.location.fishingBase.id}`}
              >
                {state.data.location.fishingBase.name}
              </Link>
              <span className={styles.navigationSeparator} aria-hidden="true">
                /
              </span>
              <span className={styles.navigationCurrent} aria-current="page">
                {state.data.location.number}. {state.data.location.name}
              </span>
            </>
          ) : null}
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
              <div className={styles.titleRow}>
                <span className={styles.titleIcon}>
                  <ShellIcon name="bases" />
                </span>
                <h1 className={styles.title}>
                  {state.data.location.number}. {state.data.location.name}
                </h1>
              </div>
              <p className={styles.subtitle}>Локация</p>
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
    </ApplicationShell>
  );
}
