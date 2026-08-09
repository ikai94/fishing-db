import { CATCH_REPORT_USER_NOTE_MAX_LENGTH } from './catch-reports.constants.js';

export const VALID_USER_NOTE_RAW_PATTERN = /^(?:$|(?!\s+$)(?![\s\S]*[\p{Cc}\p{Cf}])[\s\S]+)$/u;
export const USER_NOTE_RAW_MAX_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{0,${CATCH_REPORT_USER_NOTE_MAX_LENGTH}}$`,
  'u',
);

export function normalizeUserNoteRaw(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}
