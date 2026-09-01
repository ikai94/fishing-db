import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { validateBaitImageMappingManifest } from './bait-image-mapping.js';

const catalogData = new URL('../../prisma/catalog-data/', import.meta.url);

void describe('Bait image mapping manifest', () => {
  void it('maps every canonical Bait explicitly with the reviewed shared and unused files', () => {
    const catalog = JSON.parse(readFileSync(new URL('baits.json', catalogData), 'utf8')) as {
      baits: Array<{ name: string; type: 'BAIT' | 'LURE' }>;
    };
    const manifest = validateBaitImageMappingManifest(
      JSON.parse(readFileSync(new URL('bait-image-mapping.json', catalogData), 'utf8')) as unknown,
      catalog.baits,
    );

    assert.deepEqual(manifest.counts, {
      baits: 248,
      sourceFiles: 247,
      unusedSourceFiles: 3,
    });
    assert.deepEqual(manifest.unusedSourceFiles, ['krill.png', 'mouse.png', 'none.png']);
    assert.equal(
      manifest.entries.find((entry) => entry.baitName === 'Креветка')?.sourceFile,
      'chilim.png',
    );
    assert.equal(
      manifest.entries.find((entry) => entry.baitName === 'Живец')?.sourceFile,
      'zhivec.png',
    );
    assert.equal(
      manifest.entries.find((entry) => entry.baitName === 'Живец (перехват)')?.sourceFile,
      'zhivec.png',
    );
  });

  void it('rejects missing canonical targets and source-file overlap', () => {
    const canonical = [{ name: 'Живец', type: 'BAIT' as const }];
    assert.throws(
      () =>
        validateBaitImageMappingManifest(
          {
            schemaVersion: 1,
            mode: 'EXPLICIT_BAIT_IMAGE_MAPPING',
            counts: { baits: 0, sourceFiles: 0, unusedSourceFiles: 0 },
            entries: [],
            unusedSourceFiles: [],
          },
          canonical,
        ),
      /exactly one entry per canonical Bait/u,
    );
    assert.throws(
      () =>
        validateBaitImageMappingManifest(
          {
            schemaVersion: 1,
            mode: 'EXPLICIT_BAIT_IMAGE_MAPPING',
            counts: { baits: 1, sourceFiles: 1, unusedSourceFiles: 1 },
            entries: [{ baitName: 'Живец', baitType: 'BAIT', sourceFile: 'zhivec.png' }],
            unusedSourceFiles: ['zhivec.png'],
          },
          canonical,
        ),
      /source-file counts are inconsistent/u,
    );
  });
});
