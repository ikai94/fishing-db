export type PersonalCatchArchiveFilters = {
  source?: 'native';
  fishId?: string;
  baseId?: string;
  locationId?: string;
  baitId?: string;
};

const FILTER_KEYS = ['fishId', 'baseId', 'locationId', 'baitId'] as const;

export function readPersonalCatchArchiveFilters(
  searchParams: Pick<URLSearchParams, 'get'>,
): PersonalCatchArchiveFilters {
  const result: PersonalCatchArchiveFilters = {};
  if (searchParams.get('source') === 'native') result.source = 'native';
  for (const key of FILTER_KEYS) {
    const value = searchParams.get(key)?.trim();
    if (value) result[key] = value;
  }
  return result;
}

export function personalCatchArchiveHref(
  filter: PersonalCatchArchiveFilters,
  view?: 'statistics',
): string {
  const query = new URLSearchParams();
  if (view) query.set('view', view);
  if (filter.source) query.set('source', filter.source);
  for (const key of FILTER_KEYS) {
    if (filter[key]) query.set(key, filter[key]);
  }
  const search = query.toString();
  return `/my/catches${search ? `?${search}` : ''}`;
}
