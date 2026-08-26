import { IsDefined, IsUUID } from 'class-validator';

export class BaitStatisticsQueryDto {
  @IsDefined({ message: 'Укажите рыбу' })
  @IsUUID('4', { message: 'Идентификатор рыбы должен быть UUID' })
  fishId!: string;

  @IsDefined({ message: 'Укажите базу' })
  @IsUUID('4', { message: 'Идентификатор базы должен быть UUID' })
  baseId!: string;
}
