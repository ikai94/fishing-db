import { compareCatalogItemsByName } from './catalog-search';
import type { RecordsItem } from './records-api';

export type RecordsSortKey = 'default' | 'headroom' | 'weight' | 'name' | 'maxBase' | 'fishingBase';
export type RecordsSortDirection = 'asc' | 'desc';
export type RecordsSort = { key: RecordsSortKey; direction: RecordsSortDirection };
export const DEFAULT_RECORDS_SORT: RecordsSort = { key: 'default', direction: 'desc' };

export function readRecordsSort(search: Pick<URLSearchParams, 'get'>): RecordsSort {
  const key = search.get('sort');
  const direction = search.get('direction');
  if (
    !['headroom', 'weight', 'name', 'maxBase', 'fishingBase'].includes(key ?? '') ||
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

function nullableBaseNameOrder(
  left: { name: string } | null,
  right: { name: string } | null,
  direction: RecordsSortDirection,
): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  const result = left.name.localeCompare(right.name, 'ru-RU');
  return direction === 'asc' ? result : -result;
}

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
        nullableBaseNameOrder(
          left.maxBases[0] ?? null,
          right.maxBases[0] ?? null,
          sort.direction,
        ) || nameOrder(left, right)
      );
    }
    if (sort.key === 'fishingBase') {
      return (
        nullableBaseNameOrder(
          left.record?.fishingBase ?? null,
          right.record?.fishingBase ?? null,
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
