import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional()
  @IsInt({ message: 'Номер локации должен быть целым числом' })
  @Min(1, { message: 'Номер локации должен быть не меньше 1' })
  @Max(2_147_483_647, { message: 'Номер локации слишком большой' })
  number?: number;

  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  name?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive должен быть логическим значением' })
  isActive?: boolean;
}
