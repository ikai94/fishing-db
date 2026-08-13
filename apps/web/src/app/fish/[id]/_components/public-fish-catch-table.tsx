import Link from 'next/link';
import styles from '../../../public-catalog.module.css';
import type { CatchReport } from '@/lib/catch-reports-api';
import {
  fishingNoteLabel,
  formatCentimetersAsMeters,
  spinningSizeLabel,
  spinningSpeedLabel,
} from '@/lib/catch-report-form';

type PublicFishCatchTableProps = {
  reports: CatchReport[];
};

type CatchCondition = Pick<
  CatchReport,
  'fishingMethod' | 'fishingNote' | 'holeDepthCm' | 'spinningSize' | 'spinningSpeed'
>;

const THOUSAND = 1_000;

export function PublicFishCatchTable({ reports }: PublicFishCatchTableProps) {
  return (
    <div
      className={styles.catchTableRegion}
      role="region"
      aria-label="Таблица публичных уловов"
      tabIndex={0}
    >
      <table className={styles.catchTable}>
        <caption className={styles.visuallyHidden}>
          Публичные уловы выбранной рыбы на выбранных базах
        </caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Вес</th>
            <th scope="col">База · Локация</th>
            <th scope="col">На что</th>
            <th scope="col">Условия ловли</th>
            <th scope="col">Точка / позиция</th>
            <th scope="col">Автор</th>
            <th scope="col">Дата</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report, index) => {
            const reportNumber = index + 1;

            return <ReportRows report={report} reportNumber={reportNumber} key={report.id} />;
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportRows({ report, reportNumber }: { report: CatchReport; reportNumber: number }) {
  return (
    <>
      <tr className={styles.catchRow}>
        <th className={styles.reportNumber} scope="row">
          <Link
            className={styles.entityLink}
            href={`/catches/${report.id}`}
            aria-label={`Улов №${reportNumber}: подробнее`}
          >
            {reportNumber}
          </Link>
        </th>
        <td className={styles.weightCell}>{formatPublicFishCatchWeight(report.weightGrams)}</td>
        <td className={styles.placeCell}>
          <span>{report.fishingBase.name}</span>
          <span className={styles.secondaryText}>
            {report.location.number}. {report.location.name}
          </span>
        </td>
        <td>{report.bait.name}</td>
        <td className={styles.conditionCell}>{formatPublicFishCatchCondition(report)}</td>
        <td className={styles.positionCell}>{report.spotPositionRaw ?? '—'}</td>
        <td className={styles.authorCell}>{report.author.nickname}</td>
        <td className={styles.dateCell}>
          <time dateTime={report.createdAt}>{formatPublicFishCatchDate(report.createdAt)}</time>
        </td>
      </tr>
      {report.userNoteRaw !== null && report.userNoteRaw.trim() !== '' ? (
        <tr className={styles.catchCommentRow}>
          <td className={styles.catchComment} colSpan={8}>
            <span className={styles.visuallyHidden}>Отчёт № {reportNumber}. </span>
            <span className={styles.secondaryText}>Комментарий:</span> {report.userNoteRaw}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function formatPublicFishCatchWeight(weightGrams: number): string {
  if (!Number.isInteger(weightGrams) || weightGrams <= 0) {
    throw new Error('Некорректный вес улова.');
  }

  if (weightGrams < THOUSAND) {
    return `${weightGrams.toLocaleString('ru-RU')} г`;
  }

  const kilograms = Math.trunc(weightGrams / THOUSAND);
  const grams = weightGrams % THOUSAND;
  if (grams === 0) return `${kilograms.toLocaleString('ru-RU')} кг`;

  const fraction = String(grams).padStart(3, '0').replace(/0+$/u, '');
  return `${kilograms.toLocaleString('ru-RU')}.${fraction} кг`;
}

export function formatPublicFishCatchCondition(report: CatchCondition): string {
  const fishingNote = fishingNoteLabel(report.fishingNote);

  if (report.fishingMethod === 'BAIT_FISHING') {
    const parts = [
      report.holeDepthCm === null ? null : `Яма ${formatDepth(report.holeDepthCm)} м`,
      fishingNote,
    ].filter(isPresent);

    return parts.length > 0 ? parts.join(' · ') : 'Ловля на наживку';
  }

  const parts = [
    'Спиннинг',
    lowerCaseLabel(spinningSizeLabel(report.spinningSize)),
    lowerCaseLabel(spinningSpeedLabel(report.spinningSpeed)),
    report.holeDepthCm === null ? null : `яма ${formatDepth(report.holeDepthCm)} м`,
    fishingNote,
  ].filter(isPresent);

  return parts.join(' · ');
}

export function formatPublicFishCatchDate(value: string): string {
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

function lowerCaseLabel(value: string | null): string | null {
  return value?.toLocaleLowerCase('ru-RU') ?? null;
}

function formatDepth(value: number): string {
  return formatCentimetersAsMeters(value).replace(',', '.');
}

function isPresent(value: string | null): value is string {
  return value !== null;
}
