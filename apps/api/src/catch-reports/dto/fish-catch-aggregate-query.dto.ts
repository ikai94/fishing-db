import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CatchReportListQueryDto } from './catch-report-list-query.dto.js';

/** Сортирует все строки по их числу уловов либо восстанавливает порядок баз и локаций. */
export type FishCatchOrderMode = 'catches' | 'places';

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

/** Разбирает только явные булевы значения query, остальные оставляет для отказа валидатора. */
function transformBoolean({ value }: TransformFnParams): unknown {
  return value === 'true' ? true : value === 'false' ? false : value;
}

/** Проверяет охват, фильтры и порядок публичной выдачи агрегированных уловов Fish. */
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

  @IsIn(['catches', 'places'], { message: 'Режим порядка должен быть catches или places' })
  orderMode: FishCatchOrderMode = 'catches';

  @Transform(transformPositiveInteger)
  @IsOptional()
  @IsInt({ message: 'Минимум уловов должен быть целым числом' })
  @Min(1, { message: 'Минимум уловов должен быть не меньше 1' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'Минимум уловов слишком большой' })
  minIntensity?: number;

  // Только явные true/false: произвольный текст не должен незаметно включать фильтр.
  @Transform(transformBoolean)
  @IsOptional()
  @IsBoolean()
  hasComment?: boolean;

  @Transform(transformBoolean)
  @IsOptional()
  @IsBoolean()
  hasHole?: boolean;

  // Одна комбинация означает наличие размера ИЛИ проводки, а не обязательно обоих полей.
  @Transform(transformBoolean)
  @IsOptional()
  @IsBoolean()
  hasSpinning?: boolean;
}
