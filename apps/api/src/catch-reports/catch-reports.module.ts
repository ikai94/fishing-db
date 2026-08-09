import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CatchReportsController } from './catch-reports.controller.js';
import { CatchReportsService } from './catch-reports.service.js';
import { MyCatchReportsController } from './my-catch-reports.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatchReportsController, MyCatchReportsController],
  providers: [CatchReportsService],
})
export class CatchReportsModule {}
