'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { AuthScreen } from '../_components/auth-screen';
import styles from '../auth.module.css';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { verifyEmail } from '@/lib/auth-api';
import { captureAndClearAuthToken } from '@/lib/auth-token-fragment';

type VerificationState =
  | { kind: 'verifying' }
  | { kind: 'missing' }
  | { kind: 'verified' }
  | { kind: 'error'; message: string; retryable: boolean };

export default function VerifyEmailPage() {
  const tokenRef = useRef<string | null | undefined>(undefined);
  const requestRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<VerificationState>({ kind: 'verifying' });
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    if (tokenRef.current === undefined) {
      tokenRef.current = captureAndClearAuthToken(window.location, window.history);
    }

    const token = tokenRef.current;

    if (token === null) {
      setState({ kind: 'missing' });
      return;
    }

    const request = requestRef.current ?? verifyEmail(token);
    requestRef.current = request;
    let active = true;

    void request.then(
      () => {
        if (!active) return;
        tokenRef.current = null;
        setState({ kind: 'verified' });
      },
      (error: unknown) => {
        if (!active) return;
        const invalidToken =
          isApiError(error) && error.code === 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN';
        setState({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось подтвердить email. Проверьте соединение и попробуйте ещё раз.',
          ),
          retryable: !invalidToken,
        });
      },
    );

    return () => {
      active = false;
    };
  }, [attempt]);

  function retry() {
    requestRef.current = null;
    setState({ kind: 'verifying' });
    setAttempt((current) => current + 1);
  }

  return (
    <AuthScreen
      eyebrow="Подтверждение email"
      title="Подтверждаем адрес"
      description="Ссылка проверяется автоматически. Вход будет доступен после успешного подтверждения."
    >
      {state.kind === 'verifying' ? (
        <p className={styles.status} aria-live="polite">
          Подтверждаем email…
        </p>
      ) : null}

      {state.kind === 'missing' ? (
        <div className={styles.errorBanner} role="alert">
          <p>В ссылке нет токена подтверждения.</p>
          <p>Запросите новое письмо и перейдите по ссылке из него.</p>
        </div>
      ) : null}

      {state.kind === 'verified' ? (
        <div className={styles.successBanner} role="status">
          <p>Email подтверждён. Теперь можно войти в аккаунт.</p>
        </div>
      ) : null}

      {state.kind === 'error' ? (
        <div className={styles.errorBanner} role="alert">
          <p>{state.message}</p>
        </div>
      ) : null}

      <div className={styles.buttonRow}>
        {state.kind === 'verified' ? (
          <Link className={styles.textLink} href="/login">
            Войти
          </Link>
        ) : null}
        {state.kind === 'error' && state.retryable ? (
          <button className={styles.secondaryButton} type="button" onClick={retry}>
            Повторить
          </button>
        ) : null}
        {state.kind === 'missing' || state.kind === 'error' ? (
          <Link className={styles.textLink} href="/verify-email/pending">
            Отправить письмо ещё раз
          </Link>
        ) : null}
      </div>
    </AuthScreen>
  );
}
