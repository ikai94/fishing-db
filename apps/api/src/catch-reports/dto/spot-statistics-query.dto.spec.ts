import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SpotEvidenceQueryDto, SpotStatisticsQueryDto } from './spot-statistics-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';

void describe('SpotStatisticsQueryDto', () => {
  void it('decodes bounded pagination and canonical ID filters', async () => {
    const dto = plainToInstance(SpotStatisticsQueryDto, {
      fishId: FISH_ID,
      baseIds: `${BASE_ID.toUpperCase()},${BASE_ID}`,
      limit: '100',
      offset: '25',
    });
    assert.deepEqual(await validate(dto), []);
    assert.deepEqual(dto.baseIds, [BASE_ID]);
    assert.equal(dto.limit, 100);
    assert.equal(dto.offset, 25);
  });

  void it('rejects empty and repeated-query filters plus invalid pagination', async () => {
    for (const value of [
      { fishId: FISH_ID, baseIds: '' },
      { fishId: FISH_ID, baseIds: [BASE_ID] },
      { fishId: FISH_ID, limit: '0' },
      { fishId: FISH_ID, offset: '-1' },
    ]) {
      assert.ok((await validate(plainToInstance(SpotStatisticsQueryDto, value))).length > 0);
    }
  });
});

void describe('SpotEvidenceQueryDto', () => {
  void it('requires a bounded group key and validates the evidence cursor', async () => {
    const valid = plainToInstance(SpotEvidenceQueryDto, { locationId: FISH_ID, groupKey: 'abc' });
    assert.deepEqual(await validate(valid), []);

    const invalid = plainToInstance(SpotEvidenceQueryDto, {
      locationId: FISH_ID,
      groupKey: 'x'.repeat(8_193),
      cursor: 'x'.repeat(1_025),
    });
    assert.deepEqual((await validate(invalid)).map((error) => error.property).sort(), [
      'cursor',
      'groupKey',
    ]);
  });
});
