import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HoleStatisticsQueryDto } from './hole-statistics-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';

async function decode(value: Record<string, unknown>): Promise<{
  dto: HoleStatisticsQueryDto;
  errors: Awaited<ReturnType<typeof validate>>;
}> {
  const dto = plainToInstance(HoleStatisticsQueryDto, value);
  return { dto, errors: await validate(dto) };
}

void describe('HoleStatisticsQueryDto', () => {
  void it('requires Fish and uses an omitted Base scope for all Bases', async () => {
    const { errors } = await decode({});

    assert.deepEqual(
      errors.map((error) => error.property),
      ['fishId'],
    );

    const allBases = await decode({ fishId: FISH_ID });
    assert.deepEqual(allBases.errors, []);
    assert.deepEqual(allBases.dto.baseIds, []);
  });

  void it('lowercases and deduplicates comma-separated UUID-v4 Base IDs', async () => {
    const { dto, errors } = await decode({
      fishId: FISH_ID,
      baseIds: `${BASE_ID.toUpperCase()},${OTHER_BASE_ID},${BASE_ID}`,
    });

    assert.deepEqual(errors, []);
    assert.equal(dto.fishId, FISH_ID);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
  });

  void it('keeps the transformed list stable across route and global validation pipes', async () => {
    const firstPass = plainToInstance(HoleStatisticsQueryDto, {
      fishId: FISH_ID,
      baseIds: `${BASE_ID},${OTHER_BASE_ID}`,
    });
    const { dto, errors } = await decode(firstPass as unknown as Record<string, unknown>);

    assert.deepEqual(errors, []);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
  });

  void it('rejects malformed, empty-token, repeated-query and oversized Base scopes', async () => {
    const tooManyIds = Array.from(
      { length: 101 },
      (_, index) => `60000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    ).join(',');
    const invalidValues: Record<string, unknown>[] = [
      { fishId: FISH_ID, baseIds: '' },
      { fishId: FISH_ID, baseIds: `${BASE_ID},` },
      { fishId: FISH_ID, baseIds: `${BASE_ID},not-a-uuid` },
      { fishId: FISH_ID, baseIds: [BASE_ID, OTHER_BASE_ID] },
      { fishId: FISH_ID, baseIds: tooManyIds },
      { fishId: 'not-a-uuid', baseIds: BASE_ID },
    ];

    for (const value of invalidValues) {
      const { errors } = await decode(value);
      assert.ok(errors.length > 0, JSON.stringify(value));
    }
  });

  void it('applies the 100 Base limit after deduplication', async () => {
    const { dto, errors } = await decode({
      fishId: FISH_ID,
      baseIds: Array.from({ length: 101 }, () => BASE_ID).join(','),
    });

    assert.deepEqual(errors, []);
    assert.deepEqual(dto.baseIds, [BASE_ID]);
  });
});
