import Link from 'next/link';
import styles from '../page.module.css';
import { anomalyWeightLabel } from '@/lib/base-fish-weight';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';
import type { CatchReport } from '@/lib/catch-reports-api';

const SPEED_ABBREVIATIONS = {
  SLOW: 'медл',
  MEDIUM: 'ср',
  FAST: 'быстр',
} as const;
const SIZE_ABBREVIATIONS = {
  SMALL: 'мал',
  MEDIUM: 'ср',
  LARGE: 'бол',
} as const;

type OwnerCatchTableProps = {
  reports: readonly CatchReport[];
  isBanned: boolean;
  deletingId: string | null;
  onDelete: (report: CatchReport) => void;
};

export function OwnerCatchTable({ reports, isBanned, deletingId, onDelete }: OwnerCatchTableProps) {
  return (
    <div className={styles.tableRegion} role="region" aria-label="Таблица моих уловов" tabIndex={0}>
      <table className={styles.catchTable}>
        <caption className={styles.visuallyHidden}>Личный архив уловов</caption>
        <thead>
          <tr>
            <th scope="col">Рыба</th>
            <th scope="col">Вес</th>
            <th scope="col">База · локация</th>
            <th scope="col">Снасть</th>
            <th scope="col">Яма / позиция</th>
            <th scope="col">Проводка / размер</th>
            <th scope="col">Комментарий</th>
            <th scope="col">Добавлено</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const weightAnomaly = anomalyWeightLabel(report.weightAssessment.classification);
            const holeAndSpot = formatHoleAndSpot(report);
            const place = formatPlace(report);
            const spinningSettings = formatSpinningSettings(report);
            const weight = formatWeight(report.weightGrams);

            return (
              <tr key={report.id}>
                <th scope="row">
                  <Link
                    className={styles.reportLink}
                    href={`/catches/${report.id}`}
                    title={report.fish.name}
                  >
                    {report.fish.name}
                  </Link>
                </th>
                <td
                  className={styles.weightCell}
                  title={weightAnomaly === null ? weight : `${weight} · ${weightAnomaly}`}
                >
                  {weight}
                  {weightAnomaly ? (
                    <span className={styles.weightAnomaly}> · {weightAnomaly}</span>
                  ) : null}
                </td>
                <td className={styles.singleLineCell} title={place}>
                  {place}
                </td>
                <td className={styles.singleLineCell} title={report.bait.name}>
                  {report.bait.name}
                </td>
                <td className={styles.singleLineCell} title={holeAndSpot}>
                  {holeAndSpot}
                </td>
                <td className={styles.singleLineCell} title={spinningSettings}>
                  {spinningSettings}
                </td>
                <td>
                  {report.userNoteRaw === null ? (
                    <span className={styles.emptyValue}>—</span>
                  ) : (
                    <span className={styles.commentText} title={report.userNoteRaw}>
                      {report.userNoteRaw}
                    </span>
                  )}
                </td>
                <td className={styles.dateCell}>
                  <time dateTime={report.createdAt}>{formatCatchDate(report.createdAt)}</time>
                </td>
                <td>
                  <div className={styles.rowActions}>
                    <Link className={styles.actionLink} href={`/catches/${report.id}`}>
                      Открыть
                    </Link>
                    {isBanned ? (
                      <>
                        <button className={styles.rowButton} type="button" disabled>
                          Изменение недоступно
                        </button>
                        <button className={styles.dangerButton} type="button" disabled>
                          Удаление недоступно
                        </button>
                      </>
                    ) : (
                      <>
                        <Link className={styles.actionLink} href={`/catches/${report.id}/edit`}>
                          Редактировать
                        </Link>
                        <button
                          className={styles.dangerButton}
                          type="button"
                          onClick={() => onDelete(report)}
                          disabled={deletingId !== null}
                        >
                          {deletingId === report.id ? 'Удаляем…' : 'Удалить'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function formatHoleAndSpot(
  report: Pick<CatchReport, 'holeDepthCm' | 'spotPositionRaw'>,
): string {
  const parts = [
    report.holeDepthCm === null ? null : `Яма ${formatCentimetersAsMeters(report.holeDepthCm)} м`,
    report.spotPositionRaw,
  ].filter((part): part is string => part !== null && part !== '');

  return parts.length === 0 ? '—' : parts.join(' · ');
}

export function formatPlace(report: Pick<CatchReport, 'fishingBase' | 'location'>): string {
  return `${report.fishingBase.name}, ${report.location.number}. ${report.location.name}`;
}

export function formatSpinningSettings(
  report: Pick<CatchReport, 'fishingMethod' | 'spinningSize' | 'spinningSpeed'>,
): string {
  if (report.fishingMethod === 'BAIT_FISHING') return '—';
  if (report.spinningSpeed === null && report.spinningSize === null) return '—';

  const speed = report.spinningSpeed === null ? '-' : SPEED_ABBREVIATIONS[report.spinningSpeed];
  const size = report.spinningSize === null ? '-' : SIZE_ABBREVIATIONS[report.spinningSize];
  return `${speed}/${size}`;
}

export function formatWeight(value: number): string {
  return `${value.toLocaleString('ru-RU')} г`;
}

export function formatCatchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}
