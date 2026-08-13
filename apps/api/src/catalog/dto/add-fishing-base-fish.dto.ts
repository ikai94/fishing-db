import { IsUUID } from 'class-validator';

export class AddFishingBaseFishDto {
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}
