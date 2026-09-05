import { IsString } from 'class-validator';

export class ResetPasswordDto {
  @IsString({ message: 'Токен должен быть строкой' })
  token!: string;

  @IsString({ message: 'Пароль должен быть строкой' })
  password!: string;
}
