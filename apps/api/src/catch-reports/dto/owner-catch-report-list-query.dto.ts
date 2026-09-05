import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { CatchReportListQueryDto } from './catch-report-list-query.dto.js';

export class OwnerCatchReportListQueryDto extends CatchReportListQueryDto {
  @IsOptional()
  @IsIn(['native'], { message: 'Источник должен иметь значение native' })
  source?: 'native';

  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор базы должен быть UUID' })
  baseId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор наживки должен быть UUID' })
  baitId?: string;
}
