import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CatchReportListQueryDto } from './catch-report-list-query.dto.js';

export type FishCatchIntensityOrder = 'asc' | 'desc';

function transformBaseIds({ value, obj }: TransformFnParams): unknown {
  if (Array.isArray(value)) {
    return obj instanceof FishCatchAggregateQueryDto ? value : [value];
  }

  if (typeof value !== 'string') return value;

  return [...new Set(value.split(',').map((baseId) => baseId.toLowerCase()))];
}

function transformPositiveInteger({ value }: TransformFnParams): unknown {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
}

export class FishCatchAggregateQueryDto extends CatchReportListQueryDto {
  @IsDefined({ message: 'Укажите рыбу' })
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;

  @Transform(transformBaseIds)
  @IsArray({ message: 'Идентификаторы баз должны быть строкой через запятую' })
  @ArrayMaxSize(100, { message: 'Нельзя указать больше 100 баз' })
  @IsUUID('4', { each: true, message: 'Каждый идентификатор базы должен быть UUID' })
  baseIds: string[] = [];

  @IsIn(['asc', 'desc'], { message: 'Порядок уловов должен быть asc или desc' })
  intensityOrder: FishCatchIntensityOrder = 'desc';

  @Transform(transformPositiveInteger)
  @IsOptional()
  @IsInt({ message: 'Минимум уловов должен быть целым числом' })
  @Min(1, { message: 'Минимум уловов должен быть не меньше 1' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'Минимум уловов слишком большой' })
  minIntensity?: number;
}
