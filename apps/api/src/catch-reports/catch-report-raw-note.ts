import {
  CATCH_REPORT_RAW_SOURCE_MAX_LENGTH,
  CATCH_REPORT_SPOT_POSITION_MAX_LENGTH,
  CATCH_REPORT_USER_NOTE_MAX_LENGTH,
} from './catch-reports.constants.js';

export const VALID_USER_NOTE_RAW_PATTERN =
  /^(?:$|(?!\s+$)(?![\s\S]*[\p{Cc}\p{Cf}\p{Cs}])[\s\S]+)$/u;
export const USER_NOTE_RAW_MAX_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{0,${CATCH_REPORT_USER_NOTE_MAX_LENGTH}}$`,
  'u',
);

export const VALID_SPOT_POSITION_RAW_PATTERN = VALID_USER_NOTE_RAW_PATTERN;
export const SPOT_POSITION_RAW_MAX_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{0,${CATCH_REPORT_SPOT_POSITION_MAX_LENGTH}}$`,
  'u',
);

export const VALID_RAW_SOURCE_TEXT_PATTERN = new RegExp(
  // eslint-disable-next-line no-control-regex -- TAB, LF and CR are the intentionally permitted Cc characters.
  '^(?:$|(?!\\s+$)(?![\\s\\S]*[\\p{Cf}\\p{Cs}\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F])[\\s\\S]+)$',
  'u',
);
export const RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{0,${CATCH_REPORT_RAW_SOURCE_MAX_LENGTH}}$`,
  'u',
);

export function normalizeUserNoteRaw(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

export function normalizeSpotPositionRaw(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

export function normalizeRawSourceText(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}
