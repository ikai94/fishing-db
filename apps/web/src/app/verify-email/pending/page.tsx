'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { AuthScreen } from '../../_components/auth-screen';
import styles from '../../auth.module.css';
import { resendVerification } from '@/lib/auth-api';

function validateEmail(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Введите корректный email.';
  }

  return domain.endsWith('.ru')
    ? undefined
    : 'Разрешены только адреса в доменах, оканчивающихся на .ru.';
}

export default function VerificationPendingPage() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestAccepted, setRequestAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) return;

    const validationError = validateEmail(email);
    setEmailError(validationError);
    setRequestError(null);
    setRequestAccepted(false);

    if (validationError !== undefined) return;

    setIsSubmitting(true);

    try {
      await resendVerification({ email: email.trim() });
      setRequestAccepted(true);
    } catch {
      setRequestError('Не удалось отправить запрос. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="Подтверждение email"
      title="Проверьте почту"
      description="Мы отправили ссылку для подтверждения. До перехода по ней вход недоступен."
    >
      <div className={styles.infoBanner} role="status">
        <p>Проверьте также папку «Спам». Ссылка действует ограниченное время.</p>
      </div>

      {requestAccepted ? (
        <div className={styles.successBanner} role="status">
          <p>Если аккаунт с этим email ожидает подтверждения, новое письмо будет отправлено.</p>
        </div>
      ) : null}

      {requestError ? (
        <p className={styles.errorBanner} role="alert">
          {requestError}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="resend-email">
            Email
          </label>
          <input
            className={`${styles.input} ${emailError ? styles.invalidInput : ''}`}
            id="resend-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(undefined);
              setRequestAccepted(false);
            }}
            aria-invalid={emailError ? 'true' : undefined}
            aria-describedby={emailError ? 'resend-email-error' : undefined}
            required
          />
          {emailError ? (
            <p className={styles.fieldError} id="resend-email-error">
              {emailError}
            </p>
          ) : null}
        </div>

        <button
          className={styles.submitButton}
          type="submit"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Отправляем…' : 'Отправить письмо ещё раз'}
        </button>
      </form>

      <p className={styles.footer}>
        Уже подтвердили email?{' '}
        <Link className={styles.textLink} href="/login">
          Войти
        </Link>
      </p>
    </AuthScreen>
  );
}
