'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';
import styles from '../../catch-reports.module.css';
import { formatCatchDate, formatWeight } from '../_components/catch-report-list';
import { getCatchReport } from '@/lib/catch-reports-api';
import {
  fishingNoteLabel,
  formatCentimetersAsMeters,
  spotLandmarkLabel,
} from '@/lib/catch-report-form';
import { useApiResource } from '@/lib/use-api-resource';

export default function CatchReportDetailPage() {
  const { id: reportId } = useParams<{ id: string }>();
  const loadReport = useCallback(
    (signal: AbortSignal) => getCatchReport(reportId, signal),
    [reportId],
  );
  const { state, reload } = useApiResource(
    loadReport,
    'Не удалось загрузить отчёт об улове. Попробуйте ещё раз.',
  );

  return (
    <main className={styles.page}>
      <div className={styles.narrowContainer}>
        <nav className={styles.topNav} aria-label="Навигация по уловам">
          <Link className={styles.backLink} href="/catches">
            ← Все уловы
          </Link>
          <div className={styles.pageActions}>
            <Link className={styles.textLink} href="/my/catches">
              Мои уловы
            </Link>
            <Link className={styles.primaryLink} href="/catches/new">
              Добавить улов
            </Link>
          </div>
        </nav>

        {state.kind === 'loading' ? (
          <p className={styles.message} aria-live="polite">
            Загружаем отчёт…
          </p>
        ) : null}

        {state.kind === 'not-found' ? (
          <div className={styles.message}>
            <h1 className={styles.forbiddenTitle}>Отчёт не найден</h1>
            <p>Возможно, автор удалил его или ссылка устарела.</p>
            <Link className={styles.secondaryLink} href="/catches">
              Вернуться к уловам
            </Link>
          </div>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'ready' ? (
          <>
            <header className={styles.header}>
              <p className={styles.eyebrow}>{state.data.fishingBase.name}</p>
              <h1 className={styles.title}>{state.data.fish.name}</h1>
              <p className={styles.subtitle}>
                Отчёт игрока {state.data.author.nickname} от {formatCatchDate(state.data.createdAt)}
                .
              </p>
            </header>

            <article className={styles.panel}>
              <div className={styles.detailHeading}>
                <h2 className={styles.panelTitle}>Данные улова</h2>
                <p className={styles.weight}>{formatWeight(state.data.weightGrams)}</p>
              </div>
              <dl className={styles.detailGrid}>
                <div>
                  <dt>Автор</dt>
                  <dd>{state.data.author.nickname}</dd>
                </div>
                <div>
                  <dt>Рыболовная база</dt>
                  <dd>{state.data.fishingBase.name}</dd>
                </div>
                <div>
                  <dt>Локация</dt>
                  <dd>
                    {state.data.location.number}. {state.data.location.name}
                  </dd>
                </div>
                <div>
                  <dt>Рыба</dt>
                  <dd>{state.data.fish.name}</dd>
                </div>
                <div>
                  <dt>{state.data.bait.type === 'BAIT' ? 'Наживка' : 'Приманка'}</dt>
                  <dd>{state.data.bait.name}</dd>
                </div>
                <div>
                  <dt>Глубина ямки</dt>
                  <dd>
                    {state.data.holeDepthCm === null
                      ? 'не указана'
                      : `${formatCentimetersAsMeters(state.data.holeDepthCm)} м`}
                  </dd>
                </div>
                <div>
                  <dt>Ориентир</dt>
                  <dd>{spotLandmarkLabel(state.data.spotLandmark) ?? 'не указан'}</dd>
                </div>
                <div>
                  <dt>Условие ловли</dt>
                  <dd>{fishingNoteLabel(state.data.fishingNote) ?? 'не указано'}</dd>
                </div>
              </dl>

              {state.data.userNoteRaw !== null ? (
                <section>
                  <h2 className={styles.panelTitle}>Исходная заметка</h2>
                  <p className={styles.rawNote}>{state.data.userNoteRaw}</p>
                </section>
              ) : null}

              <dl className={styles.detailGrid}>
                <div>
                  <dt>Создан</dt>
                  <dd>{formatCatchDate(state.data.createdAt)}</dd>
                </div>
                <div>
                  <dt>Изменён</dt>
                  <dd>{formatCatchDate(state.data.updatedAt)}</dd>
                </div>
              </dl>
            </article>
          </>
        ) : null}
      </div>
    </main>
  );
}
