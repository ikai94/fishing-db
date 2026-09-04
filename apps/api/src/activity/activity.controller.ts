import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { ActivityQueryService } from './activity-query.service.js';
import { ActivityListQueryDto } from './dto/activity-list-query.dto.js';

@Controller('activity')
export class ActivityController {
  constructor(@Inject(ActivityQueryService) private readonly activity: ActivityQueryService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(createApplicationValidationPipe(ActivityListQueryDto)) query: ActivityListQueryDto) {
    return this.activity.list(query);
  }
}
