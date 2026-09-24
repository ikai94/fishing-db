import { IsString, Matches, MaxLength } from 'class-validator';

/** Принимает одну строку заметки; пустое значение означает удаление сохранённой заметки. */
export class UpdateRecordNoteDto {
  @IsString({ message: 'Заметка должна быть строкой' })
  @MaxLength(500, { message: 'Заметка должна содержать не более 500 символов' })
  @Matches(/^[^\r\n]*$/u, { message: 'Заметка должна быть одной строкой' })
  note!: string;
}
