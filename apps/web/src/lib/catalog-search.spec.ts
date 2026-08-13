import { describe, expect, test } from 'vitest';
import {
  catalogSearchTokens,
  FISH_ALPHABET_GROUPS,
  filterCatalogItems,
  filterFishByAlphabetGroup,
  getFishAlphabetGroup,
  sortCatalogItemsByName,
} from './catalog-search';

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

describe('catalog display ordering', () => {
  test('returns a Russian display-name ordered copy with deterministic id ties', () => {
    const unordered = [
      { id: '3', name: 'Сом' },
      { id: '2', name: 'Амурский Осетр' },
      { id: '1', name: 'Амурская Щука' },
      { id: '5', name: 'Белуга' },
      { id: '4', name: 'Белуга' },
    ];

    expect(sortCatalogItemsByName(unordered).map((item) => item.id)).toEqual([
      '1',
      '2',
      '4',
      '5',
      '3',
    ]);
    expect(unordered.map((item) => item.id)).toEqual(['3', '2', '1', '5', '4']);
  });

  test('defines every Fish alphabet control explicitly in display order', () => {
    expect(FISH_ALPHABET_GROUPS.map(({ label }) => label)).toEqual([
      'Все',
      'А–Б',
      'В–Г',
      'Д–Е',
      'Ж–З',
      'И–К',
      'Л–М',
      'Н–О',
      'П',
      'Р',
      'С',
      'Т–У',
      'Ф–Ч',
      'Ш–Я',
      'Прочие',
    ]);
  });
});

describe('Fish alphabet groups', () => {
  test.each([
    ['АБ', 'a-b'],
    ['ВГ', 'v-g'],
    ['ДЕЁ', 'd-e'],
    ['ЖЗ', 'zh-z'],
    ['ИЙК', 'i-k'],
    ['ЛМ', 'l-m'],
    ['НО', 'n-o'],
    ['П', 'p'],
    ['Р', 'r'],
    ['С', 's'],
    ['ТУ', 't-u'],
    ['ФХЦЧ', 'f-ch'],
    ['ШЩЪЫЬЭЮЯ', 'sh-ya'],
  ] as const)('maps every letter in %s to %s', (letters, groupId) => {
    for (const letter of letters) {
      expect(getFishAlphabetGroup(`${letter}рыба`)).toBe(groupId);
      expect(getFishAlphabetGroup(`${letter.toLocaleLowerCase('ru-RU')}рыба`)).toBe(groupId);
    }
  });

  test('normalizes decomposed letters and ignores leading whitespace and punctuation', () => {
    expect(getFishAlphabetGroup('  «е\u0308рш»')).toBe('d-e');
    expect(getFishAlphabetGroup('\t—и\u0306дол')).toBe('i-k');
    expect(getFishAlphabetGroup('  «щука»')).toBe('sh-ya');
  });

  test.each(['Salmon', '123 Рыба', '🐟 Сом', '', ' — «» '])(
    'maps %j to the Other group',
    (name) => {
      expect(getFishAlphabetGroup(name)).toBe('other');
    },
  );

  test('filters without mutating or reordering the supplied catalog', () => {
    const ordered = [
      { id: '1', name: 'Амур' },
      { id: '2', name: 'Белуга' },
      { id: '3', name: 'Сом' },
      { id: '4', name: 'Salmon' },
    ];

    expect(filterFishByAlphabetGroup(ordered, 'a-b')).toEqual([ordered[0], ordered[1]]);
    expect(filterFishByAlphabetGroup(ordered, 'other')).toEqual([ordered[3]]);
    const all = filterFishByAlphabetGroup(ordered, 'all');
    expect(all).toEqual(ordered);
    expect(all).not.toBe(ordered);
    expect(ordered.map(({ id }) => id)).toEqual(['1', '2', '3', '4']);
  });
});
