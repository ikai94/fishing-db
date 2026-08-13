import type { CatalogBaitType } from '../../catalog/catalog.constants.js';
import type {
  CatchReportFishingMethod,
  CatchReportFishingNote,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../catch-reports.constants.js';

export type DraftStatus = 'RESOLVED' | 'MISSING' | 'UNRESOLVED';
export type DraftIssueSeverity = 'BLOCKING' | 'WARNING';

export interface SourceRange {
  text: string;
  start: number;
  end: number;
}

export type DraftField<T> =
  | {
      status: 'RESOLVED';
      sourceText: string | null;
      value: T | null;
      required: boolean;
    }
  | {
      status: 'MISSING';
      sourceText: null;
      value: null;
      required: true;
    }
  | {
      status: 'UNRESOLVED';
      sourceText: string;
      value: null;
      required: boolean;
      code: string;
    };

export interface DraftNamedItem {
  id: string;
  name: string;
}

export interface DraftLocation extends DraftNamedItem {
  number: number;
}

export interface DraftBait extends DraftNamedItem {
  type: CatalogBaitType;
}

export interface DraftIssue {
  severity: DraftIssueSeverity;
  code: string;
  field?: string;
  message: string;
}

export type DraftUnresolvedFragment = SourceRange;

export interface CatchReportDraft {
  rawSourceText: string;
  fields: {
    fishingBase: DraftField<DraftNamedItem>;
    location: DraftField<DraftLocation>;
    fish: DraftField<DraftNamedItem>;
    bait: DraftField<DraftBait>;
    weightGrams: DraftField<number>;
    fishingMethod: DraftField<CatchReportFishingMethod>;
    holeDepthCm: DraftField<number>;
    spotPositionRaw: DraftField<string>;
    fishingNote: DraftField<CatchReportFishingNote>;
    spinningSize: DraftField<CatchReportSpinningSize>;
    spinningSpeed: DraftField<CatchReportSpinningSpeed>;
    userNoteRaw: DraftField<string>;
  };
  baseFishMembership: {
    status: DraftStatus;
    baseId: string | null;
    fishId: string | null;
  };
  issues: DraftIssue[];
  unresolvedFragments: DraftUnresolvedFragment[];
  missingRequiredFields: string[];
  canConfirm: boolean;
}

export interface ParseCatchReportResult {
  draft: CatchReportDraft;
}

export function resolvedField<T>(
  value: T | null,
  sourceText: string | null,
  required: boolean,
): DraftField<T> {
  return { status: 'RESOLVED', sourceText, value, required };
}

export function missingField<T>(): DraftField<T> {
  return { status: 'MISSING', sourceText: null, value: null, required: true };
}

export function unresolvedField<T>(
  sourceText: string,
  code: string,
  required: boolean,
): DraftField<T> {
  return { status: 'UNRESOLVED', sourceText, value: null, required, code };
}
