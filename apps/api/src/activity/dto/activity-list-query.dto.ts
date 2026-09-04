import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const ACTIVITY_DEFAULT_LIMIT = 20;
export const ACTIVITY_MAX_LIMIT = 50;

function transformLimit({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class ActivityListQueryDto {
  @Transform(transformLimit)
  @IsInt({ message: 'Лимит должен быть целым числом' })
  @Min(1, { message: 'Лимит должен быть не меньше 1' })
  @Max(ACTIVITY_MAX_LIMIT, { message: 'Лимит не должен превышать 50' })
  limit: number = ACTIVITY_DEFAULT_LIMIT;

  @IsOptional()
  @IsString({ message: 'Курсор должен быть строкой' })
  @MaxLength(1_024, { message: 'Курсор слишком длинный' })
  cursor?: string;
}
