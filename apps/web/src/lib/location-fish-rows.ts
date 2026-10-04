import type { ObservedFish } from './catch-reports-api';

/** Наблюдения относятся ко всем уловам рыбы, а не только к трём ведущим наживкам. */
export type LocationFishRow = ObservedFish;

/** Состояние компактных фильтров; локация прежде не сохраняла их в URL. */
export type LocationFishControls = {
  sort: 'fish' | 'bait' | 'catches';
  direction: 'asc' | 'desc';
  baitId: string;
  hasHole: boolean;
  hasSpinning: boolean;
  hasComment: boolean;
  minCount: 0 | 10 | 30;
};

const names = new Intl.Collator('ru-RU');

/** Применяет AND к наличию данных; числовой порядок глобален для всех строк локации. */
export function filterLocationFishRows(
  rows: readonly LocationFishRow[],
  controls: LocationFishControls,
): LocationFishRow[] {
  const direction = controls.direction === 'asc' ? 1 : -1;
  return rows
    .filter(
      (row) =>
        row.reportCount >= controls.minCount &&
        (!controls.hasHole || row.holes.length > 0) &&
        (!controls.hasSpinning || row.spinning.length > 0) &&
        (!controls.hasComment || row.comments.length > 0) &&
        (!controls.baitId || row.topBaits.some((bait) => bait.id === controls.baitId)),
    )
    .sort((left, right) => {
      const fishOrder =
        names.compare(left.fish.name, right.fish.name) || left.fish.id.localeCompare(right.fish.id);
      if (controls.sort === 'fish') return direction * fishOrder;
      if (controls.sort === 'catches')
        return direction * (left.reportCount - right.reportCount) || fishOrder;
      // Главная наживка — первая в серверном топ-3; равные названия ранжируются по её популярности.
      return (
        direction * names.compare(left.topBaits[0].name, right.topBaits[0].name) ||
        right.topBaits[0].reportCount - left.topBaits[0].reportCount ||
        fishOrder
      );
    });
}
