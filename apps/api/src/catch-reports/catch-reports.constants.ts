export const CATCH_REPORT_SPOT_LANDMARKS = [
  'ROD',
  'NOTEBOOK',
  'BACKPACK',
  'REEL',
  'CHAT',
  'TACKLE',
] as const;

export type CatchReportSpotLandmark = (typeof CATCH_REPORT_SPOT_LANDMARKS)[number];

export const CATCH_REPORT_FISHING_NOTES = ['MIDWATER', 'FROM_BOTTOM', 'SURFACE'] as const;

export type CatchReportFishingNote = (typeof CATCH_REPORT_FISHING_NOTES)[number];

export const CATCH_REPORT_DEFAULT_LIMIT = 20;
export const CATCH_REPORT_MAX_LIMIT = 100;
export const CATCH_REPORT_MAX_INTEGER = 2_147_483_647;
export const CATCH_REPORT_USER_NOTE_MAX_LENGTH = 1_000;
