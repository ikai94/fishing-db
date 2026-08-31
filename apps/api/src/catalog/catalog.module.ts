import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';
import { FishImageDelivery } from './fish-image-delivery.js';
import { FishImagesController } from './fish-images.controller.js';
import { LocalFishImageDelivery } from './local-fish-image-delivery.service.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { CatalogController } from './catalog.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController, AdminCatalogController, FishImagesController],
  providers: [
    CatalogQueryService,
    CatalogAdminService,
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
})
export class CatalogModule {}
