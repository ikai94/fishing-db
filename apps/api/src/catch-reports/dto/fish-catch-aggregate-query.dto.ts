import { Transform, type TransformFnParams } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsDefined, IsUUID } from 'class-validator';
import { CatchReportListQueryDto } from './catch-report-list-query.dto.js';

function transformBaseIds({ value, obj }: TransformFnParams): unknown {
  if (Array.isArray(value)) {
    return obj instanceof FishCatchAggregateQueryDto ? value : [value];
  }

  if (typeof value !== 'string') return value;

  return [...new Set(value.split(',').map((baseId) => baseId.toLowerCase()))];
}

export class FishCatchAggregateQueryDto extends CatchReportListQueryDto {
  @IsDefined({ message: 'Укажите рыбу' })
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;

  @IsDefined({ message: 'Укажите базы' })
  @Transform(transformBaseIds)
  @IsArray({ message: 'Идентификаторы баз должны быть строкой через запятую' })
  @ArrayNotEmpty({ message: 'Укажите хотя бы одну базу' })
  @ArrayMaxSize(100, { message: 'Нельзя указать больше 100 баз' })
  @IsUUID('4', { each: true, message: 'Каждый идентификатор базы должен быть UUID' })
  baseIds!: string[];
}
