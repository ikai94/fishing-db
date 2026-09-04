'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import styles from './application-shell.module.css';
import { getCurrentUser, type AuthUser } from '@/lib/auth-api';
import { isApiError } from '@/lib/api-client';

type UserHeaderState =
  { kind: 'loading' } | { kind: 'guest' } | { kind: 'ready'; user: AuthUser } | { kind: 'error' };

export function classifyCurrentUserError(error: unknown): 'guest' | 'error' {
  return isApiError(error) && error.status === 401 ? 'guest' : 'error';
}

export function GuestAuthActions() {
  return (
    <nav className={styles.guestActions} aria-label="Действия аккаунта">
      <Link className={styles.registerLink} href="/register">
        Регистрация
      </Link>
      <Link className={styles.loginLink} href="/login">
        Войти
      </Link>
    </nav>
  );
}

export function UserHeader() {
  const [state, setState] = useState<UserHeaderState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    void getCurrentUser(controller.signal).then(
      (user) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'ready', user });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: classifyCurrentUserError(error) });
      },
    );

    return () => controller.abort();
  }, [attempt]);

  if (state.kind === 'ready') {
    return (
      <Link className={styles.userLink} href="/account">
        <span className={styles.userInitial} aria-hidden="true">
          {state.user.nickname.slice(0, 1).toLocaleUpperCase('ru-RU')}
        </span>
        <span className={styles.userName}>{state.user.nickname}</span>
      </Link>
    );
  }

  if (state.kind === 'guest') {
    return <GuestAuthActions />;
  }

  if (state.kind === 'error') {
    return (
      <button
        className={styles.userRetry}
        type="button"
        onClick={() => {
          setState({ kind: 'loading' });
          setAttempt((current) => current + 1);
        }}
      >
        Проверить вход
      </button>
    );
  }

  return (
    <span className={styles.userLoading} aria-live="polite">
      Аккаунт…
    </span>
  );
}
