'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from '../page.module.css';
import { RecentActivityList } from './recent-activity-list';
import { RecentCatchTable } from './recent-catch-table';
import { listActivity } from '@/lib/activity-api';
import { apiBaseUrl } from '@/lib/api-client';
import { listCatchReports } from '@/lib/catch-reports-api';
import { useApiResource } from '@/lib/use-api-resource';

type HealthPayload = {
  status: 'ok' | 'error';
  application: 'up';
  database: 'up' | 'down';
  timestamp: string;
};

type HealthState =
  | { kind: 'checking' }
  | { kind: 'healthy'; payload: HealthPayload }
  | { kind: 'degraded'; payload: HealthPayload }
  | { kind: 'unavailable' };

function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Record<string, unknown>;

  return (
    (payload.status === 'ok' || payload.status === 'error') &&
    payload.application === 'up' &&
    (payload.database === 'up' || payload.database === 'down') &&
    typeof payload.timestamp === 'string'
  );
}

export function HomeDashboard() {
  const [health, setHealth] = useState<HealthState>({ kind: 'checking' });
  const loadRecentCatches = useCallback(
    (signal: AbortSignal) => listCatchReports({ limit: 10, signal }),
    [],
  );
  const { state: catches, reload: reloadCatches } = useApiResource(
    loadRecentCatches,
    'Не удалось загрузить недавние уловы.',
  );
  const loadRecentActivity = useCallback(
    (signal: AbortSignal) => listActivity({ limit: 10, signal }),
    [],
  );
  const { state: activity, reload: reloadActivity } = useApiResource(
    loadRecentActivity,
    'Не удалось загрузить недавние действия.',
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Health request timed out', 'TimeoutError')),
      15_000,
    );

    async function loadHealth() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/v1/health`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!isHealthPayload(payload)) throw new Error('Unexpected health response');
        if (!active) return;

        setHealth(
          response.ok && payload.status === 'ok' && payload.database === 'up'
            ? { kind: 'healthy', payload }
            : { kind: 'degraded', payload },
        );
      } catch {
        if (active) setHealth({ kind: 'unavailable' });
      } finally {
        clearTimeout(timeout);
      }
    }

    void loadHealth();

    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const apiStatus =
    health.kind === 'checking'
      ? 'проверяется'
      : health.kind === 'unavailable'
        ? 'недоступен'
        : 'доступен';
  const databaseStatus =
    health.kind === 'healthy'
      ? 'доступна'
      : health.kind === 'degraded'
        ? 'недоступна'
        : health.kind === 'checking'
          ? 'проверяется'
          : 'неизвестно';

  return (
    <article className={styles.page}>
      <header className={styles.intro}>
        <div>
          <h1 className={styles.title}>Рыбная база</h1>
          <p className={styles.description}>
            Совместная база и личный архив для игроков «Русской рыбалки».
          </p>
        </div>
        <dl className={styles.statusList} aria-label="Состояние сервисов" aria-live="polite">
          <div>
            <dt>Frontend</dt>
            <dd className={styles.success}>работает</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd
              className={
                health.kind === 'unavailable'
                  ? styles.error
                  : health.kind === 'checking'
                    ? styles.neutral
                    : styles.success
              }
            >
              {apiStatus}
            </dd>
          </div>
          <div>
            <dt>PostgreSQL</dt>
            <dd
              className={
                health.kind === 'healthy'
                  ? styles.success
                  : health.kind === 'degraded'
                    ? styles.error
                    : styles.neutral
              }
            >
              {databaseStatus}
            </dd>
          </div>
        </dl>
      </header>

      <section className={styles.section} aria-labelledby="recent-catches-title">
        <h2 className={styles.sectionTitle} id="recent-catches-title">
          Недавно добавленные рыбы
        </h2>
        {catches.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем недавние уловы…
          </p>
        ) : null}
        {catches.kind === 'error' || catches.kind === 'not-found' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>
              {catches.kind === 'error' ? catches.message : 'Не удалось загрузить недавние уловы.'}
            </p>
            <button className={styles.retryButton} type="button" onClick={reloadCatches}>
              Повторить
            </button>
          </div>
        ) : null}
        {catches.kind === 'ready' && catches.data.items.length === 0 ? (
          <p className={styles.statusMessage}>Публичных уловов пока нет.</p>
        ) : null}
        {catches.kind === 'ready' && catches.data.items.length > 0 ? (
          <RecentCatchTable reports={catches.data.items} />
        ) : null}
      </section>

      <section className={styles.section} aria-labelledby="recent-activity-title">
        <h2 className={styles.sectionTitle} id="recent-activity-title">
          Недавние действия на сайте
        </h2>
        {activity.kind === 'loading' ? (
          <p className={styles.activityState} aria-live="polite">
            Загружаем недавние действия…
          </p>
        ) : null}
        {activity.kind === 'error' || activity.kind === 'not-found' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>
              {activity.kind === 'error'
                ? activity.message
                : 'Не удалось загрузить недавние действия.'}
            </p>
            <button className={styles.retryButton} type="button" onClick={reloadActivity}>
              Повторить загрузку действий
            </button>
          </div>
        ) : null}
        {activity.kind === 'ready' && activity.data.items.length === 0 ? (
          <p className={styles.activityState}>Действий после запуска ленты пока нет.</p>
        ) : null}
        {activity.kind === 'ready' && activity.data.items.length > 0 ? (
          <RecentActivityList events={activity.data.items} />
        ) : null}
      </section>
    </article>
  );
}
