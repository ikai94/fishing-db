import { IsString } from 'class-validator';

export class CreateFishDto {
  @IsString({ message: 'Название должно быть строкой' })
  name!: string;
}
