'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/api-client';
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
    let isActive = true;
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

        if (!isHealthPayload(payload)) {
          throw new Error('Unexpected health response');
        }

        if (response.ok && payload.status === 'ok' && payload.database === 'up') {
          setHealth({ kind: 'healthy', payload });
          return;
        }

        setHealth({ kind: 'degraded', payload });
      } catch {
        if (isActive) {
          setHealth({ kind: 'unavailable' });
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    void loadHealth();

    return () => {
      isActive = false;
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
        : 'неизвестно';

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Fishing Database</p>
        <h1>Fishing Database</h1>
        <p className={styles.description}>
          Совместная база и личный архив для игроков «Русской рыбалки».
        </p>

        <section className={styles.catalogSection}>
          <h2 className={styles.sectionTitle}>Игровой каталог</h2>
          <nav className={styles.catalogActions} aria-label="Игровой каталог">
            <Link className={styles.catalogLink} href="/bases">
              Рыболовные базы
            </Link>
            <Link className={styles.catalogLink} href="/fish">
              Рыбы
            </Link>
            <Link className={styles.catalogLink} href="/baits">
              Наживки и приманки
            </Link>
          </nav>
        </section>

        <nav className={styles.authActions} aria-label="Аккаунт">
          <Link className={styles.primaryLink} href="/register">
            Зарегистрироваться
          </Link>
          <Link className={styles.secondaryLink} href="/login">
            Войти
          </Link>
          <Link className={styles.accountLink} href="/account">
            Мой аккаунт
          </Link>
        </nav>

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
