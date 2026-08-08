import { IsString } from 'class-validator';

export class RegisterDto {
  @IsString({ message: 'Email должен быть строкой' })
  email!: string;

  @IsString({ message: 'Никнейм должен быть строкой' })
  nickname!: string;

  @IsString({ message: 'Пароль должен быть строкой' })
  password!: string;
}
