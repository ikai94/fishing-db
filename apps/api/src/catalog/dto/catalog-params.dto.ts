import { IsUUID } from 'class-validator';

export class FishingBaseIdParamsDto {
  @IsUUID('4', { message: 'Идентификатор базы должен быть UUID' })
  baseId!: string;
}

export class LocationIdParamsDto {
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId!: string;
}

export class FishIdParamsDto {
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}

export class BaitIdParamsDto {
  @IsUUID('4', { message: 'Идентификатор наживки должен быть UUID' })
  baitId!: string;
}

export class LocationFishParamsDto {
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId!: string;

  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}
