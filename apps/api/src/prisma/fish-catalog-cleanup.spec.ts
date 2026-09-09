import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  buildFishCatalogCleanupPlan,
  validateFishCatalogCleanupManifest,
} from './fish-catalog-cleanup.js';

void describe('Fish catalog cleanup', () => {
  void it('deletes only zero-report Fish and reports historical blockers', () => {
    const manifest = validateFishCatalogCleanupManifest({
      schemaVersion: 1,
      mode: 'DELETE_FISH_WITHOUT_CATCH_REPORTS',
      fish: ['Банка', 'Красное бревно'],
    });
    const plan = buildFishCatalogCleanupPlan({
      manifest,
      manifestSha256: 'a'.repeat(64),
      liveRows: [
        { id: '1', name: 'Банка', catchReports: 0, baseFishLinks: 1 },
        { id: '2', name: 'Красное бревно', catchReports: 34, baseFishLinks: 1 },
      ],
    });

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.counts, {
      requested: 2,
      deleteFish: 1,
      deleteBaseFishLinks: 1,
      blockedFish: 1,
      blockedCatchReports: 34,
      alreadyAbsent: 0,
    });
    assert.deepEqual(
      plan.entries.map(({ name, outcome }) => [name, outcome]),
      [
        ['Банка', 'DELETE'],
        ['Красное бревно', 'BLOCKED_CATCH_REPORTS'],
      ],
    );
  });

  void it('keeps the checked-in target set exact and deterministic', () => {
    const manifest = validateFishCatalogCleanupManifest(
      JSON.parse(
        readFileSync(
          new URL('../../prisma/catalog-data/fish-catalog-cleanup-20260909.json', import.meta.url),
          'utf8',
        ),
      ) as unknown,
    );
    assert.equal(manifest.fish.length, 15);
    assert.equal(manifest.fish.includes('Красное бревно'), false);
    assert.equal(manifest.fish.includes('Серое бревно'), false);
  });
});
