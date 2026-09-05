import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const CATALOG_SEARCH_DEFAULT_LIMIT = 50;
export const CATALOG_SEARCH_MAX_LIMIT = 100;
export const CATALOG_SEARCH_MAX_QUERY_LENGTH = 120;

function transformLimit({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class CatalogSearchQueryDto {
  @IsString({ message: 'Поисковый запрос должен быть строкой' })
  @MinLength(1, { message: 'Поисковый запрос не должен быть пустым' })
  @MaxLength(CATALOG_SEARCH_MAX_QUERY_LENGTH, {
    message: 'Поисковый запрос не должен превышать 120 символов',
  })
  q!: string;

  @Transform(transformLimit)
  @IsInt({ message: 'Лимит должен быть целым числом' })
  @Min(1, { message: 'Лимит должен быть не меньше 1' })
  @Max(CATALOG_SEARCH_MAX_LIMIT, { message: 'Лимит не должен превышать 100' })
  limit: number = CATALOG_SEARCH_DEFAULT_LIMIT;
}
