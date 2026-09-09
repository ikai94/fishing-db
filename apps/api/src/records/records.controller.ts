import { Controller, Get, Inject } from '@nestjs/common';
import { RecordsQueryService } from './records-query.service.js';

@Controller('records')
export class RecordsController {
  constructor(@Inject(RecordsQueryService) private readonly records: RecordsQueryService) {}

  @Get()
  getRecords() {
    return this.records.getPublicRecords();
  }
}
