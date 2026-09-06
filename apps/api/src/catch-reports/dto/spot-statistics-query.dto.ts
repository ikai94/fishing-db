import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function transformIds({ value, obj }: TransformFnParams): unknown {
  if (Array.isArray(value)) {
    return obj instanceof SpotStatisticsQueryDto || obj instanceof SpotEvidenceQueryDto
      ? value
      : [value];
  }

  if (typeof value !== 'string') return value;
  return [...new Set(value.split(',').map((id) => id.toLowerCase()))];
}

function transformInteger({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

class SpotScopeQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Идентификатор локации должен быть UUID' })
  locationId?: string;

  @IsOptional()
  @Transform(transformIds)
  @IsArray({ message: 'Идентификаторы баз должны быть строкой через запятую' })
  @ArrayNotEmpty({ message: 'Укажите хотя бы одну базу' })
  @ArrayMaxSize(100, { message: 'Нельзя указать больше 100 баз' })
  @IsUUID('4', { each: true, message: 'Каждый идентификатор базы должен быть UUID' })
  baseIds?: string[];

  @IsOptional()
  @Transform(transformIds)
  @IsArray({ message: 'Идентификаторы рыб должны быть строкой через запятую' })
  @ArrayNotEmpty({ message: 'Укажите хотя бы одну рыбу' })
  @ArrayMaxSize(100, { message: 'Нельзя указать больше 100 рыб' })
  @IsUUID('4', { each: true, message: 'Каждый идентификатор рыбы должен быть UUID' })
  fishIds?: string[];
}

export class SpotStatisticsQueryDto extends SpotScopeQueryDto {
  @Transform(transformInteger)
  @IsInt({ message: 'Лимит должен быть целым числом' })
  @Min(1, { message: 'Лимит должен быть не меньше 1' })
  @Max(100, { message: 'Лимит не должен превышать 100' })
  limit: number = 25;

  @Transform(transformInteger)
  @IsInt({ message: 'Смещение должно быть целым числом' })
  @Min(0, { message: 'Смещение не может быть отрицательным' })
  @Max(100_000, { message: 'Смещение слишком велико' })
  offset: number = 0;
}

export class SpotEvidenceQueryDto extends SpotScopeQueryDto {
  @IsString({ message: 'Ключ группы должен быть строкой' })
  @MaxLength(8_192, { message: 'Ключ группы слишком длинный' })
  groupKey!: string;

  @Transform(transformInteger)
  @IsInt({ message: 'Лимит должен быть целым числом' })
  @Min(1, { message: 'Лимит должен быть не меньше 1' })
  @Max(100, { message: 'Лимит не должен превышать 100' })
  limit: number = 25;

  @IsOptional()
  @IsString({ message: 'Курсор должен быть строкой' })
  @MaxLength(1_024, { message: 'Курсор слишком длинный' })
  cursor?: string;
}
