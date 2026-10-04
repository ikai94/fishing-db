import { Type } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';

/** Ограничивает ленивое чтение публичных значений одной агрегированной строкой. */
export class FishCatchValuesQueryDto {
  @IsUUID('4')
  fishId!: string;
  @IsUUID('4')
  locationId!: string;
  @IsUUID('4')
  baitId!: string;
  @IsIn(['comment', 'hole'])
  field!: 'comment' | 'hole';
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset = 0;
}
