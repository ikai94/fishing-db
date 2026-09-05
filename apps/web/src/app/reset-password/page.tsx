'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { AuthScreen } from '../_components/auth-screen';
import styles from '../auth.module.css';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { resetPassword } from '@/lib/auth-api';
import { captureAndClearAuthToken } from '@/lib/auth-token-fragment';

type ResetField = 'password' | 'passwordConfirmation';
type ResetErrors = Partial<Record<ResetField, string>>;
type TokenState = 'capturing' | 'ready' | 'invalid';

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validateForm(password: string, confirmation: string): ResetErrors {
  const errors: ResetErrors = {};
  const length = codePointLength(password);

  if (length < 15 || length > 128) {
    errors.password = 'Пароль должен содержать от 15 до 128 символов.';
  }

  if (confirmation !== password) {
    errors.passwordConfirmation = 'Пароли не совпадают.';
  }

  return errors;
}

export default function ResetPasswordPage() {
  const tokenRef = useRef<string | null | undefined>(undefined);
  const [tokenState, setTokenState] = useState<TokenState>('capturing');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ResetErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useLayoutEffect(() => {
    if (tokenRef.current === undefined) {
      tokenRef.current = captureAndClearAuthToken(window.location, window.history);
    }

    setTokenState(tokenRef.current === null ? 'invalid' : 'ready');
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || tokenRef.current === null || tokenRef.current === undefined) return;

    const validationErrors = validateForm(password, passwordConfirmation);
    setFieldErrors(validationErrors);
    setRequestError(null);

    if (Object.keys(validationErrors).length > 0) return;

    setIsSubmitting(true);

    try {
      await resetPassword({ token: tokenRef.current, password });
      tokenRef.current = null;
      setPassword('');
      setPasswordConfirmation('');
      setCompleted(true);
    } catch (error) {
      if (isApiError(error) && error.code === 'INVALID_OR_EXPIRED_RESET_TOKEN') {
        tokenRef.current = null;
        setTokenState('invalid');
      } else {
        setRequestError(
          getApiErrorMessage(error, 'Не удалось сохранить новый пароль. Попробуйте ещё раз.'),
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="Восстановление доступа"
      title="Новый пароль"
      description="Задайте новый пароль. После сброса нужно будет войти заново на всех устройствах."
    >
      {tokenState === 'capturing' ? (
        <p className={styles.status} aria-live="polite">
          Проверяем ссылку…
        </p>
      ) : null}

      {tokenState === 'invalid' && !completed ? (
        <div className={styles.errorBanner} role="alert">
          <p>Ссылка сброса недействительна, уже использована или истекла.</p>
        </div>
      ) : null}

      {completed ? (
        <div className={styles.successBanner} role="status">
          <p>Пароль изменён. Все прежние сеансы завершены.</p>
        </div>
      ) : null}

      {requestError ? (
        <p className={styles.errorBanner} role="alert">
          {requestError}
        </p>
      ) : null}

      {tokenState === 'ready' && !completed ? (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-password">
              Новый пароль
            </label>
            <input
              className={`${styles.input} ${fieldErrors.password ? styles.invalidInput : ''}`}
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={
                fieldErrors.password ? 'reset-password-error' : 'reset-password-hint'
              }
              required
            />
            <p className={styles.fieldHint} id="reset-password-hint">
              От 15 до 128 символов.
            </p>
            {fieldErrors.password ? (
              <p className={styles.fieldError} id="reset-password-error">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="reset-password-confirmation">
              Повторите пароль
            </label>
            <input
              className={`${styles.input} ${
                fieldErrors.passwordConfirmation ? styles.invalidInput : ''
              }`}
              id="reset-password-confirmation"
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => {
                setPasswordConfirmation(event.target.value);
                setFieldErrors((current) => ({
                  ...current,
                  passwordConfirmation: undefined,
                }));
              }}
              aria-invalid={fieldErrors.passwordConfirmation ? 'true' : undefined}
              aria-describedby={
                fieldErrors.passwordConfirmation ? 'reset-password-confirmation-error' : undefined
              }
              required
            />
            {fieldErrors.passwordConfirmation ? (
              <p className={styles.fieldError} id="reset-password-confirmation-error">
                {fieldErrors.passwordConfirmation}
              </p>
            ) : null}
          </div>

          <button
            className={styles.submitButton}
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Сохраняем…' : 'Сохранить новый пароль'}
          </button>
        </form>
      ) : null}

      {completed || tokenState === 'invalid' ? (
        <div className={styles.footerLinks}>
          {completed ? (
            <Link className={styles.textLink} href="/login">
              Войти
            </Link>
          ) : null}
          {tokenState === 'invalid' ? (
            <Link className={styles.textLink} href="/forgot-password">
              Запросить новую ссылку
            </Link>
          ) : null}
        </div>
      ) : null}
    </AuthScreen>
  );
}
