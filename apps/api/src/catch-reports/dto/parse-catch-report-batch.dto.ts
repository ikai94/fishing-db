import { IsString, Matches, MinLength } from 'class-validator';
import { VALID_RAW_SOURCE_TEXT_PATTERN } from '../catch-report-raw-note.js';
import { CATCH_REPORT_BATCH_MAX_SOURCE_LENGTH } from '../parser/catch-report-batch-splitter.js';

const BATCH_SOURCE_MAX_LENGTH_PATTERN = new RegExp(
  `^[\\s\\S]{0,${CATCH_REPORT_BATCH_MAX_SOURCE_LENGTH}}$`,
);

export class ParseCatchReportBatchDto {
  @IsString({ message: 'Исходный текст должен быть строкой' })
  @MinLength(1, { message: 'Исходный текст не может быть пустым' })
  @Matches(BATCH_SOURCE_MAX_LENGTH_PATTERN, {
    message: `Пакет не должен быть длиннее ${CATCH_REPORT_BATCH_MAX_SOURCE_LENGTH} символов`,
  })
  @Matches(VALID_RAW_SOURCE_TEXT_PATTERN, {
    message: 'Исходный текст не может состоять из пробелов или содержать небезопасные символы',
  })
  rawSourceText!: string;
}
