'use client';

import { useEffect, useState } from 'react';
import styles from './page.module.css';

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

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    (payload.status === 'ok' || payload.status === 'error') &&
    payload.application === 'up' &&
    (payload.database === 'up' || payload.database === 'down') &&
    typeof payload.timestamp === 'string'
  );
}

export default function Home() {
  const [health, setHealth] = useState<HealthState>({ kind: 'checking' });

  useEffect(() => {
    const controller = new AbortController();

    async function loadHealth() {
      try {
        const response = await fetch(`${apiUrl}/api/v1/health`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload: unknown = await response.json();

        if (!isHealthPayload(payload)) {
          throw new Error('Unexpected health response');
        }

        if (response.ok && payload.status === 'ok' && payload.database === 'up') {
          setHealth({ kind: 'healthy', payload });
          return;
        }

        setHealth({ kind: 'degraded', payload });
      } catch {
        if (!controller.signal.aborted) {
          setHealth({ kind: 'unavailable' });
        }
      }
    }

    void loadHealth();

    return () => controller.abort();
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
        : 'неизвестно';

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Phase 1 · Infrastructure</p>
        <h1>Fishing Database</h1>
        <p className={styles.description}>
          Frontend запущен. Предметные функции будут добавляться постепенно в следующих фазах.
        </p>

        <dl className={styles.statusList} aria-live="polite">
          <div>
            <dt>Frontend</dt>
            <dd className={styles.success}>работает</dd>
          </div>
          <div>
            <dt>API</dt>
            <dd className={health.kind === 'unavailable' ? styles.error : styles.neutral}>
              {apiStatus}
            </dd>
          </div>
          <div>
            <dt>PostgreSQL</dt>
            <dd className={health.kind === 'healthy' ? styles.success : styles.neutral}>
              {databaseStatus}
            </dd>
          </div>
        </dl>

        {health.kind === 'unavailable' ? (
          <p className={styles.notice}>
            API не отвечает. Проверьте, что PostgreSQL и NestJS запущены.
          </p>
        ) : null}
      </section>
    </main>
  );
}
