import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { FORUM83_REVIEWED_AUDIT_SHA256 } from './reviewed-audit.js';

void describe('forum83 frozen reviewed audit', () => {
  void it('pins the approved COMPLETE-only population and 55 reviewed exclusions', async () => {
    const source = await readFile(
      new URL('../../../prisma/catalog-data/forum83-reviewed-audit.json', import.meta.url),
      'utf8',
    );
    assert.equal(createHash('sha256').update(source).digest('hex'), FORUM83_REVIEWED_AUDIT_SHA256);
    const audit = JSON.parse(source) as {
      decision: string;
      candidatePopulation: {
        complete: number;
        reviewedExcluded: number;
        exclusionCounts: Record<string, number>;
        duplicateImportKeys: number;
      };
    };
    assert.equal(audit.decision, 'APPROVED_COMPLETE_ONLY');
    assert.equal(audit.candidatePopulation.complete, 33_884);
    assert.equal(audit.candidatePopulation.reviewedExcluded, 55);
    assert.deepEqual(audit.candidatePopulation.exclusionCounts, {
      MISSING_BAIT: 10,
      REJECTED_AMBIGUOUS_BAIT: 4,
      OFF_TOPIC_BASE_LOCATION_CONFLICT: 16,
      REJECTED_BASE_FISH: 25,
    });
    assert.equal(audit.candidatePopulation.duplicateImportKeys, 0);
  });
});
