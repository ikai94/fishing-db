import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParsedForumCandidate } from '../candidate-types.js';
import {
  forum83CatalogRawOverride,
  isProtectedReviewedBaitRaw,
  isReviewedEmbeddedBaseEquivalent,
  loadForum83ReviewedDecisions,
} from './reviewed-decisions.js';

void describe('forum83 reviewed source decisions', () => {
  void it('applies every approved mapping only to its exact reviewed scope', () => {
    const decisions = loadForum83ReviewedDecisions();
    for (const mapping of decisions.locationMappings) {
      assert.equal(
        forum83CatalogRawOverride(
          candidate({ fishingBaseRaw: mapping.baseName, locationRaw: mapping.raw }),
        ).locationRaw,
        mapping.target,
      );
      assert.equal(
        forum83CatalogRawOverride(
          candidate({ fishingBaseRaw: `${mapping.baseName} other`, locationRaw: mapping.raw }),
        ).locationRaw,
        undefined,
      );
    }
    for (const mapping of decisions.baitMappings) {
      assert.equal(
        forum83CatalogRawOverride(candidate({ baitRaw: mapping.raw })).baitRaw,
        mapping.target,
      );
      assert.equal(isProtectedReviewedBaitRaw(mapping.raw), true);
    }
    for (const mapping of decisions.fishMappings) {
      assert.equal(
        forum83CatalogRawOverride(
          candidate({ fishingBaseRaw: mapping.baseName, fishNameRaw: mapping.raw }),
        ).fishNameRaw,
        mapping.target,
      );
      assert.equal(
        forum83CatalogRawOverride(
          candidate({ fishingBaseRaw: `${mapping.baseName} other`, fishNameRaw: mapping.raw }),
        ).fishNameRaw,
        undefined,
      );
    }
  });

  void it('keeps rejected Bait raw values protected and accepts only Хопер/Хопёр', () => {
    const decisions = loadForum83ReviewedDecisions();
    for (const raw of decisions.rejectedBaitRaw) {
      assert.equal(isProtectedReviewedBaitRaw(raw), true);
      assert.equal(forum83CatalogRawOverride(candidate({ baitRaw: raw })).baitRaw, undefined);
    }
    assert.equal(isReviewedEmbeddedBaseEquivalent('Хопёр', 'Хопер'), true);
    assert.equal(isReviewedEmbeddedBaseEquivalent('Хопёр', 'Хопёр'), false);
    assert.equal(isReviewedEmbeddedBaseEquivalent('Сейшельские острова', 'Хопёр'), false);
  });
});

function candidate(overrides: Partial<ParsedForumCandidate>): ParsedForumCandidate {
  return {
    contributorKey: `external:rus-fishsoft:member:v1:${'a'.repeat(64)}`,
    importKey: `external:rus-fishsoft:forum83:observation:v1:${'b'.repeat(64)}`,
    candidateOrdinal: 1,
    fishNameRaw: 'Сазан',
    weightGrams: 1_000,
    fishingBaseRaw: 'Ахтуба',
    locationRaw: 'Сазаний куст',
    baitRaw: 'Макуха',
    fishingMethod: null,
    holeDepthCm: null,
    spotPositionRaw: null,
    fishingNote: null,
    spinningSize: null,
    spinningSpeed: null,
    userNoteRaw: null,
    issues: [],
    technical: {
      subforumId: '83',
      topicId: '357',
      postId: '510',
      sourceRange: { startOffset: 0, endOffset: 1, startLine: 1, endLine: 1 },
      sourceText: 'x',
      supplementarySourceRanges: [],
    },
    ...overrides,
  };
}
