import { IsString } from 'class-validator';

export class VerifyEmailDto {
  @IsString({ message: 'Токен должен быть строкой' })
  token!: string;
}
