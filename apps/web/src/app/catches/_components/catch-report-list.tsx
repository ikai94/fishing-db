import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from '../../catch-reports.module.css';
import type { CatchReport } from '@/lib/catch-reports-api';
import {
  fishingNoteLabel,
  fishingMethodLabel,
  formatCentimetersAsMeters,
  spinningSizeLabel,
  spinningSpeedLabel,
} from '@/lib/catch-report-form';

type CatchReportListProps = {
  reports: CatchReport[];
  renderActions?: (report: CatchReport) => ReactNode;
};

export function CatchReportList({ reports, renderActions }: CatchReportListProps) {
  return (
    <section className={styles.reportList} aria-label="Отчёты об уловах">
      {reports.map((report) => {
        const fishingNote = fishingNoteLabel(report.fishingNote);

        return (
          <article className={styles.reportCard} key={report.id}>
            <div className={styles.reportHeader}>
              <div>
                <p className={styles.reportEyebrow}>{report.fishingBase.name}</p>
                <h2 className={styles.reportTitle}>{report.fish.name}</h2>
              </div>
              <p className={styles.weight}>{formatWeight(report.weightGrams)}</p>
            </div>

            <p className={styles.locationLine}>
              Локация {report.location.number}: {report.location.name}
            </p>

            <dl className={styles.compactDetails}>
              <div>
                <dt>{report.fishingMethod === 'BAIT_FISHING' ? 'Наживка' : 'Приманка'}</dt>
                <dd>{report.bait.name}</dd>
              </div>
              <div>
                <dt>Способ</dt>
                <dd>{fishingMethodLabel(report.fishingMethod)}</dd>
              </div>
              {report.holeDepthCm !== null ? (
                <div>
                  <dt>Глубина</dt>
                  <dd>{formatCentimetersAsMeters(report.holeDepthCm)} м</dd>
                </div>
              ) : null}
              {report.spotPositionRaw !== null ? (
                <div>
                  <dt>Позиция</dt>
                  <dd>{report.spotPositionRaw}</dd>
                </div>
              ) : null}
              {fishingNote ? (
                <div>
                  <dt>Условие</dt>
                  <dd>{fishingNote}</dd>
                </div>
              ) : null}
              {report.spinningSize !== null ? (
                <div>
                  <dt>Размер</dt>
                  <dd>{spinningSizeLabel(report.spinningSize)}</dd>
                </div>
              ) : null}
              {report.spinningSpeed !== null ? (
                <div>
                  <dt>Скорость</dt>
                  <dd>{spinningSpeedLabel(report.spinningSpeed)}</dd>
                </div>
              ) : null}
            </dl>

            {report.userNoteRaw !== null ? (
              <p className={styles.rawNote}>{report.userNoteRaw}</p>
            ) : null}

            <footer className={styles.reportFooter}>
              <p className={styles.byline}>
                {report.author.nickname} · {formatCatchDate(report.createdAt)}
              </p>
              <div className={styles.inlineActions}>
                <Link className={styles.textLink} href={`/catches/${report.id}`}>
                  Подробнее
                </Link>
                {renderActions?.(report)}
              </div>
            </footer>
          </article>
        );
      })}
    </section>
  );
}

export function formatWeight(value: number): string {
  return `${value.toLocaleString('ru-RU')} г`;
}

export function formatCatchDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  });
}
