import { IsInt, IsOptional, Max, Min } from 'class-validator';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export class UpdateFishingBaseFishDto {
  @IsOptional()
  @IsInt({ message: 'Минимальный вес должен быть целым числом граммов' })
  @Min(1, { message: 'Минимальный вес должен быть не меньше 1 грамма' })
  @Max(POSTGRES_INTEGER_MAX, { message: 'Минимальный вес слишком большой' })
  minWeightGrams?: number | null;

  @IsOptional()
  @IsInt({ message: 'Максимальный вес должен быть целым числом граммов' })
  @Min(1, { message: 'Максимальный вес должен быть не меньше 1 грамма' })
  @Max(POSTGRES_INTEGER_MAX, { message: 'Максимальный вес слишком большой' })
  maxWeightGrams?: number | null;
}
