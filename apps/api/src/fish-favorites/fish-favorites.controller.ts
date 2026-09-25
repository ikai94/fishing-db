import { Controller, Delete, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SafeUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { FavoriteFishParamsDto } from './dto/favorite-fish-params.dto.js';
import { FishFavoritesService } from './fish-favorites.service.js';

/** Ограничивает чтение и изменение избранных Fish текущей проверенной сессией. */
@Controller('me/favorite-fish')
@UseGuards(AuthGuard)
export class FishFavoritesController {
  constructor(@Inject(FishFavoritesService) private readonly favorites: FishFavoritesService) {}

  /** Возвращает избранное только текущего пользователя. */
  @Get()
  list(@CurrentUser() user: SafeUser) {
    return this.favorites.list(user.id);
  }

  /** Добавляет Fish без приёма userId из запроса. */
  @Post(':fishId')
  add(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FavoriteFishParamsDto)) params: FavoriteFishParamsDto,
  ) {
    return this.favorites.add(user.id, params.fishId);
  }

  /** Удаляет Fish без приёма userId из запроса. */
  @Delete(':fishId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(FavoriteFishParamsDto)) params: FavoriteFishParamsDto,
  ): Promise<void> {
    await this.favorites.remove(user.id, params.fishId);
  }
}
