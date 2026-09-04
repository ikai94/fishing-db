export type ActivityNamedSnapshot = {
  id: string;
  name: string;
};

export type CatchReportActivitySnapshot = {
  reportId: string;
  fish: ActivityNamedSnapshot;
  fishingBase: ActivityNamedSnapshot;
  location: ActivityNamedSnapshot & { number: number };
  bait: ActivityNamedSnapshot;
  weightGrams: number;
};

export const CATCH_REPORT_ACTIVITY_FIELDS = [
  'locationId',
  'fishId',
  'baitId',
  'weightGrams',
  'fishingMethod',
  'holeDepthCm',
  'spotPositionRaw',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
  'userNoteRaw',
] as const;

export type CatchReportActivityField = (typeof CATCH_REPORT_ACTIVITY_FIELDS)[number];

export type CatalogItemActivitySnapshot =
  | {
      kind: 'FISHING_BASE' | 'FISH';
      id: string;
      name: string;
      isActive: boolean;
    }
  | {
      kind: 'LOCATION';
      id: string;
      name: string;
      number: number;
      isActive: boolean;
      fishingBase: ActivityNamedSnapshot;
    }
  | {
      kind: 'BAIT';
      id: string;
      name: string;
      type: 'BAIT' | 'LURE';
      isActive: boolean;
    };

export type ActivityChangeValue = string | number | boolean | null;

export type ActivityChange = {
  field: string;
  before: ActivityChangeValue;
  after: ActivityChangeValue;
};

export type FishingBaseFishActivitySnapshot = {
  fishingBase: ActivityNamedSnapshot;
  fish: ActivityNamedSnapshot;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
};

export type ActivityEventInput =
  | {
      type: 'CATCH_REPORT_CREATED' | 'CATCH_REPORT_DELETED';
      subjectType: 'CATCH_REPORT';
      subjectKey: string;
      payload: { report: CatchReportActivitySnapshot };
    }
  | {
      type: 'CATCH_REPORT_UPDATED';
      subjectType: 'CATCH_REPORT';
      subjectKey: string;
      payload: {
        report: CatchReportActivitySnapshot;
        changedFields: CatchReportActivityField[];
      };
    }
  | {
      type: 'CATCH_REPORT_BATCH_CREATED';
      subjectType: 'CATCH_REPORT_BATCH';
      subjectKey: string;
      payload: { createdCount: number };
    }
  | {
      type: 'CATALOG_ITEM_CREATED';
      subjectType: 'FISHING_BASE' | 'LOCATION' | 'FISH' | 'BAIT';
      subjectKey: string;
      payload: { item: CatalogItemActivitySnapshot };
    }
  | {
      type: 'CATALOG_ITEM_UPDATED';
      subjectType: 'FISHING_BASE' | 'LOCATION' | 'FISH' | 'BAIT';
      subjectKey: string;
      payload: { item: CatalogItemActivitySnapshot; changes: ActivityChange[] };
    }
  | {
      type: 'FISHING_BASE_FISH_ADDED' | 'FISHING_BASE_FISH_REMOVED';
      subjectType: 'FISHING_BASE_FISH';
      subjectKey: string;
      payload: { membership: FishingBaseFishActivitySnapshot };
    }
  | {
      type: 'FISHING_BASE_FISH_UPDATED';
      subjectType: 'FISHING_BASE_FISH';
      subjectKey: string;
      payload: { membership: FishingBaseFishActivitySnapshot; changes: ActivityChange[] };
    };

export type PublicActivityEvent = {
  id: string;
  occurredAt: Date;
  actor: { kind: 'ANGLER'; nickname: string } | { kind: 'ADMINISTRATION' };
  type: ActivityEventInput['type'];
  data: ActivityEventInput['payload'];
};
