import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { AdminBaseFishNotebookController } from './admin-base-fish-notebook.controller.js';
import { AdminFishNotesController } from './admin-fish-notes.controller.js';
import { BaseFishNotebookService } from './base-fish-notebook.service.js';
import { BaitImageDelivery } from './bait-image-delivery.js';
import { BaitImagesController } from './bait-images.controller.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { DisabledBaitImageDelivery } from './disabled-bait-image-delivery.service.js';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';
import { FishImageDelivery } from './fish-image-delivery.js';
import { FishImagesController } from './fish-images.controller.js';
import { LocalFishImageDelivery } from './local-fish-image-delivery.service.js';
import { LocalBaitImageDelivery } from './local-bait-image-delivery.service.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { CatalogController } from './catalog.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, ActivityModule],
  controllers: [
    CatalogController,
    AdminCatalogController,
    AdminBaseFishNotebookController,
    AdminFishNotesController,
    FishImagesController,
    BaitImagesController,
  ],
  providers: [
    CatalogQueryService,
    CatalogAdminService,
    BaseFishNotebookService,
    {
      provide: BaitImageDelivery,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService): Promise<BaitImageDelivery> => {
        const mode = configService.getOrThrow<'disabled' | 'local'>('BAIT_IMAGE_DELIVERY_MODE');
        if (mode === 'disabled') return new DisabledBaitImageDelivery();
        return LocalBaitImageDelivery.load({
          storageRoot: configService.getOrThrow<string>('BAIT_IMAGE_STORAGE_ROOT'),
        });
      },
    },
    {
      provide: FishImageDelivery,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService): Promise<FishImageDelivery> => {
        const mode = configService.getOrThrow<'disabled' | 'local'>('FISH_IMAGE_DELIVERY_MODE');
        if (mode === 'disabled') return new DisabledFishImageDelivery();
        return LocalFishImageDelivery.load({
          storageRoot: configService.getOrThrow<string>('FISH_IMAGE_STORAGE_ROOT'),
        });
      },
    },
  ],
  exports: [BaitImageDelivery, FishImageDelivery],
})
export class CatalogModule {}
