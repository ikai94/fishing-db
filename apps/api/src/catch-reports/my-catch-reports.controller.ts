import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SafeUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { CatchReportsService } from './catch-reports.service.js';
import { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';

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
}
