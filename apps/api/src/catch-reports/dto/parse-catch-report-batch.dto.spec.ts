import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ParseCatchReportBatchDto } from './parse-catch-report-batch.dto.js';

async function errors(rawSourceText: string) {
  return validate(plainToInstance(ParseCatchReportBatchDto, { rawSourceText }));
}

void describe('ParseCatchReportBatchDto', () => {
  void it('accepts a batch larger than the single-report 20000 character limit', async () => {
    assert.deepEqual(await errors('a'.repeat(1_000_000)), []);
  });

  void it('rejects a batch beyond the explicit 1000000 character limit', async () => {
    assert.ok((await errors('a'.repeat(1_000_001))).length > 0);
  });
});
