import { IsBoolean } from 'class-validator';

/** Изменяет только личную видимость пары; владелец и заметка не принимаются из тела запроса. */
export class SetBaseFishNotebookVisibilityDto {
  @IsBoolean({ message: 'Видимость должна быть логическим значением' })
  isHidden!: boolean;
}
