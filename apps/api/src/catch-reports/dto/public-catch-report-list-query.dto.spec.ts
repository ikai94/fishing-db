import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicCatchReportListQueryDto } from './public-catch-report-list-query.dto.js';

const FISH_ID = '40000000-0000-4000-8000-000000000001';
const BASE_ID = '60000000-0000-4000-8000-000000000001';
const OTHER_BASE_ID = '60000000-0000-4000-8000-000000000002';

async function decode(value: Record<string, unknown>): Promise<{
  dto: PublicCatchReportListQueryDto;
  errors: Awaited<ReturnType<typeof validate>>;
}> {
  const dto = plainToInstance(PublicCatchReportListQueryDto, value);
  return { dto, errors: await validate(dto) };
}

void describe('PublicCatchReportListQueryDto', () => {
  void it('keeps omitted filters absent and preserves the inherited default limit', async () => {
    const { dto, errors } = await decode({});

    assert.deepEqual(errors, []);
    assert.equal(dto.limit, 20);
    assert.equal(dto.fishId, undefined);
    assert.equal(dto.baseIds, undefined);
  });

  void it('parses and deduplicates a non-empty comma-separated UUID-v4 Base list', async () => {
    const { dto, errors } = await decode({
      fishId: FISH_ID,
      baseIds: `${BASE_ID.toUpperCase()},${OTHER_BASE_ID},${BASE_ID}`,
    });

    assert.deepEqual(errors, []);
    assert.equal(dto.fishId, FISH_ID);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
  });

  void it('keeps an already-transformed Base list stable across stacked validation pipes', async () => {
    const firstPass = plainToInstance(PublicCatchReportListQueryDto, {
      fishId: FISH_ID,
      baseIds: `${BASE_ID},${OTHER_BASE_ID}`,
    });
    const { dto, errors } = await decode(firstPass as unknown as Record<string, unknown>);

    assert.deepEqual(errors, []);
    assert.deepEqual(dto.baseIds, [BASE_ID, OTHER_BASE_ID]);
  });

  void it('rejects empty, malformed, repeated-query, and oversized Base filters', async () => {
    const tooManyIds = Array.from(
      { length: 101 },
      (_, index) => `60000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    ).join(',');
    const invalidValues: Record<string, unknown>[] = [
      { baseIds: '' },
      { baseIds: `${BASE_ID},not-a-uuid` },
      { baseIds: [BASE_ID, OTHER_BASE_ID] },
      { baseIds: tooManyIds },
      { fishId: 'not-a-uuid' },
    ];

    for (const value of invalidValues) {
      const { errors } = await decode(value);
      assert.ok(errors.length > 0, JSON.stringify(value));
    }
  });
});
