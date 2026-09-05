import { IsString } from 'class-validator';

export class AuthEmailRequestDto {
  @IsString({ message: 'Email должен быть строкой' })
  email!: string;
}
