import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { CATCH_REPORT_BATCH_MAX_ITEMS } from '../parser/catch-report-batch-splitter.js';
import { CreateCatchReportDto } from './create-catch-report.dto.js';

export class CreateCatchReportsBatchDto {
  @IsArray({ message: 'Передайте массив отчётов об улове' })
  @ArrayNotEmpty({ message: 'Выберите хотя бы один отчёт для сохранения' })
  @ArrayMaxSize(CATCH_REPORT_BATCH_MAX_ITEMS, {
    message: `За один раз можно сохранить не больше ${CATCH_REPORT_BATCH_MAX_ITEMS} отчётов`,
  })
  @ValidateNested({ each: true })
  @Type(() => CreateCatchReportDto)
  reports!: CreateCatchReportDto[];
}
