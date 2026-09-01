import styles from '../../../public-catalog.module.css';
import { anomalyWeightLabel, formatCompactWeight } from '@/lib/base-fish-weight';
import type { FishCatchAggregate } from '@/lib/fish-catch-aggregates-api';

type PublicFishCatchTableProps = {
  rows: FishCatchAggregate[];
};

export function PublicFishCatchTable({ rows }: PublicFishCatchTableProps) {
  return (
    <div
      className={styles.catchTableRegion}
      role="region"
      aria-label="Таблица агрегированных уловов"
      tabIndex={0}
    >
      <table className={styles.catchTable}>
        <caption className={styles.visuallyHidden}>
          Агрегированные уловы выбранной рыбы на выбранных базах
        </caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">База · Локация</th>
            <th scope="col">На что</th>
            <th scope="col">Интенсивность</th>
            <th scope="col">Наблюдаемый максимум веса</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={styles.catchRow}
              key={`${row.fish.id}:${row.fishingBase.id}:${row.location.id}:${row.bait.id}`}
            >
              <th className={styles.reportNumber} scope="row">
                {index + 1}
              </th>
              <td className={styles.placeCell}>
                <span>{row.fishingBase.name}</span>
                <span className={styles.secondaryText}>
                  {row.location.number}. {row.location.name}
                </span>
              </td>
              <td>
                <span>{row.bait.name}</span>
                {!row.bait.isActive ? (
                  <span className={styles.secondaryText}>Сейчас неактивна</span>
                ) : null}
              </td>
              <td className={styles.aggregateCountCell}>
                <span title={`${row.intensity} отчётов об уловах`}>{row.intensity}</span>
                <span
                  className={styles.secondaryText}
                  title={`${row.contributorCount} разных участников`}
                >
                  участников: {row.contributorCount}
                </span>
              </td>
              <td className={styles.weightCell}>
                {formatPublicFishCatchWeight(row.maxObservedWeightGrams)}
                {anomalyWeightLabel(row.maxObservedWeightAssessment.classification) ? (
                  <span className={styles.secondaryText}>
                    {anomalyWeightLabel(row.maxObservedWeightAssessment.classification)}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatPublicFishCatchWeight(weightGrams: number): string {
  return formatCompactWeight(weightGrams);
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
