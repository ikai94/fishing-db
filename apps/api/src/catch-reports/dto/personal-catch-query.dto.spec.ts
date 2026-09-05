import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OwnerCatchReportListQueryDto } from './owner-catch-report-list-query.dto.js';
import { PersonalCatchRecordsQueryDto } from './personal-catch-records-query.dto.js';

const ID = '40000000-0000-4000-8000-000000000001';

void describe('personal CatchReport query DTOs', () => {
  void it('accepts native owner filters and inherited pagination', async () => {
    const dto = plainToInstance(OwnerCatchReportListQueryDto, {
      source: 'native',
      fishId: ID,
      baseId: ID,
      locationId: ID,
      baitId: ID,
      limit: '7',
      cursor: 'opaque',
    });

    assert.deepEqual(await validate(dto), []);
    assert.equal(dto.limit, 7);
  });

  void it('rejects unsupported sources and malformed entity IDs', async () => {
    for (const value of [{ source: 'imported' }, { source: 'native', fishId: 'invalid' }]) {
      const dto = plainToInstance(OwnerCatchReportListQueryDto, value);
      assert.ok((await validate(dto)).length > 0);
    }
  });

  void it('uses a 50-row default and inherited 100-row maximum for records', async () => {
    const defaultDto = plainToInstance(PersonalCatchRecordsQueryDto, {});
    assert.deepEqual(await validate(defaultDto), []);
    assert.equal(defaultDto.limit, 50);

    const tooLarge = plainToInstance(PersonalCatchRecordsQueryDto, { limit: '101' });
    assert.ok((await validate(tooLarge)).length > 0);
  });
});
