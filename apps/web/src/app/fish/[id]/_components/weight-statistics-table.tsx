import styles from '../../../public-catalog.module.css';
import {
  BASE_FISH_WEIGHT_CLASSIFICATIONS,
  weightClassificationLabel,
} from '@/lib/base-fish-weight';
import type { WeightStatistics } from '@/lib/weight-statistics-api';

export function WeightStatisticsTable({ counts }: { counts: WeightStatistics }) {
  const rows = BASE_FISH_WEIGHT_CLASSIFICATIONS.filter(
    (classification) => counts[classification] > 0,
  );

  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label="Статистика классификации веса"
      tabIndex={0}
    >
      <table className={styles.weightStatisticsTable}>
        <caption className={styles.visuallyHidden}>
          Классификация веса уловов на выбранных базах
        </caption>
        <thead>
          <tr>
            <th scope="col">Классификация</th>
            <th scope="col">Уловов</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((classification) => (
            <tr key={classification}>
              <th scope="row">{weightClassificationLabel(classification)}</th>
              <td>{counts[classification].toLocaleString('ru-RU')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
