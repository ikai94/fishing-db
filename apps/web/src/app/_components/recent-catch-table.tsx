import Link from 'next/link';
import styles from '../page.module.css';
import { formatCompactWeight } from '@/lib/base-fish-weight';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';
import type { CatchReport } from '@/lib/catch-reports-api';

type RecentCatchTableProps = {
  reports: readonly CatchReport[];
};

export function RecentCatchTable({ reports }: RecentCatchTableProps) {
  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label="Таблица недавних уловов"
      tabIndex={0}
    >
      <table className={styles.catchTable}>
        <caption className={styles.visuallyHidden}>Десять последних публичных уловов</caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Рыба</th>
            <th scope="col">Вес</th>
            <th scope="col">База · локация</th>
            <th scope="col">На что</th>
            <th scope="col">Яма / ориентир</th>
            <th scope="col">Автор</th>
            <th scope="col">Добавлено</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report, index) => (
            <tr className={styles.catchRow} key={report.id}>
              <th className={styles.reportNumber} scope="row">
                {index + 1}
              </th>
              <td>
                <Link className={styles.reportLink} href={`/catches/${report.id}`}>
                  {report.fish.name}
                </Link>
              </td>
              <td className={styles.weightCell}>{formatCompactWeight(report.weightGrams)}</td>
              <td className={styles.placeCell}>
                <span>{report.fishingBase.name}</span>
                <span className={styles.secondaryText}>
                  {report.location.number}. {report.location.name}
                </span>
              </td>
              <td>{report.bait.name}</td>
              <td>{formatHoleAndSpot(report)}</td>
              <td>{report.author.nickname}</td>
              <td className={styles.dateCell}>
                <time dateTime={report.createdAt}>{formatRecentCatchDate(report.createdAt)}</time>
              </td>
            </tr>
          ))}
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
    report.spotPositionRaw !== null && report.spotPositionRaw.trim() !== ''
      ? report.spotPositionRaw
      : null,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? '—' : parts.join(' · ');
}

export function formatRecentCatchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const parts = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'Europe/Moscow',
  }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;

  return day && month && year ? `${day}.${month}.${year}` : value;
}
