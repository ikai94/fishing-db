import { IsInt, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Принимает ADMIN-уточнение ожидаемого веса и необязательное однострочное пояснение. */
export class UpdateWrongMaxIssueDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsInt({ message: 'Ожидаемый вес должен быть целым числом граммов' })
  @Min(1, { message: 'Ожидаемый вес должен быть положительным' })
  @Max(2_147_483_647, { message: 'Ожидаемый вес слишком велик' })
  expectedWeightGrams!: number | null;

  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString({ message: 'Пояснение должно быть строкой или null' })
  @MaxLength(500, { message: 'Пояснение должно содержать не более 500 символов' })
  @Matches(/^[^\r\n]*$/u, { message: 'Пояснение должно быть одной строкой' })
  note!: string | null;
}
