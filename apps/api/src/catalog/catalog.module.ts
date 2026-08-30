import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';
import { FishImageDelivery } from './fish-image-delivery.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { CatalogController } from './catalog.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatalogController, AdminCatalogController],
  providers: [
    CatalogQueryService,
    CatalogAdminService,
    {
      provide: FishImageDelivery,
      useClass: DisabledFishImageDelivery,
    },
  ],
})
export class CatalogModule {}
