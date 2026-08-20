import styles from '../../../public-catalog.module.css';
import type { FishingConditionStatistic } from '@/lib/fishing-condition-statistics-api';
import {
  fishingMethodLabel,
  fishingNoteLabel,
  spinningSizeLabel,
  spinningSpeedLabel,
} from '@/lib/catch-report-form';
import { formatPublicFishCatchDate } from './public-fish-catch-table';

type FishingConditionStatisticsTableProps = {
  items: readonly FishingConditionStatistic[];
};

export function FishingConditionStatisticsTable({ items }: FishingConditionStatisticsTableProps) {
  return (
    <>
      <p className={styles.statisticsNote}>
        Порядок: сначала по числу разных рыбаков, затем по числу уловов.
      </p>
      <div
        className={styles.conditionTableRegion}
        role="region"
        aria-label="Таблица статистики условий ловли"
        tabIndex={0}
      >
        <table className={styles.conditionStatisticsTable}>
          <caption className={styles.visuallyHidden}>
            Условия ловли в уловах выбранной рыбы на выбранных базах
          </caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Способ ловли</th>
              <th scope="col">Размер спиннинга</th>
              <th scope="col">Скорость проводки</th>
              <th scope="col">Условие ловли</th>
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
                className={styles.conditionStatisticsRow}
                key={JSON.stringify([
                  item.fishingMethod,
                  item.fishingNote,
                  item.spinningSize,
                  item.spinningSpeed,
                ])}
              >
                <th className={styles.reportNumber} scope="row">
                  {index + 1}
                </th>
                <td>{fishingMethodLabel(item.fishingMethod)}</td>
                <td>
                  {item.fishingMethod === 'BAIT_FISHING'
                    ? 'не применяется'
                    : spinningSizeLabel(item.spinningSize)}
                </td>
                <td>
                  {item.fishingMethod === 'BAIT_FISHING'
                    ? 'не применяется'
                    : spinningSpeedLabel(item.spinningSpeed)}
                </td>
                <td>{fishingNoteLabel(item.fishingNote) ?? 'не указано'}</td>
                <td
                  className={styles.conditionStatisticsCountCell}
                  title={`${item.uniqueUsersCount} разных рыбаков`}
                >
                  {item.uniqueUsersCount}
                </td>
                <td
                  className={styles.conditionStatisticsCountCell}
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
