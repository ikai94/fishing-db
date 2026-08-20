import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { SafeUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { NotBannedGuard } from '../auth/not-banned.guard.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { BaitStatisticsService } from './bait-statistics.service.js';
import { CatchReportsService } from './catch-reports.service.js';
import { CatchReportParamsDto } from './dto/catch-report-params.dto.js';
import { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import { HoleStatisticsQueryDto } from './dto/hole-statistics-query.dto.js';
import { ParseCatchReportDto } from './dto/parse-catch-report.dto.js';
import { PublicCatchReportListQueryDto } from './dto/public-catch-report-list-query.dto.js';
import { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';
import { FishingConditionStatisticsService } from './fishing-condition-statistics.service.js';
import { HoleStatisticsService } from './hole-statistics.service.js';
import { CatchReportParserService } from './parser/catch-report-parser.service.js';

@Controller('catch-reports')
export class CatchReportsController {
  constructor(
    @Inject(CatchReportsService) private readonly catchReports: CatchReportsService,
    @Inject(BaitStatisticsService) private readonly baitStatistics: BaitStatisticsService,
    @Inject(FishingConditionStatisticsService)
    private readonly fishingConditionStatistics: FishingConditionStatisticsService,
    @Inject(HoleStatisticsService) private readonly holeStatistics: HoleStatisticsService,
    @Inject(CatchReportParserService) private readonly parser: CatchReportParserService,
  ) {}

  @Get()
  list(
    @Query(createApplicationValidationPipe(PublicCatchReportListQueryDto))
    query: PublicCatchReportListQueryDto,
  ) {
    return this.catchReports.listPublic(query);
  }

  @Get('statistics/baits')
  listBaitStatistics(
    @Query(createApplicationValidationPipe(HoleStatisticsQueryDto))
    query: HoleStatisticsQueryDto,
  ) {
    return this.baitStatistics.list(query);
  }

  @Get('statistics/conditions')
  listFishingConditionStatistics(
    @Query(createApplicationValidationPipe(HoleStatisticsQueryDto))
    query: HoleStatisticsQueryDto,
  ) {
    return this.fishingConditionStatistics.list(query);
  }

  @Get('statistics/holes')
  listHoleStatistics(
    @Query(createApplicationValidationPipe(HoleStatisticsQueryDto))
    query: HoleStatisticsQueryDto,
  ) {
    return this.holeStatistics.list(query);
  }

  @Get(':reportId')
  get(@Param(createApplicationValidationPipe(CatchReportParamsDto)) params: CatchReportParamsDto) {
    return this.catchReports.getPublic(params.reportId);
  }

  @Post('parse')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  parse(@Body(createApplicationValidationPipe(ParseCatchReportDto)) dto: ParseCatchReportDto) {
    return this.parser.parse(dto.rawSourceText);
  }

  @Post()
  @UseGuards(AuthGuard, NotBannedGuard)
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: SafeUser,
    @Body(createApplicationValidationPipe(CreateCatchReportDto)) dto: CreateCatchReportDto,
  ) {
    return this.catchReports.create(user.id, dto);
  }

  @Patch(':reportId')
  @UseGuards(AuthGuard, NotBannedGuard)
  update(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(CatchReportParamsDto)) params: CatchReportParamsDto,
    @Body(createApplicationValidationPipe(UpdateCatchReportDto)) dto: UpdateCatchReportDto,
  ) {
    return this.catchReports.update(user.id, params.reportId, dto);
  }

  @Delete(':reportId')
  @UseGuards(AuthGuard, NotBannedGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @CurrentUser() user: SafeUser,
    @Param(createApplicationValidationPipe(CatchReportParamsDto)) params: CatchReportParamsDto,
  ): Promise<void> {
    return this.catchReports.delete(user.id, params.reportId);
  }
}
