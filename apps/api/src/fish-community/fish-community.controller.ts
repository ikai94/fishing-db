import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { NotBannedGuard } from '../auth/not-banned.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { SafeUser } from '../auth/auth.types.js';
import { createApplicationValidationPipe as pipe } from '../common/validation/validation-exception.factory.js';
import {
  FishCommunityParamsDto,
  FishCommunityVoteParamsDto,
  FishCommunityVotersQueryDto,
} from './fish-community.dto.js';
import { FishCommunityService } from './fish-community.service.js';

/** Публичное чтение знаний сообщества соответствует доступу к карточке Fish. */
@Controller('catalog/fish/:fishId/community-marks')
export class FishCommunityController {
  constructor(@Inject(FishCommunityService) private readonly service: FishCommunityService) {}
  /** Возвращает все варианты, включая нулевые счётчики. */
  @Get()
  counts(@Param(pipe(FishCommunityParamsDto)) params: FishCommunityParamsDto) {
    return this.service.counts(params.fishId);
  }
  /** Загружает участников только по запросу пользователя. */
  @Get(':mark/voters')
  voters(
    @Param(pipe(FishCommunityVoteParamsDto)) params: FishCommunityVoteParamsDto,
    @Query(pipe(FishCommunityVotersQueryDto)) query: FishCommunityVotersQueryDto,
  ) {
    return this.service.voters(params.fishId, params.mark, query.after);
  }
}

/** Сессия определяет владельца голоса, бан запрещает публичные изменения. */
@Controller('me/fish/:fishId/community-marks')
@UseGuards(AuthGuard)
export class MyFishCommunityController {
  constructor(@Inject(FishCommunityService) private readonly service: FishCommunityService) {}
  /** Чтение собственных отметок доступно и заблокированному участнику. */
  @Get()
  mine(
    @Param(pipe(FishCommunityParamsDto)) params: FishCommunityParamsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.service.mine(params.fishId, user.id);
  }
  /** Подтверждает вариант от имени текущей сессии. */
  @Post(':mark')
  @HttpCode(204)
  @UseGuards(NotBannedGuard)
  add(
    @Param(pipe(FishCommunityVoteParamsDto)) params: FishCommunityVoteParamsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.service.add(params.fishId, params.mark, user.id);
  }
  /** Снимает только собственное подтверждение. */
  @Delete(':mark')
  @HttpCode(204)
  @UseGuards(NotBannedGuard)
  remove(
    @Param(pipe(FishCommunityVoteParamsDto)) params: FishCommunityVoteParamsDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.service.remove(params.fishId, params.mark, user.id);
  }
}
