'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import styles from './page.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { AuthUser, getCurrentUser, logout } from '@/lib/auth-api';

type AccountState =
  { kind: 'loading' } | { kind: 'ready'; user: AuthUser } | { kind: 'error'; message: string };

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default function AccountPage() {
  const router = useRouter();
  const [state, setState] = useState<AccountState>({ kind: 'loading' });
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccount() {
      try {
        const user = await getCurrentUser(controller.signal);
        setState({ kind: 'ready', user });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
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
            'Не удалось загрузить аккаунт. Проверьте соединение и попробуйте снова.',
          ),
        });
      }
    }

    void loadAccount();

    return () => controller.abort();
  }, [retryAttempt, router]);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      await logout();
      router.replace('/login');
      router.refresh();
    } catch (error) {
      setLogoutError(getApiErrorMessage(error, 'Не удалось выйти. Попробуйте ещё раз.'));
      setIsLoggingOut(false);
    }
  }

  function retry() {
    setState({ kind: 'loading' });
    setRetryAttempt((attempt) => attempt + 1);
  }

  return (
    <ApplicationShell>
      <section className={styles.page} aria-labelledby="account-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Личный архив</p>
            <h1 className={styles.title} id="account-title">
              Аккаунт
            </h1>
          </div>
          <p className={styles.subtitle}>Профиль и доступные действия текущего пользователя.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем данные аккаунта…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.button} type="button" onClick={retry}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <dl className={styles.profileSummary} aria-label="Данные профиля">
              <div>
                <dt>Никнейм</dt>
                <dd>{state.user.nickname}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{state.user.email}</dd>
              </div>
              <div>
                <dt>Роль</dt>
                <dd>{state.user.role === 'ADMIN' ? 'Администратор' : 'Пользователь'}</dd>
              </div>
              <div>
                <dt>Статус</dt>
                <dd className={state.user.isBanned ? styles.bannedStatus : styles.activeStatus}>
                  {state.user.isBanned ? 'Заблокирован' : 'Активен'}
                </dd>
              </div>
            </dl>

            {state.user.isBanned ? (
              <p className={`${styles.statusMessage} ${styles.warningMessage}`} role="status">
                Аккаунт заблокирован. Создание, изменение и удаление публичных отчётов недоступны.
              </p>
            ) : null}

            {logoutError ? (
              <p className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
                {logoutError}
              </p>
            ) : null}

            <div className={styles.actions}>
              <Link className={styles.primaryLink} href="/my/catches">
                Мои уловы
              </Link>
              {state.user.role === 'ADMIN' && !state.user.isBanned ? (
                <Link className={styles.secondaryLink} href="/admin/catalog">
                  Управлять игровым каталогом
                </Link>
              ) : null}
              <button
                className={styles.button}
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                aria-busy={isLoggingOut}
              >
                {isLoggingOut ? 'Выходим…' : 'Выйти'}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </ApplicationShell>
  );
}
