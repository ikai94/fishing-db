import { IsUUID } from 'class-validator';

/** Проверяет Fish ID на HTTP-границе персонального списка избранного. */
export class FavoriteFishParamsDto {
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;
}
