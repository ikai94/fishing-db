import { IsBoolean } from 'class-validator';

/** Принимает явное состояние общей ночной метки Fish. */
export class UpdateNightMarkDto {
  @IsBoolean({ message: 'isNightBiting должен быть логическим значением' })
  isNightBiting!: boolean;
}
