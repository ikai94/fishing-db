import { Controller, Get, Inject } from '@nestjs/common';
import { RecordsQueryService } from './records-query.service.js';

/** Публичная HTTP-граница чтения официальных недельных рекордов. */
@Controller('records')
export class RecordsController {
  constructor(@Inject(RecordsQueryService) private readonly records: RecordsQueryService) {}

  /** Возвращает текущую публичную проекцию; авторизация для этого каталожного чтения не требуется. */
  @Get()
  getRecords() {
    return this.records.getPublicRecords();
  }
}
