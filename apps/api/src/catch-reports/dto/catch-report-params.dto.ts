import { IsUUID } from 'class-validator';

export class CatchReportParamsDto {
  @IsUUID('4', { message: 'Идентификатор отчёта должен быть UUID' })
  reportId!: string;
}
