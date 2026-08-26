import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FishCatchAggregateQueryDto } from './fish-catch-aggregate-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';

void describe('FishCatchAggregateQueryDto', () => {
  void it('requires Fish/Base scope and preserves inherited pagination', async () => {
    const dto = plainToInstance(FishCatchAggregateQueryDto, {
      fishId: FISH_ID,
      baseIds: `${BASE_ID.toUpperCase()},${OTHER_BASE_ID},${BASE_ID}`,
      limit: '7',
      cursor: 'opaque',
    });

    assert.deepEqual(await validate(dto), []);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
    assert.equal(dto.limit, 7);
    assert.equal(dto.cursor, 'opaque');
  });

  void it('rejects missing, empty, repeated-query, malformed, and oversized scopes', async () => {
    const tooManyIds = Array.from(
      { length: 101 },
      (_, index) => `60000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    ).join(',');

    for (const value of [
      {},
      { fishId: FISH_ID, baseIds: '' },
      { fishId: FISH_ID, baseIds: [BASE_ID, OTHER_BASE_ID] },
      { fishId: FISH_ID, baseIds: `${BASE_ID},invalid` },
      { fishId: FISH_ID, baseIds: tooManyIds },
      { fishId: 'invalid', baseIds: BASE_ID },
    ]) {
      const dto = plainToInstance(FishCatchAggregateQueryDto, value);
      assert.ok((await validate(dto)).length > 0, JSON.stringify(value));
    }
  });
});
