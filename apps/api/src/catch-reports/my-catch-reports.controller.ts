import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SafeUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { CatchReportsService } from './catch-reports.service.js';
import { CatchReportParamsDto } from './dto/catch-report-params.dto.js';
import { OwnerCatchReportListQueryDto } from './dto/owner-catch-report-list-query.dto.js';
import { PersonalCatchRecordsQueryDto } from './dto/personal-catch-records-query.dto.js';
import { PersonalCatchStatisticsService } from './personal-catch-statistics.service.js';

@Controller('me/catch-reports')
@UseGuards(AuthGuard)
export class MyCatchReportsController {
  constructor(
    @Inject(CatchReportsService) private readonly catchReports: CatchReportsService,
    @Inject(PersonalCatchStatisticsService)
    private readonly statistics: PersonalCatchStatisticsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query(createApplicationValidationPipe(OwnerCatchReportListQueryDto))
    query: OwnerCatchReportListQueryDto,
  ) {
    return this.catchReports.listMine(user.id, query);
  }

  @Get('statistics')
  getStatistics(@CurrentUser() user: SafeUser) {
    return this.statistics.getStatistics(user.id);
  }

  @Get('records')
  listRecords(
    @CurrentUser() user: SafeUser,
    @Query(createApplicationValidationPipe(PersonalCatchRecordsQueryDto))
    query: PersonalCatchRecordsQueryDto,
  ) {
    return this.statistics.listRecords(user.id, query);
  }

  @Get(':reportId')
  get(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(CatchReportParamsDto)) params: CatchReportParamsDto,
  ) {
    return this.catchReports.getMine(user.id, params.reportId);
  }
}
