import styles from '../../../public-catalog.module.css';
import { BaitImage } from '@/components/bait-image';
import { anomalyWeightLabel, formatCompactWeight } from '@/lib/base-fish-weight';
import { formatCentimetersAsMeters } from '@/lib/catch-report-form';
import type {
  FishCatchAggregate,
  FishCatchHoleSpotSummary,
  FishCatchIntensityOrder,
  FishCatchSpinningCombination,
  FishCatchTextSummary,
} from '@/lib/fish-catch-aggregates-api';

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

type PublicFishCatchTableProps = {
  rows: FishCatchAggregate[];
  intensityOrder: FishCatchIntensityOrder;
  onIntensityOrderChange: (order: FishCatchIntensityOrder) => void;
};

export function PublicFishCatchTable({
  rows,
  intensityOrder,
  onIntensityOrderChange,
}: PublicFishCatchTableProps) {
  return (
    <div
      className={styles.catchTableRegion}
      role="region"
      aria-label="Таблица агрегированных уловов"
      tabIndex={0}
    >
      <table className={`${styles.catchTable} ${styles.aggregateCatchTable}`}>
        <caption className={styles.visuallyHidden}>
          Агрегированные уловы выбранной рыбы на выбранных базах
        </caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">База · Локация</th>
            <th scope="col">Яма / ориентир</th>
            <th scope="col">На что</th>
            <th scope="col">Проводка / размер</th>
            <th scope="col">Комментарий</th>
            <th scope="col" aria-sort={intensityOrder === 'asc' ? 'ascending' : 'descending'}>
              <button
                className={styles.catchSortButton}
                type="button"
                onClick={() => onIntensityOrderChange(intensityOrder === 'asc' ? 'desc' : 'asc')}
                aria-label={`Уловы: сортировать ${intensityOrder === 'asc' ? 'по убыванию' : 'по возрастанию'}`}
              >
                Уловы
                <span aria-hidden="true">{intensityOrder === 'asc' ? '↑' : '↓'}</span>
              </button>
            </th>
            <th scope="col">Наблюдаемый / максимальный вес</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={`${styles.catchRow} ${isLocationGroupStart(rows, index) ? styles.catchLocationStartRow : ''}`}
              key={`${row.fish.id}:${row.fishingBase.id}:${row.location.id}:${row.bait.id}`}
            >
              <th className={styles.reportNumber} scope="row">
                {index + 1}
              </th>
              <td
                className={`${styles.aggregateSingleLineCell} ${styles.catchPlaceCell}`}
                title={formatFishCatchPlace(row)}
              >
                {formatFishCatchPlace(row)}
              </td>
              <td
                className={styles.aggregateSingleLineCell}
                title={singleHoleSpotSummaryValue(row.holeSpotSummary)}
              >
                {formatFishCatchHoleSpotSummary(row.holeSpotSummary)}
              </td>
              <td>
                <span className={styles.catchBaitCellContent}>
                  <BaitImage baitName={row.bait.name} image={row.bait.image} variant="compact" />
                  <span>
                    <span className={styles.catchBaitName}>{row.bait.name}</span>
                    {!row.bait.isActive ? (
                      <span className={styles.secondaryText}>Сейчас неактивна</span>
                    ) : null}
                  </span>
                </span>
              </td>
              <td className={styles.spinningCombinationsCell}>
                {formatSpinningCombinations(row.spinningCombinations)}
              </td>
              <td
                className={styles.aggregateSingleLineCell}
                title={singleSummaryValue(row.userNoteRawSummary)}
              >
                {formatFishCatchTextSummary(row.userNoteRawSummary)}
              </td>
              <td className={styles.aggregateCountCell} title={`${row.intensity} уловов`}>
                <span
                  className={`${styles.catchCountValue} ${row.intensity >= 50 ? styles.catchCountValueHigh : ''}`}
                >
                  {row.intensity}
                </span>
              </td>
              <td className={styles.weightCell}>
                {formatObservedAndMaximumWeight(
                  row.maxObservedWeightGrams,
                  row.maxObservedWeightAssessment.maxWeightGrams,
                )}
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

function isLocationGroupStart(rows: readonly FishCatchAggregate[], index: number): boolean {
  if (index === 0) return false;
  const previous = rows[index - 1];
  const current = rows[index];
  return (
    previous?.fishingBase.id !== current?.fishingBase.id ||
    previous.location.id !== current.location.id
  );
}

export function formatFishCatchPlace(
  row: Pick<FishCatchAggregate, 'fishingBase' | 'location'>,
): string {
  return `${row.fishingBase.name}, ${row.location.number}. ${row.location.name}`;
}

export function formatFishCatchTextSummary(summary: FishCatchTextSummary): string {
  if (summary.distinctCount === 0) return '—';
  if (summary.distinctCount > 1) return `несколько (${summary.distinctCount})`;
  return summary.value ?? '—';
}

export function formatFishCatchHoleSpotSummary(summary: FishCatchHoleSpotSummary): string {
  if (summary.distinctCount === 0) return '—';
  if (summary.distinctCount > 1) return `несколько (${summary.distinctCount})`;
  if (summary.value === null) return '—';

  const depth =
    summary.value.holeDepthCm === null
      ? null
      : `${formatCentimetersAsMeters(summary.value.holeDepthCm).replace(',', '.')} м`;
  if (depth !== null && summary.value.spotPositionRaw !== null) {
    return `${depth} ${summary.value.spotPositionRaw}`;
  }
  return depth ?? summary.value.spotPositionRaw ?? '—';
}

function singleHoleSpotSummaryValue(summary: FishCatchHoleSpotSummary): string | undefined {
  return summary.distinctCount === 1 ? formatFishCatchHoleSpotSummary(summary) : undefined;
}

function singleSummaryValue(summary: FishCatchTextSummary): string | undefined {
  return summary.distinctCount === 1 ? (summary.value ?? undefined) : undefined;
}

export function formatSpinningCombination({
  spinningSpeed,
  spinningSize,
}: FishCatchSpinningCombination): string {
  const speed = spinningSpeed === null ? '-' : SPEED_ABBREVIATIONS[spinningSpeed];
  const size = spinningSize === null ? '-' : SIZE_ABBREVIATIONS[spinningSize];
  return `${speed}/${size}`;
}

export function formatSpinningCombinations(
  combinations: readonly FishCatchSpinningCombination[],
): string {
  return combinations.length === 0 ? '—' : combinations.map(formatSpinningCombination).join(', ');
}

export function formatPublicFishCatchWeight(weightGrams: number): string {
  return formatCompactWeight(weightGrams);
}

export function formatObservedAndMaximumWeight(
  maxObservedWeightGrams: number,
  maxWeightGrams: number | null,
): string {
  const maximum = maxWeightGrams === null ? '—' : formatPublicFishCatchWeight(maxWeightGrams);
  return `${formatPublicFishCatchWeight(maxObservedWeightGrams)} / ${maximum}`;
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
