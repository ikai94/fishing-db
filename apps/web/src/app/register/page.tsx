'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { register } from '@/lib/auth-api';
import styles from '../auth.module.css';

type RegisterField = 'email' | 'nickname' | 'password' | 'passwordConfirmation';
type RegisterErrors = Partial<Record<RegisterField, string>>;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validateForm(
  email: string,
  nickname: string,
  password: string,
  passwordConfirmation: string,
): RegisterErrors {
  const errors: RegisterErrors = {};
  const trimmedEmail = email.trim();
  const emailDomain = trimmedEmail.slice(trimmedEmail.lastIndexOf('@') + 1).toLowerCase();
  const trimmedNickname = nickname.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    errors.email = 'Введите корректный email.';
  } else if (!emailDomain.endsWith('.ru')) {
    errors.email = 'Разрешены только адреса в доменах, оканчивающихся на .ru.';
  }

  const nicknameLength = codePointLength(trimmedNickname);

  if (nicknameLength < 3 || nicknameLength > 32) {
    errors.nickname = 'Никнейм должен содержать от 3 до 32 символов.';
  }

  const passwordLength = codePointLength(password);

  if (passwordLength < 15 || passwordLength > 128) {
    errors.password = 'Пароль должен содержать от 15 до 128 символов.';
  }

  if (passwordConfirmation !== password) {
    errors.passwordConfirmation = 'Пароли не совпадают.';
  }

  return errors;
}

function firstServerFieldError(error: unknown, field: RegisterField): string | undefined {
  return isApiError(error) ? error.fieldErrors[field]?.[0] : undefined;
}

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<RegisterErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const validationErrors = validateForm(email, nickname, password, passwordConfirmation);
    setFieldErrors(validationErrors);
    setServerError(null);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await register({ email: email.trim(), nickname: nickname.trim(), password });
      router.replace('/account');
    } catch (error) {
      const nextFieldErrors: RegisterErrors = {
        email: firstServerFieldError(error, 'email'),
        nickname: firstServerFieldError(error, 'nickname'),
        password: firstServerFieldError(error, 'password'),
      };

      if (isApiError(error) && error.code === 'EMAIL_ALREADY_EXISTS') {
        nextFieldErrors.email = 'Пользователь с таким email уже зарегистрирован.';
      }

      if (isApiError(error) && error.code === 'NICKNAME_ALREADY_EXISTS') {
        nextFieldErrors.nickname = 'Этот никнейм уже занят.';
      }

      setFieldErrors(nextFieldErrors);

      if (Object.values(nextFieldErrors).every((message) => message === undefined)) {
        setServerError(
          getApiErrorMessage(error, 'Не удалось зарегистрироваться. Попробуйте ещё раз.'),
        );
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
        <h1 className={styles.title}>Регистрация</h1>
        <p className={styles.description}>
          Создайте аккаунт, чтобы пользоваться личным архивом уловов.
        </p>

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
              aria-describedby={fieldErrors.email ? 'email-error' : 'email-hint'}
              required
            />
            <p className={styles.fieldHint} id="email-hint">
              Адрес должен оканчиваться на .ru.
            </p>
            {fieldErrors.email ? (
              <p className={styles.fieldError} id="email-error">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="nickname">
              Никнейм
            </label>
            <input
              className={`${styles.input} ${fieldErrors.nickname ? styles.invalidInput : ''}`}
              id="nickname"
              name="nickname"
              type="text"
              autoComplete="nickname"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setFieldErrors((current) => ({ ...current, nickname: undefined }));
              }}
              aria-invalid={fieldErrors.nickname ? 'true' : undefined}
              aria-describedby={fieldErrors.nickname ? 'nickname-error' : undefined}
              required
            />
            {fieldErrors.nickname ? (
              <p className={styles.fieldError} id="nickname-error">
                {fieldErrors.nickname}
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
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              aria-invalid={fieldErrors.password ? 'true' : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
              required
            />
            <p className={styles.fieldHint} id="password-hint">
              От 15 до 128 символов.
            </p>
            {fieldErrors.password ? (
              <p className={styles.fieldError} id="password-error">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password-confirmation">
              Повторите пароль
            </label>
            <input
              className={`${styles.input} ${
                fieldErrors.passwordConfirmation ? styles.invalidInput : ''
              }`}
              id="password-confirmation"
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
                fieldErrors.passwordConfirmation ? 'password-confirmation-error' : undefined
              }
              required
            />
            {fieldErrors.passwordConfirmation ? (
              <p className={styles.fieldError} id="password-confirmation-error">
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
            {isSubmitting ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
          </button>
        </form>

        <p className={styles.footer}>
          Уже есть аккаунт?{' '}
          <Link className={styles.textLink} href="/login">
            Войти
          </Link>
        </p>
      </section>
    </main>
  );
}
