import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { BaitStatisticsService } from './bait-statistics.service.js';
import { CatchReportsController } from './catch-reports.controller.js';
import { CatchReportsService } from './catch-reports.service.js';
import { FishingConditionStatisticsService } from './fishing-condition-statistics.service.js';
import { FishCatchAggregatesService } from './fish-catch-aggregates.service.js';
import { HoleStatisticsService } from './hole-statistics.service.js';
import { MyCatchReportsController } from './my-catch-reports.controller.js';
import { PersonalCatchStatisticsService } from './personal-catch-statistics.service.js';
import { SpotAnalyticsService } from './spot-analytics.service.js';
import { CatchReportParserService } from './parser/catch-report-parser.service.js';

@Module({
  imports: [PrismaModule, AuthModule, ActivityModule, CatalogModule],
  controllers: [CatchReportsController, MyCatchReportsController],
  providers: [
    CatchReportsService,
    BaitStatisticsService,
    FishCatchAggregatesService,
    FishingConditionStatisticsService,
    HoleStatisticsService,
    PersonalCatchStatisticsService,
    SpotAnalyticsService,
    CatchReportParserService,
  ],
})
export class CatchReportsModule {}
