'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import styles from '../../catalog.module.css';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { type AuthUser, getCurrentUser } from '@/lib/auth-api';

type AccessState =
  | { kind: 'loading' }
  | { kind: 'allowed'; user: AuthUser }
  | { kind: 'forbidden' }
  | { kind: 'banned' }
  | { kind: 'error'; message: string };

export default function AdminCatalogLayout({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AccessState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function checkAccess() {
      try {
        const user = await getCurrentUser(controller.signal);

        if (user.role !== 'ADMIN') {
          setState({ kind: 'forbidden' });
          return;
        }

        if (user.isBanned) {
          setState({ kind: 'banned' });
          return;
        }

        setState({ kind: 'allowed', user });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (isApiError(error) && error.status === 401) {
          router.replace('/login');
          return;
        }

        setState({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось проверить административный доступ. Попробуйте ещё раз.',
          ),
        });
      }
    }

    void checkAccess();
    return () => controller.abort();
  }, [attempt, pathname, router]);

  if (state.kind !== 'allowed') {
    return (
      <main className={styles.page}>
        <div className={styles.narrowContainer}>
          <nav className={styles.topNav}>
            <Link className={styles.backLink} href="/">
              ← На главную
            </Link>
            <Link className={styles.link} href="/account">
              Аккаунт
            </Link>
          </nav>

          {state.kind === 'loading' ? (
            <p className={styles.message} aria-live="polite">
              Проверяем административный доступ…
            </p>
          ) : null}

          {state.kind === 'forbidden' ? (
            <div className={`${styles.message} ${styles.warningMessage}`} role="alert">
              <h1 className={styles.panelTitle}>Недостаточно прав</h1>
              <p>Управление игровым каталогом доступно только администраторам.</p>
            </div>
          ) : null}

          {state.kind === 'banned' ? (
            <div className={`${styles.message} ${styles.warningMessage}`} role="alert">
              <h1 className={styles.panelTitle}>Административный доступ заблокирован</h1>
              <p>Заблокированный администратор не может просматривать или изменять каталог.</p>
            </div>
          ) : null}

          {state.kind === 'error' ? (
            <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
              <p>{state.message}</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => {
                  setState({ kind: 'loading' });
                  setAttempt((current) => current + 1);
                }}
              >
                Повторить
              </button>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <nav className={styles.topNav} aria-label="Административный каталог">
          <Link className={styles.backLink} href="/">
            ← На главную
          </Link>
          <div className={styles.navGroup}>
            <Link className={styles.link} href="/admin/catalog">
              Каталог
            </Link>
            <Link className={styles.link} href="/admin/catalog/bases">
              Базы
            </Link>
            <Link className={styles.link} href="/admin/catalog/fish">
              Рыбы
            </Link>
            <Link className={styles.link} href="/admin/catalog/baits">
              Наживки
            </Link>
            <Link className={styles.link} href="/account">
              {state.user.nickname}
            </Link>
          </div>
        </nav>
        {children}
      </div>
    </main>
  );
}
