import { IsIn, IsInt, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator';
import {
  USER_NOTE_RAW_MAX_LENGTH_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from '../catch-report-raw-note.js';
import {
  CATCH_REPORT_FISHING_NOTES,
  CATCH_REPORT_MAX_INTEGER,
  CATCH_REPORT_SPOT_LANDMARKS,
  type CatchReportFishingNote,
  type CatchReportSpotLandmark,
} from '../catch-reports.constants.js';

export class UpdateCatchReportDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID('4', { message: 'Идентификатор наживки должен быть UUID' })
  baitId?: string;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsInt({ message: 'Вес должен быть целым числом граммов' })
  @Min(1, { message: 'Вес должен быть не меньше 1 грамма' })
  @Max(CATCH_REPORT_MAX_INTEGER, { message: 'Вес слишком большой' })
  weightGrams?: number;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsInt({ message: 'Глубина должна быть целым числом сантиметров' })
  @Min(1, { message: 'Глубина должна быть не меньше 1 сантиметра' })
  @Max(CATCH_REPORT_MAX_INTEGER, { message: 'Глубина слишком большая' })
  holeDepthCm?: number | null;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsIn(CATCH_REPORT_SPOT_LANDMARKS, { message: 'Выберите допустимый ориентир' })
  spotLandmark?: CatchReportSpotLandmark | null;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsIn(CATCH_REPORT_FISHING_NOTES, { message: 'Выберите допустимое условие ловли' })
  fishingNote?: CatchReportFishingNote | null;

  @ValidateIf((_object: unknown, value: unknown) => value !== undefined && value !== null)
  @IsString({ message: 'Исходная заметка должна быть строкой' })
  @Matches(USER_NOTE_RAW_MAX_LENGTH_PATTERN, {
    message: 'Исходная заметка не должна быть длиннее 1000 символов',
  })
  @Matches(VALID_USER_NOTE_RAW_PATTERN, {
    message: 'Исходная заметка не может состоять из пробелов или содержать управляющие символы',
  })
  userNoteRaw?: string | null;
}
