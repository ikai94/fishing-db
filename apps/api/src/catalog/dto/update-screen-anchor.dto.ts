import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateScreenAnchorDto {
  @IsOptional()
  @IsString({ message: 'Название должно быть строкой' })
  name?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive должен быть логическим значением' })
  isActive?: boolean;
}
