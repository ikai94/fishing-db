import { IsIn, IsOptional } from 'class-validator';
import { CATALOG_STATUSES, type CatalogStatus } from '../catalog.constants.js';

export class CatalogStatusQueryDto {
  @IsOptional()
  @IsIn(CATALOG_STATUSES, { message: 'Статус должен быть all, active или inactive' })
  status?: CatalogStatus;
}
