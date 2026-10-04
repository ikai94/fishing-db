import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { FishCommunityController, MyFishCommunityController } from './fish-community.controller.js';
import { FishCommunityService } from './fish-community.service.js';

/** Объединяет общие REST-правила для стилей ловли и времени активности. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [FishCommunityController, MyFishCommunityController],
  providers: [FishCommunityService],
})
export class FishCommunityModule {}
