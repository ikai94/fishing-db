import { normalizeCatalogLookupText } from './catalog-lookup.js';

export type CatalogSearchKind = 'FISHING_BASE' | 'LOCATION' | 'FISH' | 'BAIT';

type CatalogSearchNamedCandidate = {
  kind: CatalogSearchKind;
  id: string;
  name: string;
};

export type CatalogSearchCandidate =
  | (CatalogSearchNamedCandidate & { kind: 'FISHING_BASE' | 'FISH' })
  | (CatalogSearchNamedCandidate & {
      kind: 'LOCATION';
      number: number;
      fishingBase: { id: string; name: string };
    })
  | (CatalogSearchNamedCandidate & { kind: 'BAIT'; baitType: 'BAIT' | 'LURE' });

const TOKEN_SEPARATOR = /[\p{White_Space}\p{Punctuation}]+/u;
const KIND_ORDER: Readonly<Record<CatalogSearchKind, number>> = {
  FISHING_BASE: 0,
  LOCATION: 1,
  FISH: 2,
  BAIT: 3,
};

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function catalogLookupTokens(value: string): string[] {
  return normalizeCatalogLookupText(value).split(TOKEN_SEPARATOR).filter(Boolean);
}

function candidateRank(candidate: CatalogSearchCandidate, query: string, queryTokens: string[]) {
  const normalizedName = normalizeCatalogLookupText(candidate.name);
  const candidateTokens = catalogLookupTokens(candidate.name);

  if (
    queryTokens.length === 0 ||
    !queryTokens.every((queryToken) =>
      candidateTokens.some((candidateToken) => candidateToken.includes(queryToken)),
    )
  ) {
    return null;
  }

  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  if (
    queryTokens.every((queryToken) =>
      candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)),
    )
  ) {
    return 2;
  }
  return 3;
}

/** Filters with AND-token semantics and returns one deterministic relevance order. */
export function rankCatalogSearchCandidates(
  candidates: readonly CatalogSearchCandidate[],
  queryText: string,
): CatalogSearchCandidate[] {
  const query = normalizeCatalogLookupText(queryText);
  const queryTokens = catalogLookupTokens(queryText);

  return candidates
    .map((candidate) => ({ candidate, rank: candidateRank(candidate, query, queryTokens) }))
    .filter(
      (entry): entry is { candidate: CatalogSearchCandidate; rank: number } => entry.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        KIND_ORDER[left.candidate.kind] - KIND_ORDER[right.candidate.kind] ||
        compareStrings(
          normalizeCatalogLookupText(left.candidate.name),
          normalizeCatalogLookupText(right.candidate.name),
        ) ||
        compareStrings(left.candidate.name, right.candidate.name) ||
        compareStrings(left.candidate.id, right.candidate.id),
    )
    .map(({ candidate }) => candidate);
}
