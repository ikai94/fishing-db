import { IsUUID } from 'class-validator';

export class LocationObservationsParamsDto {
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId!: string;
}
