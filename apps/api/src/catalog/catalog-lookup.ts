export interface CatalogLookupItem {
  id: string;
  name: string;
}

export type CatalogLookupResolution<T> =
  | { status: 'NOT_FOUND' }
  | { status: 'UNIQUE'; item: T }
  | { status: 'AMBIGUOUS'; items: readonly T[] };

export type CatalogLookupIndex<T> = ReadonlyMap<string, readonly T[]>;

const REPEATED_UNICODE_WHITESPACE = /\p{White_Space}+/gu;

/** Normalizes user lookup text without changing canonical catalog identity. */
export function normalizeCatalogLookupText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/gu, 'е')
    .replace(/й/gu, 'и')
    .replace(REPEATED_UNICODE_WHITESPACE, ' ')
    .trim();
}

export function buildCatalogLookupIndex<T extends CatalogLookupItem>(
  items: readonly T[],
): CatalogLookupIndex<T> {
  const index = new Map<string, T[]>();

  for (const item of items) {
    const lookupKey = normalizeCatalogLookupText(item.name);
    const candidates = index.get(lookupKey) ?? [];
    candidates.push(item);
    index.set(lookupKey, candidates);
  }

  return index;
}

export function resolveCatalogLookup<T>(
  index: CatalogLookupIndex<T>,
  lookupText: string,
): CatalogLookupResolution<T> {
  const candidates = index.get(normalizeCatalogLookupText(lookupText)) ?? [];

  if (candidates.length === 0) return { status: 'NOT_FOUND' };
  if (candidates.length === 1) {
    const item = candidates[0];
    if (item === undefined) return { status: 'NOT_FOUND' };
    return { status: 'UNIQUE', item };
  }

  return { status: 'AMBIGUOUS', items: candidates };
}
