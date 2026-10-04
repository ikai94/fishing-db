'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import styles from '../../../public-catalog.module.css';
import controls from '../../../fish/[id]/_components/fish-controls.module.css';
import local from './location-fish-table.module.css';
import { FishImage } from '../../../fish/_components/fish-image';
import { MultipleValues, formatHoleValue } from '../../../fish/[id]/_components/multiple-values';
import {
  PresenceHeader,
  formatSpinningCombination,
  formatObservedAndMaximumWeight,
} from '../../../fish/[id]/_components/public-fish-catch-table';
import { BaitImage } from '@/components/bait-image';
import { anomalyWeightLabel } from '@/lib/base-fish-weight';
import {
  filterLocationFishRows,
  type LocationFishControls,
  type LocationFishRow,
} from '@/lib/location-fish-rows';

/** Использует те же заголовки, раскрытия и пороги клёва, что таблица страницы Fish. */
export function LocationFishTable({ baseId, rows }: { baseId: string; rows: LocationFishRow[] }) {
  const [state, setState] = useState<LocationFishControls>({
    sort: 'catches',
    direction: 'desc',
    baitId: '',
    hasHole: false,
    hasSpinning: false,
    hasComment: false,
    minCount: 0,
  });
  const visible = useMemo(() => filterLocationFishRows(rows, state), [rows, state]);
  const baits = useMemo(
    () =>
      [
        ...new Map(rows.flatMap((row) => row.topBaits).map((bait) => [bait.id, bait])).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, 'ru-RU') || a.id.localeCompare(b.id)),
    [rows],
  );

  /** Новая колонка получает естественное направление; повторное нажатие меняет его. */
  function sortBy(sort: LocationFishControls['sort']) {
    setState((current) => ({
      ...current,
      sort,
      direction:
        current.sort === sort
          ? current.direction === 'asc'
            ? 'desc'
            : 'asc'
          : sort === 'catches'
            ? 'desc'
            : 'asc',
    }));
  }

  /** Индикатор и aria-sort отражают только выбранную колонку. */
  function sortHeader(sort: LocationFishControls['sort'], label: string, title?: string) {
    const active = state.sort === sort;
    return (
      <th
        scope="col"
        aria-sort={active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          className={`${controls.headerButton} ${sort === 'catches' ? controls.numericHeader : ''}`}
          type="button"
          aria-label={label}
          aria-pressed={active}
          title={title}
          onClick={() => sortBy(sort)}
        >
          {label}{' '}
          <span aria-hidden="true">{active ? (state.direction === 'asc' ? '↑' : '↓') : '↕'}</span>
        </button>
        {sort === 'bait' ? (
          <select
            className={local.baitFilter}
            aria-label="Фильтр наживки среди топ-3"
            value={state.baitId}
            onChange={(event) =>
              setState((current) => ({ ...current, baitId: event.target.value }))
            }
          >
            <option value="">Все наживки</option>
            {baits.map((bait) => (
              <option key={bait.id} value={bait.id}>
                {bait.name}
              </option>
            ))}
          </select>
        ) : null}
      </th>
    );
  }

  return (
    <>
      <div className={styles.catchTableToolbar} role="group" aria-label="Фильтр уловистости">
        {(
          [
            { label: 'Все', count: 0 },
            { label: 'Хороший клев', count: 10 },
            { label: 'Отличный клев', count: 30 },
          ] as const
        ).map((filter) => (
          <button
            key={filter.label}
            type="button"
            className={`${styles.intensityFilterButton} ${state.minCount === filter.count ? styles.intensityFilterButtonActive : ''}`}
            aria-pressed={state.minCount === filter.count}
            onClick={() => setState((current) => ({ ...current, minCount: filter.count }))}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div
        className={styles.catchTableRegion}
        role="region"
        aria-label="Рейтинг пойманных рыб"
        tabIndex={0}
      >
        <table className={`${styles.catchTable} ${styles.aggregateCatchTable} ${local.table}`}>
          <caption className={styles.visuallyHidden}>Пойманные на локации рыбы</caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              {sortHeader('fish', 'Рыба')}
              <PresenceHeader
                label="Яма / ориентир"
                active={state.hasHole}
                onToggle={() => setState((current) => ({ ...current, hasHole: !current.hasHole }))}
              />
              {sortHeader(
                'bait',
                'На что',
                'По названию самой частой наживки; фильтр ищет среди топ-3',
              )}
              <PresenceHeader
                label="Размер / проводка"
                description="Есть размер или проводка"
                active={state.hasSpinning}
                onToggle={() =>
                  setState((current) => ({ ...current, hasSpinning: !current.hasSpinning }))
                }
              />
              <PresenceHeader
                label="Комментарий"
                active={state.hasComment}
                onToggle={() =>
                  setState((current) => ({ ...current, hasComment: !current.hasComment }))
                }
              />
              {sortHeader('catches', 'Уловы')}
              <th scope="col">Наблюдаемый / максимальный вес</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr className={styles.catchRow} key={row.fish.id}>
                <th scope="row" className={styles.reportNumber}>
                  {index + 1}
                </th>
                <td>
                  <div className={local.fish}>
                    <FishImage
                      fishName={row.fish.name}
                      image={row.fish.image}
                      variant="thumbnail"
                    />
                    <span>
                      {row.fish.isActive ? (
                        <Link
                          className={styles.entityLink}
                          href={`/fish/${row.fish.id}?baseIds=${baseId}`}
                        >
                          {row.fish.name}
                        </Link>
                      ) : (
                        row.fish.name
                      )}
                    </span>
                  </div>
                </td>
                <td className={styles.aggregateSingleLineCell}>
                  <MultipleValues label="Ямы и ориентиры" values={row.holes.map(formatHoleValue)} />
                </td>
                <td>
                  <ul className={local.baits} aria-label={`Топ наживок: ${row.fish.name}`}>
                    {row.topBaits.map((bait) => (
                      <li key={bait.id}>
                        <span className={local.baitName}>
                          <BaitImage baitName={bait.name} image={bait.image} variant="compact" />
                          <span>{bait.name}</span>
                        </span>
                        <span className={local.baitCount} title={`${bait.reportCount} уловов`}>
                          {bait.reportCount}
                        </span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={styles.spinningCombinationsCell}>
                  <MultipleValues
                    label="Размер и проводка"
                    values={row.spinning.map(formatSpinningCombination)}
                  />
                </td>
                <td className={styles.aggregateSingleLineCell}>
                  <MultipleValues label="Комментарии" values={row.comments} />
                </td>
                <td className={styles.aggregateCountCell} title={`${row.reportCount} уловов`}>
                  <span
                    className={`${styles.catchCountValue} ${row.reportCount >= 50 ? styles.catchCountValueHigh : ''}`}
                  >
                    {row.reportCount}
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
      {visible.length === 0 ? (
        <p className={styles.statusMessage} role="status">
          Для выбранных фильтров рыб нет.
        </p>
      ) : null}
    </>
  );
}
