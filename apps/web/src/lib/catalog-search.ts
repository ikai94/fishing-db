export type SearchableCatalogItem = {
  id: string;
  name: string;
};

const TOKEN_SEPARATOR = /[\p{White_Space}\p{Punctuation}]+/u;

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
