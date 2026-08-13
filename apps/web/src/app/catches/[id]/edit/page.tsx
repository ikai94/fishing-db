'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../../catch-reports.module.css';
import { CatchReportForm } from '../../_components/catch-report-form';
import { getOwnerCatchReport } from '@/lib/catch-reports-api';
import { useApiResource } from '@/lib/use-api-resource';
import { useRequiredUser } from '@/lib/use-required-user';

export default function EditCatchReportPage() {
  const { id: reportId } = useParams<{ id: string }>();
  const loadReport = useCallback(
    (signal: AbortSignal) => getOwnerCatchReport(reportId, signal),
    [reportId],
  );
  const reportResource = useApiResource(
    loadReport,
    'Не удалось загрузить отчёт. Попробуйте ещё раз.',
  );
  const userResource = useRequiredUser();

  const isLoading =
    reportResource.state.kind === 'loading' || userResource.state.kind === 'loading';

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Навигация по уловам">
          <Link className={styles.backLink} href={`/catches/${reportId}`}>
            ← К отчёту
          </Link>
          <Link className={styles.textLink} href="/my/catches">
            Мои уловы
          </Link>
        </nav>

        <header className={styles.header}>
          <p className={styles.eyebrow}>Личный архив</p>
          <h1 className={styles.title}>Редактировать улов</h1>
          <p className={styles.subtitle}>
            Исторические значения остаются доступными, даже если каталог с тех пор изменился.
          </p>
        </header>

        {isLoading ? (
          <p className={styles.message} aria-live="polite">
            Загружаем отчёт и проверяем аккаунт…
          </p>
        ) : null}

        {reportResource.state.kind === 'not-found' ? (
          <div className={styles.message}>
            <h2 className={styles.forbiddenTitle}>Отчёт не найден</h2>
            <p>Возможно, он уже удалён.</p>
            <Link className={styles.secondaryLink} href="/my/catches">
              Вернуться к моим уловам
            </Link>
          </div>
        ) : null}

        {reportResource.state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{reportResource.state.message}</p>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={reportResource.reload}
            >
              Повторить загрузку отчёта
            </button>
          </div>
        ) : null}

        {userResource.state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{userResource.state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={userResource.reload}>
              Повторить проверку аккаунта
            </button>
          </div>
        ) : null}

        {reportResource.state.kind === 'ready' && userResource.state.kind === 'ready' ? (
          reportResource.state.data.author.id !== userResource.state.user.id ? (
            <div className={`${styles.message} ${styles.warningMessage}`}>
              <h2 className={styles.forbiddenTitle}>Редактирование недоступно</h2>
              <p>Этот публичный отчёт принадлежит другому игроку.</p>
              <Link
                className={styles.secondaryLink}
                href={`/catches/${reportResource.state.data.id}`}
              >
                Читать отчёт
              </Link>
            </div>
          ) : userResource.state.user.isBanned ? (
            <div className={`${styles.message} ${styles.warningMessage}`} role="status">
              <h2 className={styles.forbiddenTitle}>Изменение недоступно</h2>
              <p>
                Аккаунт заблокирован. Отчёт остаётся доступен для чтения, но изменить его нельзя.
              </p>
              <Link
                className={styles.secondaryLink}
                href={`/catches/${reportResource.state.data.id}`}
              >
                Читать отчёт
              </Link>
            </div>
          ) : (
            <CatchReportForm initialReport={reportResource.state.data} />
          )
        ) : null}
      </div>
    </main>
  );
}
