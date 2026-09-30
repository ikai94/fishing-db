import { IsBoolean } from 'class-validator';

/** Принимает только явное состояние приватной отметки проверки редкости. */
export class UpdateRarityReviewDto {
  @IsBoolean()
  needsCorrection!: boolean;
}
