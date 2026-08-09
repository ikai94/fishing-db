import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CATCH_REPORT_DEFAULT_LIMIT, CATCH_REPORT_MAX_LIMIT } from '../catch-reports.constants.js';

function transformLimit({ value }: TransformFnParams): unknown {
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return value;
}

export class CatchReportListQueryDto {
  @Transform(transformLimit)
  @IsInt({ message: 'Лимит должен быть целым числом' })
  @Min(1, { message: 'Лимит должен быть не меньше 1' })
  @Max(CATCH_REPORT_MAX_LIMIT, { message: 'Лимит не должен превышать 100' })
  limit: number = CATCH_REPORT_DEFAULT_LIMIT;

  @IsOptional()
  @IsString({ message: 'Курсор должен быть строкой' })
  @MaxLength(1_024, { message: 'Курсор слишком длинный' })
  cursor?: string;
}
