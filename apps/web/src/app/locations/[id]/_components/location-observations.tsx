'use client';

import { useId, useMemo, useState } from 'react';
import styles from '../../../bases-locations.module.css';
import { LocationFishTable } from './location-fish-table';
import type { LocationObservations as LocationObservationsData } from '@/lib/catch-reports-api';

type LocationObservationsProps = {
  baseId: string;
  data: LocationObservationsData;
};

/** Показывает сводку локации; выбор видов фильтрует только строки таблицы рыб. */
export function LocationObservations({ baseId, data }: LocationObservationsProps) {
  const [selectedFishIds, setSelectedFishIds] = useState(
    () => new Set(data.observedFish.map((item) => item.fish.id)),
  );
  const visibleFish = useMemo(
    () => data.observedFish.filter((item) => selectedFishIds.has(item.fish.id)),
    [data.observedFish, selectedFishIds],
  );
  function toggleFish(fishId: string) {
    setSelectedFishIds((current) => {
      const next = new Set(current);
      if (next.has(fishId)) next.delete(fishId);
      else next.add(fishId);
      return next;
    });
  }

  function selectAll() {
    setSelectedFishIds(new Set(data.observedFish.map((item) => item.fish.id)));
  }

  function clearAll() {
    setSelectedFishIds(new Set());
  }

  if (data.observedFish.length === 0) {
    return (
      <>
        <section className={styles.resultsRegion} aria-labelledby="location-observed-fish-heading">
          <h2 className={styles.sectionTitle} id="location-observed-fish-heading">
            Пойманные рыбы
          </h2>
          <p className={styles.statusMessage}>На этой локации пока нет опубликованных уловов.</p>
        </section>
      </>
    );
  }

  return (
    <>
      <section className={styles.resultsRegion} aria-labelledby="location-observed-fish-heading">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="location-observed-fish-heading">
            Пойманные рыбы
          </h2>
          <FishMultiSelect
            fish={data.observedFish}
            selectedFishIds={selectedFishIds}
            onToggle={toggleFish}
            onSelectAll={selectAll}
            onClearAll={clearAll}
          />
        </div>

        {visibleFish.length === 0 ? (
          <p className={styles.statusMessage}>Выберите хотя бы одну рыбу.</p>
        ) : (
          <LocationFishTable baseId={baseId} rows={visibleFish} />
        )}
      </section>
    </>
  );
}

function FishMultiSelect({
  fish,
  selectedFishIds,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  fish: LocationObservationsData['observedFish'];
  selectedFishIds: ReadonlySet<string>;
  onToggle: (fishId: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  const idPrefix = useId().replace(/:/g, '');

  return (
    <details className={styles.observedFishSelector}>
      <summary className={styles.observedFishSelectorSummary}>
        Рыбы: {selectedFishIds.size} из {fish.length}
      </summary>
      <div className={styles.observedFishSelectorMenu}>
        <div className={styles.observedFishSelectorToolbar}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onSelectAll}
            disabled={selectedFishIds.size === fish.length}
          >
            Выбрать все
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={onClearAll}
            disabled={selectedFishIds.size === 0}
          >
            Снять все
          </button>
        </div>
        <fieldset className={styles.observedFishSelectorFieldset}>
          <legend className={styles.visuallyHidden}>Фильтр пойманных рыб</legend>
          {fish.map((item, index) => {
            const checkboxId = `${idPrefix}-fish-${index}`;
            return (
              <label
                className={styles.observedFishSelectorOption}
                htmlFor={checkboxId}
                key={item.fish.id}
              >
                <input
                  className={styles.checkbox}
                  id={checkboxId}
                  type="checkbox"
                  checked={selectedFishIds.has(item.fish.id)}
                  onChange={() => onToggle(item.fish.id)}
                />
                <span>{item.fish.name}</span>
              </label>
            );
          })}
        </fieldset>
      </div>
    </details>
  );
}
