import { IsString } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'Email должен быть строкой' })
  email!: string;

  @IsString({ message: 'Пароль должен быть строкой' })
  password!: string;
}
