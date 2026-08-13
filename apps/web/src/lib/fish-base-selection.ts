type SearchParamsReader = Pick<URLSearchParams, 'get'>;

const SELECTION_KEYS = ['scope', 'baseIds', 'excludeBaseIds'] as const;

function splitIds(value: string | null): string[] {
  return value === null ? [] : value.split(',').filter((id) => id.length > 0);
}

function sortedUniqueKnownIds(ids: Iterable<string>, availableIds: ReadonlySet<string>): string[] {
  return [...new Set(ids)].filter((id) => availableIds.has(id)).sort();
}

export function readFishBaseSelection(
  availableBaseIds: readonly string[],
  searchParams: SearchParamsReader,
): string[] {
  const available = new Set(availableBaseIds);

  if (searchParams.get('scope') === 'none') {
    return [];
  }

  const selectedParam = searchParams.get('baseIds');
  if (selectedParam !== null) {
    return sortedUniqueKnownIds(splitIds(selectedParam), available);
  }

  const excludedParam = searchParams.get('excludeBaseIds');
  if (excludedParam !== null) {
    const excluded = new Set(sortedUniqueKnownIds(splitIds(excludedParam), available));
    return availableBaseIds.filter((id) => !excluded.has(id));
  }

  return [...availableBaseIds];
}

export function writeFishBaseSelection(
  currentSearch: string,
  availableBaseIds: readonly string[],
  selectedBaseIds: Iterable<string>,
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of SELECTION_KEYS) params.delete(key);

  const available = new Set(availableBaseIds);
  const selected = sortedUniqueKnownIds(selectedBaseIds, available);
  const selectedSet = new Set(selected);
  const excluded = [...available].filter((id) => !selectedSet.has(id)).sort();

  if (selected.length === 0) {
    params.set('scope', 'none');
  } else if (excluded.length === 0) {
    // The absence of selection parameters is the canonical all-selected state.
  } else if (selected.length <= excluded.length) {
    params.set('baseIds', selected.join(','));
  } else {
    params.set('excludeBaseIds', excluded.join(','));
  }

  return params.toString();
}
