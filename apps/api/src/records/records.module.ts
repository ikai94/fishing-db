import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminRecordsController } from './admin-records.controller.js';
import { RecordNotesService } from './record-notes.service.js';
import { RecordsController } from './records.controller.js';
import { RecordsQueryService } from './records-query.service.js';
import { RecordsSyncService } from './records-sync.service.js';

/** Объединяет публичное чтение рекордов и фоновую синхронизацию с PostgreSQL. */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RecordsController, AdminRecordsController],
  providers: [RecordsQueryService, RecordsSyncService, RecordNotesService],
})
export class RecordsModule {}
