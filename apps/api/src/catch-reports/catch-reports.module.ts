import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BaitStatisticsService } from './bait-statistics.service.js';
import { CatchReportsController } from './catch-reports.controller.js';
import { CatchReportsService } from './catch-reports.service.js';
import { HoleStatisticsService } from './hole-statistics.service.js';
import { MyCatchReportsController } from './my-catch-reports.controller.js';
import { CatchReportParserService } from './parser/catch-report-parser.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CatchReportsController, MyCatchReportsController],
  providers: [
    CatchReportsService,
    BaitStatisticsService,
    HoleStatisticsService,
    CatchReportParserService,
  ],
})
export class CatchReportsModule {}
