'use client';

import Link from 'next/link';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { AuthScreen } from '../_components/auth-screen';
import styles from '../auth.module.css';
import { forgotPassword } from '@/lib/auth-api';

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

export default function ForgotPasswordPage() {
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
      await forgotPassword({ email: email.trim() });
      setRequestAccepted(true);
    } catch {
      setRequestError('Не удалось отправить запрос. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="Восстановление доступа"
      title="Забыли пароль?"
      description="Укажите email аккаунта. Если сброс доступен, мы отправим одноразовую ссылку."
    >
      {requestAccepted ? (
        <div className={styles.successBanner} role="status">
          <p>
            Если для этого email доступен сброс пароля, письмо будет отправлено. Проверьте также
            папку «Спам».
          </p>
        </div>
      ) : null}

      {requestError ? (
        <p className={styles.errorBanner} role="alert">
          {requestError}
        </p>
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="forgot-email">
            Email
          </label>
          <input
            className={`${styles.input} ${emailError ? styles.invalidInput : ''}`}
            id="forgot-email"
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
            aria-describedby={emailError ? 'forgot-email-error' : undefined}
            required
          />
          {emailError ? (
            <p className={styles.fieldError} id="forgot-email-error">
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
          {isSubmitting ? 'Отправляем…' : 'Получить ссылку для сброса'}
        </button>
      </form>

      <p className={styles.footer}>
        <Link className={styles.textLink} href="/login">
          Вернуться ко входу
        </Link>
      </p>
    </AuthScreen>
  );
}
