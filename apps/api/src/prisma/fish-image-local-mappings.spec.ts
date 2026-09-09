import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  validateFishImageMetadataManifest,
} from './fish-image-metadata.js';
import {
  validateFishImageLocalMappingManifest,
  validateFishImageLocalMappingsAgainstMetadata,
} from './fish-image-local-mappings.js';
import type { ForumFishIdentity } from './fish-catalog-audit.js';

void describe('approved local Fish image mappings', () => {
  void it('pins the eight approved source files to missing canonical Fish', () => {
    const catalogData = new URL('../../prisma/catalog-data/', import.meta.url);
    const forum = JSON.parse(readFileSync(new URL('forum69-fish.json', catalogData), 'utf8')) as {
      fish: ForumFishIdentity[];
    };
    const metadata = validateFishImageMetadataManifest(
      JSON.parse(readFileSync(new URL('fish-image-metadata.json', catalogData), 'utf8')) as unknown,
      forum.fish,
    );
    const manifest = validateFishImageLocalMappingManifest(
      JSON.parse(
        readFileSync(
          new URL('fish-image-local-mappings-20260909.json', catalogData),
          'utf8',
        ),
      ) as unknown,
    );

    validateFishImageLocalMappingsAgainstMetadata(manifest, metadata.entries);
    assert.deepEqual(
      manifest.mappings.map(({ canonicalFish, imageKey }) => [canonicalFish, imageKey]),
      [
        ['Старая покрышка', 1068],
        ['Рваный сапог', 1054],
        ['Карп', 1023],
        ['Мазутный двухголов', 5001],
        ['Бочка', 4002],
        ['Улитка', 2069],
        ['Красное бревно', 4003],
        ['Серое бревно', 4004],
      ],
    );
  });
});
