import { IsIn, IsString } from 'class-validator';
import { CATALOG_BAIT_TYPES, type CatalogBaitType } from '../catalog.constants.js';

export class CreateBaitDto {
  @IsString({ message: 'Название должно быть строкой' })
  name!: string;

  @IsIn(CATALOG_BAIT_TYPES, { message: 'Тип должен быть BAIT или LURE' })
  type!: CatalogBaitType;
}
