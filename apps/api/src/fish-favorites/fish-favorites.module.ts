import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FishFavoritesController } from './fish-favorites.controller.js';
import { FishFavoritesService } from './fish-favorites.service.js';

/** Предоставляет независимый персональный ресурс избранных Fish. */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FishFavoritesController],
  providers: [FishFavoritesService],
})
export class FishFavoritesModule {}
