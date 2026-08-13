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
import { CatchReportsService } from './catch-reports.service.js';
import { CatchReportListQueryDto } from './dto/catch-report-list-query.dto.js';
import { CatchReportParamsDto } from './dto/catch-report-params.dto.js';
import { CreateCatchReportDto } from './dto/create-catch-report.dto.js';
import { ParseCatchReportDto } from './dto/parse-catch-report.dto.js';
import { UpdateCatchReportDto } from './dto/update-catch-report.dto.js';
import { CatchReportParserService } from './parser/catch-report-parser.service.js';

@Controller('catch-reports')
export class CatchReportsController {
  constructor(
    @Inject(CatchReportsService) private readonly catchReports: CatchReportsService,
    @Inject(CatchReportParserService) private readonly parser: CatchReportParserService,
  ) {}

  @Get()
  list(
    @Query(createApplicationValidationPipe(CatchReportListQueryDto))
    query: CatchReportListQueryDto,
  ) {
    return this.catchReports.listPublic(query);
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
