import { compareCatalogItemsByName } from './catalog-search';
import type { RecordsItem } from './records-api';

/** Ключи сортировки таблицы рекордов, сохраняемые в URL. */
export type RecordsSortKey =
  'default' | 'headroom' | 'weight' | 'name' | 'maxBase' | 'fishingBase' | 'playerName' | 'bait';
export type RecordsSortDirection = 'asc' | 'desc';
export type RecordsSort = { key: RecordsSortKey; direction: RecordsSortDirection };
export const DEFAULT_RECORDS_SORT: RecordsSort = { key: 'default', direction: 'desc' };

export function readRecordsSort(search: Pick<URLSearchParams, 'get'>): RecordsSort {
  const key = search.get('sort');
  const direction = search.get('direction');
  if (
    !['headroom', 'weight', 'name', 'maxBase', 'fishingBase', 'playerName', 'bait'].includes(
      key ?? '',
    ) ||
    !['asc', 'desc'].includes(direction ?? '')
  ) {
    return DEFAULT_RECORDS_SORT;
  }
  return { key: key as RecordsSortKey, direction: direction as RecordsSortDirection };
}

export function recordsSortSearch(sort: RecordsSort): string {
  if (sort.key === 'default') return '';
  return new URLSearchParams({ sort: sort.key, direction: sort.direction }).toString();
}

function nameOrder(left: RecordsItem, right: RecordsItem): number {
  return compareCatalogItemsByName(left.fish, right.fish);
}

function defaultRank(row: RecordsItem): number {
  if (row.state === 'NO_RECORD') return 0;
  if (row.state === 'RECORD' && row.headroomPercent !== null && row.headroomPercent > 0) return 1;
  if (row.state === 'RECORD' && row.headroomPercent === 0) return 2;
  if (row.state === 'RECORD' && row.headroomPercent !== null && row.headroomPercent < 0) return 3;
  if (row.state === 'RECORD') return 4;
  return 5;
}

function nullableOrder(
  left: number | null,
  right: number | null,
  direction: RecordsSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return direction === 'asc' ? left - right : right - left;
}

/** Сравнивает отображаемый текст; отсутствующие значения остаются последними в обоих направлениях. */
function nullableTextOrder(
  left: string | null,
  right: string | null,
  direction: RecordsSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const result = left.localeCompare(right, 'ru-RU');
  return direction === 'asc' ? result : -result;
}

/** Сортирует копию строк; при равных значениях сохраняет устойчивый порядок по имени рыбы. */
export function sortRecords(items: readonly RecordsItem[], sort: RecordsSort): RecordsItem[] {
  return [...items].sort((left, right) => {
    if (sort.key === 'default') {
      const rank = defaultRank(left) - defaultRank(right);
      if (rank !== 0) return rank;
      if (defaultRank(left) === 1 || defaultRank(left) === 3) {
        const headroom = nullableOrder(left.headroomPercent, right.headroomPercent, 'desc');
        if (headroom !== 0) return headroom;
      }
      return nameOrder(left, right);
    }
    if (sort.key === 'name') {
      const result = nameOrder(left, right);
      return sort.direction === 'asc' ? result : -result;
    }
    if (sort.key === 'maxBase') {
      return (
        nullableTextOrder(
          left.maxBases[0]?.name ?? null,
          right.maxBases[0]?.name ?? null,
          sort.direction,
        ) || nameOrder(left, right)
      );
    }
    if (sort.key === 'fishingBase') {
      return (
        nullableTextOrder(
          left.record?.fishingBase?.name ?? null,
          right.record?.fishingBase?.name ?? null,
          sort.direction,
        ) || nameOrder(left, right)
      );
    }
    if (sort.key === 'playerName' || sort.key === 'bait') {
      // Дата показана рядом с игроком, но порядок определяется его именем, затем именем рыбы.
      return (
        nullableTextOrder(
          left.record?.[sort.key] ?? null,
          right.record?.[sort.key] ?? null,
          sort.direction,
        ) || nameOrder(left, right)
      );
    }
    const result = nullableOrder(
      sort.key === 'headroom' ? left.headroomPercent : (left.record?.weightGrams ?? null),
      sort.key === 'headroom' ? right.headroomPercent : (right.record?.weightGrams ?? null),
      sort.direction,
    );
    return result || nameOrder(left, right);
  });
}
