import { Transform, type TransformFnParams } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsUUID } from 'class-validator';

function transformBaseIds({ value, obj }: TransformFnParams): unknown {
  if (Array.isArray(value)) {
    return obj instanceof BaitStatisticsQueryDto ? value : [value];
  }

  if (typeof value !== 'string') return value;

  return [...new Set(value.split(',').map((baseId) => baseId.toLowerCase()))];
}

export class BaitStatisticsQueryDto {
  @IsDefined({ message: 'Укажите рыбу' })
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;

  @Transform(transformBaseIds)
  @IsArray({ message: 'Идентификаторы баз должны быть строкой через запятую' })
  @ArrayMaxSize(100, { message: 'Нельзя указать больше 100 баз' })
  @IsUUID('4', { each: true, message: 'Каждый идентификатор базы должен быть UUID' })
  baseIds: string[] = [];
}
