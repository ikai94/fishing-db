import { IsUUID } from 'class-validator';

export class AddLocationFishDto {
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}
