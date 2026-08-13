import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SafeUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { CatchReportsService } from './catch-reports.service.js';
import { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';
import { CatchReportParamsDto } from './dto/catch-report-params.dto.js';

@Controller('me/catch-reports')
@UseGuards(AuthGuard)
export class MyCatchReportsController {
  constructor(@Inject(CatchReportsService) private readonly catchReports: CatchReportsService) {}

  @Get()
  list(
    @CurrentUser() user: SafeUser,
    @Query(createApplicationValidationPipe(CatchReportListQueryDto))
    query: CatchReportListQueryDto,
  ) {
    return this.catchReports.listMine(user.id, query);
  }

  @Get(':reportId')
  get(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(CatchReportParamsDto)) params: CatchReportParamsDto,
  ) {
    return this.catchReports.getMine(user.id, params.reportId);
  }
}
