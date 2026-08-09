import { IsString } from 'class-validator';

export class CreateFishingBaseDto {
  @IsString({ message: 'Название должно быть строкой' })
  name!: string;
}
