export const CATCH_REPORT_FISHING_NOTES = ['MIDWATER', 'FROM_BOTTOM', 'SURFACE'] as const;

export type CatchReportFishingNote = (typeof CATCH_REPORT_FISHING_NOTES)[number];

export const CATCH_REPORT_FISHING_METHODS = ['BAIT_FISHING', 'SPINNING'] as const;
export type CatchReportFishingMethod = (typeof CATCH_REPORT_FISHING_METHODS)[number];

export const CATCH_REPORT_SPINNING_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type CatchReportSpinningSize = (typeof CATCH_REPORT_SPINNING_SIZES)[number];

export const CATCH_REPORT_SPINNING_SPEEDS = ['SLOW', 'MEDIUM', 'FAST'] as const;
export type CatchReportSpinningSpeed = (typeof CATCH_REPORT_SPINNING_SPEEDS)[number];

export const CATCH_REPORT_DEFAULT_LIMIT = 20;
export const CATCH_REPORT_MAX_LIMIT = 100;
export const CATCH_REPORT_MAX_INTEGER = 2_147_483_647;
export const CATCH_REPORT_USER_NOTE_MAX_LENGTH = 1_000;
export const CATCH_REPORT_SPOT_POSITION_MAX_LENGTH = 1_000;
export const CATCH_REPORT_RAW_SOURCE_MAX_LENGTH = 20_000;
