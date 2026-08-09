import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { CATALOG_BAIT_TYPES, type CatalogBaitType } from '../catalog.constants.js';

export class UpdateBaitDto {
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  name?: string;

  @IsOptional()
  @IsIn(CATALOG_BAIT_TYPES, { message: 'Тип должен быть BAIT или LURE' })
  type?: CatalogBaitType;

  @IsOptional()
  @IsBoolean({ message: 'isActive должен быть логическим значением' })
  isActive?: boolean;
}
