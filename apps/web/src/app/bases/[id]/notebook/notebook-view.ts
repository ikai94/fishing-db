import type { BaseFishNotebook } from '@/lib/base-fish-notebook-api';
import { compareCatalogItemsByName } from '@/lib/catalog-search';

/** Девять режимов, включая исходный серверный порядок; значения весов всегда остаются граммами. */
export const NOTEBOOK_SORT_OPTIONS = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'name-asc', label: 'Рыба А–Я' },
  { value: 'name-desc', label: 'Рыба Я–А' },
  { value: 'catches-desc', label: 'Уловов: больше → меньше' },
  { value: 'catches-asc', label: 'Уловов: меньше → больше' },
  { value: 'min-asc', label: 'Мин. вес: меньше → больше' },
  { value: 'min-desc', label: 'Мин. вес: больше → меньше' },
  { value: 'max-asc', label: 'Макс. вес: меньше → больше' },
  { value: 'max-desc', label: 'Макс. вес: больше → меньше' },
] as const;

/** Ограничивает режимы сортировки значениями компактного select. */
export type NotebookSort = (typeof NOTEBOOK_SORT_OPTIONS)[number]['value'];

/** Null всегда идёт последним, независимо от направления числовой сортировки. */
function compareNumbers(left: number | null, right: number | null, descending: boolean) {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

/** Сортирует копию; исходная позиция служит стабильным tie-breaker для равных чисел. */
export function sortNotebookRows(rows: BaseFishNotebook['rows'], sort: NotebookSort) {
  if (sort === 'default') return [...rows];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let comparison: number;
      if (sort === 'name-asc' || sort === 'name-desc') {
        comparison = compareCatalogItemsByName(left.row.fish, right.row.fish);
        if (sort === 'name-desc') comparison *= -1;
      } else {
        const value = (row: BaseFishNotebook['rows'][number]) =>
          sort.startsWith('catches')
            ? row.totalCatchReports
            : sort.startsWith('min')
              ? row.minWeightGrams
              : row.maxWeightGrams;
        comparison = compareNumbers(value(left.row), value(right.row), sort.endsWith('desc'));
      }
      return comparison || left.index - right.index;
    })
    .map(({ row }) => row);
}
