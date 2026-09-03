import Link from 'next/link';
import styles from '../../../public-catalog.module.css';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';
import type { HoleStatistic } from '@/lib/hole-statistics-api';

type CommonHoleTableProps = {
  items: readonly HoleStatistic[];
};

export function CommonHoleTable({ items }: CommonHoleTableProps) {
  const confirmedItems = items.filter((item) => item.uniqueUsersCount >= 2);
  const singleUserItems = items.filter((item) => item.uniqueUsersCount === 1);

  return (
    <>
      {confirmedItems.length === 0 ? (
        <p className={styles.statisticsNote}>
          <span>Подтверждённых несколькими рыбаками точек пока нет.</span>
          <br />
          <span>Ниже показаны одиночные наблюдения.</span>
        </p>
      ) : null}

      <div
        className={styles.holeTableRegion}
        role="region"
        aria-label="Таблица общих рыболовных точек"
        tabIndex={0}
      >
        <table className={styles.holeTable}>
          <caption className={styles.visuallyHidden}>
            Общие ямы и позиции выбранной рыбы на выбранных базах
          </caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">База · Локация</th>
              <th scope="col">Яма</th>
              <th scope="col">Позиция</th>
              <th scope="col" title="Количество разных рыбаков">
                Рыбаков
              </th>
              <th scope="col" title="Количество отчётов об уловах">
                Уловов
              </th>
            </tr>
          </thead>
          {confirmedItems.length > 0 ? (
            <tbody>
              {confirmedItems.map((item, index) => (
                <CommonHoleRow
                  item={item}
                  number={index + 1}
                  key={`${item.location.id}:${item.holeDepthCm}:${item.spotPosition ?? ''}`}
                />
              ))}
            </tbody>
          ) : null}
          {singleUserItems.length > 0 ? (
            <tbody>
              <tr className={styles.holeDividerRow}>
                <th colSpan={6} scope="rowgroup">
                  Одиночные наблюдения
                </th>
              </tr>
              {singleUserItems.map((item, index) => (
                <CommonHoleRow
                  item={item}
                  number={confirmedItems.length + index + 1}
                  key={`${item.location.id}:${item.holeDepthCm}:${item.spotPosition ?? ''}`}
                />
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
    </>
  );
}

function CommonHoleRow({ item, number }: { item: HoleStatistic; number: number }) {
  return (
    <tr className={styles.holeRow}>
      <th className={styles.reportNumber} scope="row">
        {number}
      </th>
      <td className={styles.aggregateSingleLineCell} title={formatCommonHolePlace(item)}>
        <ActiveEntityLabel
          active={item.fishingBase.isActive}
          href={`/bases/${item.fishingBase.id}`}
          label={item.fishingBase.name}
        />
        {', '}
        <ActiveEntityLabel
          active={item.fishingBase.isActive && item.location.isActive}
          href={`/locations/${item.location.id}`}
          label={`${item.location.number}. ${item.location.name}`}
        />
      </td>
      <td className={styles.depthCell}>{formatCommonHoleDepth(item.holeDepthCm)} м</td>
      <td className={styles.positionCell}>
        {item.spotPosition ?? <span className={styles.secondaryText}>позиция не указана</span>}
      </td>
      <td className={styles.holeCountCell} title={`${item.uniqueUsersCount} разных рыбаков`}>
        {item.uniqueUsersCount}
      </td>
      <td className={styles.holeCountCell} title={`${item.reportsCount} отчётов об уловах`}>
        {item.reportsCount}
      </td>
    </tr>
  );
}

export function formatCommonHolePlace(
  item: Pick<HoleStatistic, 'fishingBase' | 'location'>,
): string {
  return `${item.fishingBase.name}, ${item.location.number}. ${item.location.name}`;
}

function ActiveEntityLabel({
  active,
  href,
  label,
}: {
  active: boolean;
  href: string;
  label: string;
}) {
  return active ? (
    <Link className={styles.entityLink} href={href}>
      {label}
    </Link>
  ) : (
    label
  );
}

export function formatCommonHoleDepth(holeDepthCm: number): string {
  return formatCentimetersAsMeters(holeDepthCm).replace(',', '.');
}
