import styles from '../../../public-catalog.module.css';
import { fishingMethodLabel } from '@/lib/catch-report-form';
import type { BaitStatistic } from '@/lib/bait-statistics-api';
import { formatPublicFishCatchDate } from './public-fish-catch-table';

type BaitStatisticsTableProps = {
  items: readonly BaitStatistic[];
};

export function BaitStatisticsTable({ items }: BaitStatisticsTableProps) {
  return (
    <>
      <p className={styles.statisticsNote}>
        Порядок: сначала по числу разных рыбаков, затем по числу уловов.
      </p>
      <div
        className={styles.baitTableRegion}
        role="region"
        aria-label="Таблица статистики наживок и приманок"
        tabIndex={0}
      >
        <table className={styles.baitStatisticsTable}>
          <caption className={styles.visuallyHidden}>
            Наживки и приманки в уловах выбранной рыбы на выбранных базах
          </caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Наживка / приманка</th>
              <th scope="col">Способ ловли в отчётах</th>
              <th scope="col" title="Количество разных рыбаков">
                Рыбаков
              </th>
              <th scope="col" title="Количество отчётов об уловах">
                Уловов
              </th>
              <th scope="col">Последний отчёт</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr
                className={styles.baitStatisticsRow}
                key={`${item.bait.id}:${item.fishingMethod}`}
              >
                <th className={styles.reportNumber} scope="row">
                  {index + 1}
                </th>
                <td>
                  <span>{item.bait.name}</span>
                  {!item.bait.isActive ? (
                    <span className={styles.secondaryText}>Сейчас неактивна</span>
                  ) : null}
                </td>
                <td>{fishingMethodLabel(item.fishingMethod)}</td>
                <td
                  className={styles.baitStatisticsCountCell}
                  title={`${item.uniqueUsersCount} разных рыбаков`}
                >
                  {item.uniqueUsersCount}
                </td>
                <td
                  className={styles.baitStatisticsCountCell}
                  title={`${item.reportsCount} отчётов об уловах`}
                >
                  {item.reportsCount}
                </td>
                <td className={styles.dateCell}>
                  <time dateTime={item.latestReportCreatedAt}>
                    {formatPublicFishCatchDate(item.latestReportCreatedAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
