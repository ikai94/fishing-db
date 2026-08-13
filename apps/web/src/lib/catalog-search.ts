export type SearchableCatalogItem = {
  id: string;
  name: string;
};

const TOKEN_SEPARATOR = /[\p{White_Space}\p{Punctuation}]+/u;
const NON_MEANINGFUL_INITIAL = /[\p{White_Space}\p{Punctuation}]/u;
const DISPLAY_NAME_COLLATOR = new Intl.Collator('ru-RU', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
});
const DISPLAY_NAME_TIEBREAKER = new Intl.Collator('ru-RU', {
  usage: 'sort',
  sensitivity: 'variant',
  numeric: true,
});

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export const FISH_ALPHABET_GROUPS = [
  { id: 'all', label: 'Все', kind: 'all' },
  { id: 'a-b', label: 'А–Б', kind: 'letters', letters: ['А', 'Б'] },
  { id: 'v-g', label: 'В–Г', kind: 'letters', letters: ['В', 'Г'] },
  { id: 'd-e', label: 'Д–Е', kind: 'letters', letters: ['Д', 'Е', 'Ё'] },
  { id: 'zh-z', label: 'Ж–З', kind: 'letters', letters: ['Ж', 'З'] },
  { id: 'i-k', label: 'И–К', kind: 'letters', letters: ['И', 'Й', 'К'] },
  { id: 'l-m', label: 'Л–М', kind: 'letters', letters: ['Л', 'М'] },
  { id: 'n-o', label: 'Н–О', kind: 'letters', letters: ['Н', 'О'] },
  { id: 'p', label: 'П', kind: 'letters', letters: ['П'] },
  { id: 'r', label: 'Р', kind: 'letters', letters: ['Р'] },
  { id: 's', label: 'С', kind: 'letters', letters: ['С'] },
  { id: 't-u', label: 'Т–У', kind: 'letters', letters: ['Т', 'У'] },
  { id: 'f-ch', label: 'Ф–Ч', kind: 'letters', letters: ['Ф', 'Х', 'Ц', 'Ч'] },
  {
    id: 'sh-ya',
    label: 'Ш–Я',
    kind: 'letters',
    letters: ['Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я'],
  },
  { id: 'other', label: 'Прочие', kind: 'other' },
] as const;

export type FishAlphabetGroupId = (typeof FISH_ALPHABET_GROUPS)[number]['id'];
export type SpecificFishAlphabetGroupId = Exclude<FishAlphabetGroupId, 'all'>;

export function catalogSearchTokens(value: string): string[] {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU').split(TOKEN_SEPARATOR).filter(Boolean);
}

/** Stable, conservative catalog filtering: every query token must occur in a name token. */
export function filterCatalogItems<T extends SearchableCatalogItem>(
  items: readonly T[],
  query: string,
): T[] {
  const queryTokens = catalogSearchTokens(query);
  if (queryTokens.length === 0) return [...items];

  return items.filter((item) => {
    const candidateTokens = catalogSearchTokens(item.name);
    return queryTokens.every((queryToken) =>
      candidateTokens.some((candidateToken) => candidateToken.includes(queryToken)),
    );
  });
}

export function compareCatalogItemsByName(
  left: SearchableCatalogItem,
  right: SearchableCatalogItem,
): number {
  return (
    DISPLAY_NAME_COLLATOR.compare(left.name, right.name) ||
    DISPLAY_NAME_TIEBREAKER.compare(left.name, right.name) ||
    compareStrings(left.name, right.name) ||
    compareStrings(left.id, right.id)
  );
}

/** Returns a Russian display-name ordered copy without mutating the API result. */
export function sortCatalogItemsByName<T extends SearchableCatalogItem>(items: readonly T[]): T[] {
  return [...items].sort(compareCatalogItemsByName);
}

/** Resolves one explicit Fish index group from the normalized first meaningful character. */
export function getFishAlphabetGroup(name: string): SpecificFishAlphabetGroupId {
  const initial = Array.from(name.normalize('NFKC')).find(
    (character) => !NON_MEANINGFUL_INITIAL.test(character),
  );
  const normalizedInitial = initial?.toLocaleUpperCase('ru-RU') ?? null;

  if (normalizedInitial !== null) {
    for (const group of FISH_ALPHABET_GROUPS) {
      if (
        group.kind === 'letters' &&
        (group.letters as readonly string[]).includes(normalizedInitial)
      ) {
        return group.id;
      }
    }
  }

  return 'other';
}

/** Filters a copy without changing the alphabetical order supplied by the caller. */
export function filterFishByAlphabetGroup<T extends SearchableCatalogItem>(
  items: readonly T[],
  groupId: FishAlphabetGroupId,
): T[] {
  if (groupId === 'all') return [...items];

  return items.filter((item) => getFishAlphabetGroup(item.name) === groupId);
}
