import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityEventWriter } from './activity-event-writer.service.js';
import { ActivityQueryService } from './activity-query.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ActivityController],
  providers: [ActivityEventWriter, ActivityQueryService],
  exports: [ActivityEventWriter],
})
export class ActivityModule {}
