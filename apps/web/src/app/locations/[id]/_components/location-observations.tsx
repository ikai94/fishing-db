'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import styles from '../../../public-catalog.module.css';
import type {
  CatchReport,
  LocationObservations as LocationObservationsData,
} from '@/lib/catch-reports-api';
import {
  fishingMethodLabel,
  fishingNoteLabel,
  formatCentimetersAsMeters,
  spinningSizeLabel,
  spinningSpeedLabel,
} from '@/lib/catch-report-form';

type LocationObservationsProps = {
  baseId: string;
  data: LocationObservationsData;
};

export function LocationObservations({ baseId, data }: LocationObservationsProps) {
  const [selectedFishIds, setSelectedFishIds] = useState(
    () => new Set(data.observedFish.map((item) => item.fish.id)),
  );
  const rankedFish = useMemo(
    () => data.observedFish.map((item, index) => ({ ...item, rank: index + 1 })),
    [data.observedFish],
  );
  const visibleFish = useMemo(
    () => rankedFish.filter((item) => selectedFishIds.has(item.fish.id)),
    [rankedFish, selectedFishIds],
  );
  const visibleReports = useMemo(
    () => data.reports.filter((report) => selectedFishIds.has(report.fish.id)),
    [data.reports, selectedFishIds],
  );
  const activeFishIds = useMemo(
    () =>
      new Set(data.observedFish.filter((item) => item.fish.isActive).map((item) => item.fish.id)),
    [data.observedFish],
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
      <section className={styles.resultsRegion} aria-labelledby="location-observed-fish-heading">
        <h2 className={styles.sectionTitle} id="location-observed-fish-heading">
          Пойманные рыбы
        </h2>
        <p className={styles.statusMessage}>На этой локации пока нет опубликованных уловов.</p>
      </section>
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
          <ObservedFishTable baseId={baseId} items={visibleFish} />
        )}
      </section>

      <section className={styles.resultsRegion} aria-labelledby="location-catches-heading">
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle} id="location-catches-heading">
            Уловы на локации
          </h2>
        </div>

        {visibleReports.length === 0 ? (
          <p className={styles.statusMessage}>Выберите хотя бы одну рыбу, чтобы увидеть уловы.</p>
        ) : (
          <LocationCatchTable
            activeFishIds={activeFishIds}
            baseId={baseId}
            reports={visibleReports}
          />
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

type RankedObservedFish = LocationObservationsData['observedFish'][number] & { rank: number };

function ObservedFishTable({ baseId, items }: { baseId: string; items: RankedObservedFish[] }) {
  return (
    <div
      className={styles.tableRegion}
      role="region"
      aria-label="Рейтинг пойманных рыб"
      tabIndex={0}
    >
      <table className={`${styles.catalogTable} ${styles.observedFishTable}`}>
        <caption className={styles.visuallyHidden}>Пойманные на локации рыбы</caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Рыба</th>
            <th scope="col">Наблюдения</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.fish.id}>
              <td className={styles.reportNumber}>{item.rank}</td>
              <td>
                {item.fish.isActive ? (
                  <FishLink baseId={baseId} fishId={item.fish.id} name={item.fish.name} />
                ) : (
                  <>
                    <span>{item.fish.name}</span>
                    <span className={styles.secondaryText}>Историческая запись</span>
                  </>
                )}
              </td>
              <td className={styles.observedFishCounts}>
                {item.contributorCount.toLocaleString('ru-RU')} рыбаков ·{' '}
                {item.reportCount.toLocaleString('ru-RU')} уловов
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LocationCatchTable({
  activeFishIds,
  baseId,
  reports,
}: {
  activeFishIds: ReadonlySet<string>;
  baseId: string;
  reports: CatchReport[];
}) {
  return (
    <div
      className={styles.catchTableRegion}
      role="region"
      aria-label="Таблица уловов на локации"
      tabIndex={0}
    >
      <table className={`${styles.catchTable} ${styles.locationCatchTable}`}>
        <caption className={styles.visuallyHidden}>Уловы выбранных рыб на этой локации</caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Рыба</th>
            <th scope="col">Вес</th>
            <th scope="col">Наживка / приманка</th>
            <th scope="col">Способ / настройки</th>
            <th scope="col">Яма / точка</th>
            <th scope="col">Автор</th>
            <th scope="col">Дата</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report, index) => (
            <ReportRows
              activeFish={activeFishIds.has(report.fish.id)}
              baseId={baseId}
              report={report}
              reportNumber={index + 1}
              key={report.id}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportRows({
  activeFish,
  baseId,
  report,
  reportNumber,
}: {
  activeFish: boolean;
  baseId: string;
  report: CatchReport;
  reportNumber: number;
}) {
  return (
    <>
      <tr className={styles.catchRow}>
        <th className={styles.reportNumber} scope="row">
          <Link
            className={styles.entityLink}
            href={`/catches/${report.id}`}
            aria-label={`Улов №${reportNumber}: подробнее`}
          >
            {reportNumber}
          </Link>
        </th>
        <td>
          {activeFish ? (
            <FishLink baseId={baseId} fishId={report.fish.id} name={report.fish.name} />
          ) : (
            report.fish.name
          )}
        </td>
        <td className={styles.weightCell}>{formatWeight(report.weightGrams)}</td>
        <td>{report.bait.name}</td>
        <td className={styles.conditionCell}>{formatMethodAndSettings(report)}</td>
        <td className={styles.positionCell}>{formatHoleAndSpot(report)}</td>
        <td className={styles.authorCell}>{report.author.nickname}</td>
        <td className={styles.dateCell}>
          <time dateTime={report.createdAt}>{formatDate(report.createdAt)}</time>
        </td>
      </tr>
      {report.userNoteRaw !== null && report.userNoteRaw.trim() !== '' ? (
        <tr className={styles.catchCommentRow}>
          <td className={styles.catchComment} colSpan={8}>
            <span className={styles.visuallyHidden}>Отчёт № {reportNumber}. </span>
            <span className={styles.secondaryText}>Комментарий:</span> {report.userNoteRaw}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FishLink({ baseId, fishId, name }: { baseId: string; fishId: string; name: string }) {
  return (
    <Link className={styles.entityLink} href={`/fish/${fishId}?baseIds=${baseId}`}>
      {name}
    </Link>
  );
}

function formatMethodAndSettings(report: CatchReport): string {
  const parts = [fishingMethodLabel(report.fishingMethod)];

  if (report.fishingMethod === 'SPINNING') {
    const size = spinningSizeLabel(report.spinningSize);
    const speed = spinningSpeedLabel(report.spinningSpeed);
    if (size !== null) parts.push(size);
    if (speed !== null) parts.push(speed);
  }

  const note = fishingNoteLabel(report.fishingNote);
  if (note !== null) parts.push(note);
  return parts.join(' · ');
}

function formatHoleAndSpot(report: CatchReport): string {
  const parts = [
    report.holeDepthCm === null ? null : `Яма ${formatCentimetersAsMeters(report.holeDepthCm)} м`,
    report.spotPositionRaw,
  ].filter((part): part is string => part !== null && part.trim() !== '');

  return parts.length > 0 ? parts.join(' · ') : '—';
}

function formatWeight(weightGrams: number): string {
  return `${weightGrams.toLocaleString('ru-RU')} г`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}
