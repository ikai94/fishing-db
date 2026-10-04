import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { FishCommunityMark } from '../generated/prisma/client.js';

/** Проверяет публичную рыбу и независимый вариант отметки на HTTP-границе. */
export class FishCommunityParamsDto {
  @IsUUID('4')
  fishId!: string;
}

/** Не принимает идентификатор голосующего: его определяет сессия. */
export class FishCommunityVoteParamsDto extends FishCommunityParamsDto {
  @IsEnum(FishCommunityMark)
  mark!: FishCommunityMark;
}

/** Курсор ограничивает публичную выдачу никнеймов пятьюдесятью строками. */
export class FishCommunityVotersQueryDto {
  @IsOptional()
  @IsUUID('4')
  after?: string;
}
