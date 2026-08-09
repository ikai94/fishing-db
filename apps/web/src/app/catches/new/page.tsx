'use client';

import Link from 'next/link';
import styles from '../../catch-reports.module.css';
import { CatchReportForm } from '../_components/catch-report-form';
import { useRequiredUser } from '@/lib/use-required-user';

export default function NewCatchReportPage() {
  const { state, reload } = useRequiredUser();

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Навигация по уловам">
          <Link className={styles.backLink} href="/catches">
            ← Все уловы
          </Link>
          <Link className={styles.textLink} href="/my/catches">
            Мои уловы
          </Link>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Личный архив и общая база</p>
          <h1 className={styles.title}>Добавить улов</h1>
          <p className={styles.subtitle}>
            Автор определяется текущей сессией. Отчёт после публикации будет доступен всем.
          </p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Проверяем аккаунт…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' && state.user.isBanned ? (
          <div className={`${styles.message} ${styles.warningMessage}`} role="status">
            <h2 className={styles.forbiddenTitle}>Публикация недоступна</h2>
            <p>
              Аккаунт заблокирован. Вы можете читать публичные и свои прежние отчёты, но не
              создавать новые.
            </p>
            <Link className={styles.secondaryLink} href="/my/catches">
              Открыть мои уловы
            </Link>
          </div>
        ) : null}

        {state.kind === 'ready' && !state.user.isBanned ? <CatchReportForm /> : null}
      </div>
    </main>
  );
}
