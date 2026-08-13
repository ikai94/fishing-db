import { IsString } from 'class-validator';

export class CreateScreenAnchorDto {
  @IsString({ message: 'Название должно быть строкой' })
  name!: string;
}
