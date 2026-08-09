export const CATALOG_BAIT_TYPES = ['BAIT', 'LURE'] as const;
export type CatalogBaitType = (typeof CATALOG_BAIT_TYPES)[number];

export const CATALOG_STATUSES = ['all', 'active', 'inactive'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];
