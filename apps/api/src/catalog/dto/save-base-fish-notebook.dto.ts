import { IsString, MaxLength, ValidateIf } from 'class-validator';

/** Заменяет личную заметку; null и пустой текст очищают значение, отсутствие поля запрещено. */
export class SaveBaseFishNotebookDto {
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString({ message: 'Заметка должна быть строкой или null' })
  @MaxLength(5000, { message: 'Заметка должна содержать не более 5000 символов' })
  noteText!: string | null;
}
