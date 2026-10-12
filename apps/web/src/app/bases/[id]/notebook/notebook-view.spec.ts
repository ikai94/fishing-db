import { expect, test } from 'vitest';
import type { BaseFishNotebook } from '@/lib/base-fish-notebook-api';
import { sortNotebookRows, type NotebookSort } from './notebook-view';

const rows: BaseFishNotebook['rows'] = [
  ['a', 'Щука', 100, 200, 2],
  ['b', 'Ёрш', 50, 100, 10],
  ['c', 'Амур', 100, 300, 2],
  ['d', 'Белуга', null, null, 0],
  ['e', 'Лещ', 1000, 2000, 2],
].map(([id, name, min, max, catches]) => ({
  fish: {
    id: id as string,
    name: name as string,
    image: null,
    isRarest: false,
    isNightBiting: false,
  },
  minWeightGrams: min as number | null,
  maxWeightGrams: max as number | null,
  totalCatchReports: catches as number,
  topLocations: [],
  noteText: null,
  isHidden: false,
}));

test.each<[NotebookSort, string[]]>([
  ['default', ['a', 'b', 'c', 'd', 'e']],
  ['name-asc', ['c', 'd', 'b', 'e', 'a']],
  ['name-desc', ['a', 'e', 'b', 'd', 'c']],
  ['catches-desc', ['b', 'a', 'c', 'e', 'd']],
  ['catches-asc', ['d', 'a', 'c', 'e', 'b']],
  ['min-asc', ['b', 'a', 'c', 'e', 'd']],
  ['min-desc', ['e', 'a', 'c', 'b', 'd']],
  ['max-asc', ['b', 'a', 'c', 'e', 'd']],
  ['max-desc', ['e', 'c', 'a', 'b', 'd']],
])('%s uses numeric grams, Russian names, nulls last and stable ties', (mode, expected) => {
  expect(sortNotebookRows(rows, mode).map((row) => row.fish.id)).toEqual(expected);
  expect(rows.map((row) => row.fish.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect(sortNotebookRows(rows, mode).map((row) => row.fish.id)).toEqual(expected);
});
