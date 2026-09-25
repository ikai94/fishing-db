import { IsUUID } from 'class-validator';

/** Проверяет идентификатор Fish в ADMIN-маршрутах метаданных рекордов. */
export class RecordNoteParamsDto {
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}
