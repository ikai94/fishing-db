import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BaitStatisticsQueryDto } from './bait-statistics-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';

void describe('BaitStatisticsQueryDto', () => {
  void it('requires one Fish UUID and one Base UUID', async () => {
    const valid = plainToInstance(BaitStatisticsQueryDto, { fishId: FISH_ID, baseId: BASE_ID });
    assert.deepEqual(await validate(valid), []);

    for (const value of [
      {},
      { fishId: FISH_ID },
      { baseId: BASE_ID },
      { fishId: 'invalid', baseId: BASE_ID },
      { fishId: FISH_ID, baseId: 'invalid' },
      { fishId: FISH_ID, baseId: [BASE_ID] },
    ]) {
      const dto = plainToInstance(BaitStatisticsQueryDto, value);
      assert.ok((await validate(dto)).length > 0, JSON.stringify(value));
    }
  });
});
