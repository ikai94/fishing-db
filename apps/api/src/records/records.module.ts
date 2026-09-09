import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RecordsController } from './records.controller.js';
import { RecordsQueryService } from './records-query.service.js';
import { RecordsSyncService } from './records-sync.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [RecordsController],
  providers: [RecordsQueryService, RecordsSyncService],
})
export class RecordsModule {}
