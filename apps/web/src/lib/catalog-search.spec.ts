import { describe, expect, test } from 'vitest';
import { catalogSearchTokens, filterCatalogItems } from './catalog-search';

const items = [
  { id: '1', name: 'Амурская Щука' },
  { id: '2', name: 'Черный амур' },
  { id: '3', name: 'Амурский Осетр' },
];

describe('filterCatalogItems', () => {
  test('matches case-insensitively by tokens without changing server order', () => {
    expect(filterCatalogItems(items, 'АМУР щ')).toEqual([items[0]]);
    expect(filterCatalogItems(items, 'амур')).toEqual(items);
  });

  test('uses NFKC and punctuation as token boundaries', () => {
    expect(catalogSearchTokens('Ａмур—Щ')).toEqual(['aмур', 'щ']);
  });

  test('does not fuzzy-correct misspellings', () => {
    expect(filterCatalogItems(items, 'омурская')).toEqual([]);
  });
});
