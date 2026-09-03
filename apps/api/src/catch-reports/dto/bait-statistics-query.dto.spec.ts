import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BaitStatisticsQueryDto } from './bait-statistics-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';

void describe('BaitStatisticsQueryDto', () => {
  void it('requires one Fish UUID and accepts an omitted all-Bases scope', async () => {
    const valid = plainToInstance(BaitStatisticsQueryDto, { fishId: FISH_ID });
    assert.deepEqual(await validate(valid), []);
    assert.deepEqual(valid.baseIds, []);

    for (const value of [
      {},
      { baseIds: BASE_ID },
      { fishId: 'invalid', baseIds: BASE_ID },
      { fishId: FISH_ID, baseIds: 'invalid' },
      { fishId: FISH_ID, baseIds: [BASE_ID] },
    ]) {
      const dto = plainToInstance(BaitStatisticsQueryDto, value);
      assert.ok((await validate(dto)).length > 0, JSON.stringify(value));
    }
  });

  void it('lowercases and deduplicates a comma-separated Base scope', async () => {
    const dto = plainToInstance(BaitStatisticsQueryDto, {
      fishId: FISH_ID,
      baseIds: `${BASE_ID.toUpperCase()},${OTHER_BASE_ID},${BASE_ID}`,
    });

    assert.deepEqual(await validate(dto), []);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
  });
});
