import styles from '../../../public-catalog.module.css';
import type { BaitStatistic } from '@/lib/bait-statistics-api';

type BaitStatisticsListProps = {
  items: readonly BaitStatistic[];
};

export function BaitStatisticsList({ items }: BaitStatisticsListProps) {
  return (
    <ul className={styles.baitStatisticsList} aria-label="Наживки и приманки по числу уловов">
      {items.map((item) => (
        <li className={styles.baitStatisticsItem} key={item.bait.id}>
          <span
            className={item.bait.isActive ? undefined : styles.inactiveBait}
            title={item.bait.isActive ? undefined : 'Сейчас неактивна'}
          >
            {item.bait.name}
            {!item.bait.isActive ? (
              <span className={styles.visuallyHidden}> (сейчас неактивна)</span>
            ) : null}
          </span>{' '}
          <span
            className={styles.baitStatisticsCount}
            title={`${item.reportsCount} отчётов об уловах`}
          >
            ({item.reportsCount})
          </span>
        </li>
      ))}
    </ul>
  );
}
