'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { login } from '@/lib/auth-api';
import styles from '../auth.module.css';

type LoginField = 'email' | 'password';
type LoginErrors = Partial<Record<LoginField, string>>;

function validateForm(email: string, password: string): LoginErrors {
  const errors: LoginErrors = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    errors.email = 'Введите корректный email.';
  }

  if (password.length === 0) {
    errors.password = 'Введите пароль.';
  }

  return errors;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const validationErrors = validateForm(email, password);
    setFieldErrors(validationErrors);
    setServerError(null);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await login({ email: email.trim(), password });
      router.replace('/account');
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setServerError('Неверный email или пароль.');
      } else {
        setServerError(getApiErrorMessage(error, 'Не удалось войти. Попробуйте ещё раз.'));
      }

      if (isApiError(error)) {
        setFieldErrors({
          email: error.fieldErrors.email?.[0],
          password: error.fieldErrors.password?.[0],
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link className={styles.backLink} href="/">
          ← На главную
        </Link>
        <p className={styles.eyebrow}>Личный архив</p>
        <h1 className={styles.title}>Вход</h1>
        <p className={styles.description}>Войдите, чтобы открыть данные своего аккаунта.</p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {serverError ? (
            <p className={styles.errorBanner} role="alert">
              {serverError}
            </p>
          ) : null}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              Email
            </label>
            <input
              className={`${styles.input} ${fieldErrors.email ? styles.invalidInput : ''}`}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
              aria-invalid={fieldErrors.email ? 'true' : undefined}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
              required
            />
            {fieldErrors.email ? (
              <p className={styles.fieldError} id="login-email-error">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">
              Пароль
            </label>
            <input
              className={`${styles.input} ${fieldErrors.password ? styles.invalidInput : ''}`}
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              required
            />
            {fieldErrors.password ? (
              <p className={styles.fieldError} id="login-password-error">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <button
            className={styles.submitButton}
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Входим…' : 'Войти'}
          </button>
        </form>

        <p className={styles.footer}>
          Нет аккаунта?{' '}
          <Link className={styles.textLink} href="/register">
            Зарегистрироваться
          </Link>
        </p>
      </section>
    </main>
  );
}
