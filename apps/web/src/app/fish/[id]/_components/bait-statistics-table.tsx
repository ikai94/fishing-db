'use client';

import { useState } from 'react';
import styles from '../../../public-catalog.module.css';
import type { BaitStatistic } from '@/lib/bait-statistics-api';

type BaitStatisticsTableProps = {
  items: readonly BaitStatistic[];
};

const COMPACT_ITEM_COUNT = 5;

export function BaitStatisticsTable({ items }: BaitStatisticsTableProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, COMPACT_ITEM_COUNT);
  const hasHiddenItems = items.length > COMPACT_ITEM_COUNT;

  return (
    <>
      <div
        className={styles.baitTableRegion}
        role="region"
        aria-label="Таблица статистики наживок и приманок"
        tabIndex={0}
      >
        <table className={styles.baitStatisticsTable}>
          <caption className={styles.visuallyHidden}>
            На что ловится выбранная рыба на выбранной базе
          </caption>
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Наживка / приманка</th>
              <th scope="col">Уловов</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, index) => (
              <tr className={styles.baitStatisticsRow} key={item.bait.id}>
                <th className={styles.reportNumber} scope="row">
                  {index + 1}
                </th>
                <td>
                  <span>{item.bait.name}</span>
                  {!item.bait.isActive ? (
                    <span className={styles.secondaryText}>Сейчас неактивна</span>
                  ) : null}
                </td>
                <td
                  className={styles.baitStatisticsCountCell}
                  title={`${item.reportsCount} отчётов об уловах`}
                >
                  {item.reportsCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasHiddenItems ? (
        <button
          className={styles.loadMore}
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Свернуть' : 'Показать все'}
        </button>
      ) : null}
    </>
  );
}
