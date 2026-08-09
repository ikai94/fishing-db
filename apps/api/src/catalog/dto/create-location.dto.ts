import { IsInt, IsString, Max, Min } from 'class-validator';

export class CreateLocationDto {
  @IsInt({ message: 'Номер локации должен быть целым числом' })
  @Min(1, { message: 'Номер локации должен быть не меньше 1' })
  @Max(2_147_483_647, { message: 'Номер локации слишком большой' })
  number!: number;

  @IsString({ message: 'Название должно быть строкой' })
  name!: string;
}
