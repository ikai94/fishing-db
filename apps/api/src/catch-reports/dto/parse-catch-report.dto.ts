import { IsString, Matches, MinLength } from 'class-validator';
import {
  RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN,
  VALID_RAW_SOURCE_TEXT_PATTERN,
} from '../catch-report-raw-note.js';

export class ParseCatchReportDto {
  @IsString({ message: 'Исходный текст должен быть строкой' })
  @MinLength(1, { message: 'Исходный текст не может быть пустым' })
  @Matches(RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN, {
    message: 'Исходный текст не должен быть длиннее 20000 символов',
  })
  @Matches(VALID_RAW_SOURCE_TEXT_PATTERN, {
    message: 'Исходный текст не может состоять из пробелов или содержать небезопасные символы',
  })
  rawSourceText!: string;
}
