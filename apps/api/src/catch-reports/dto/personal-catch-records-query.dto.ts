import { CatchReportListQueryDto } from './catch-report-list-query.dto.js';

export class PersonalCatchRecordsQueryDto extends CatchReportListQueryDto {
  override limit: number = 50;
}
