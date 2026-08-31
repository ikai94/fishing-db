import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveForumCandidate } from '../catalog-resolver.js';
import type { CatalogSnapshot } from '../catalog-source.js';
import { FORUM83_IMPORT_KEY_PATTERN } from './constants.js';
import { parseForum83Post } from './parser.js';

const BASE_ID = 'base';
const LOCATION_ID = 'location';
const FISH_ID = 'fish';
const BAIT_ID = 'bait';
const SNAPSHOT: CatalogSnapshot = {
  version: 1,
  fingerprint: 'snapshot',
  fishingBases: [named(BASE_ID, 'Ахтуба')],
  locations: [{ ...named(LOCATION_ID, 'Степной оазис'), fishingBaseId: BASE_ID, number: 1 }],
  fish: [named(FISH_ID, 'Белый амур')],
  baits: [{ ...named(BAIT_ID, 'Помидоры'), type: 'BAIT' }],
  memberships: [{ fishingBaseId: BASE_ID, fishId: FISH_ID }],
};

void describe('forum83 exact catalog validation', () => {
  void it('accepts a forum83 key and exact Base/Location/Fish/Bait/membership graph', () => {
    const [parsed] = parseForum83Post(
      {
        subforumId: '83',
        topicId: '357',
        postId: '510',
        memberId: '42',
        topicTitle: 'Ахтуба',
        bodyText: 'Белый амур 14,557 кг. Поймана на Ахтуба: Степной оазис, Помидоры.',
      },
      {
        baseName: 'Ахтуба',
        locationNames: ['Степной оазис'],
        fishNames: ['Белый амур'],
        baitNames: ['Помидоры'],
      },
    );
    assert.ok(parsed);
    const resolved = resolveForumCandidate(parsed, SNAPSHOT, {
      importKeyPattern: FORUM83_IMPORT_KEY_PATTERN,
    });
    assert.equal(resolved.status, 'USABLE_COMPLETE');
    assert.equal(resolved.resolution.fishingBaseFish.status, 'RESOLVED');
  });

  void it('does not fuzzy-resolve punctuation changes or missing BaseFish membership', () => {
    const [parsed] = parseForum83Post(
      {
        subforumId: '83',
        topicId: '357',
        postId: '511',
        memberId: '42',
        topicTitle: 'Ахтуба',
        bodyText: 'Белый амур 14,557 кг. Поймана на Ахтуба: Степной-оазис, Помидоры.',
      },
      {
        baseName: 'Ахтуба',
        locationNames: ['Степной оазис'],
        fishNames: ['Белый амур'],
        baitNames: ['Помидоры'],
      },
    );
    assert.ok(parsed);
    const unresolved = resolveForumCandidate(parsed, SNAPSHOT, {
      importKeyPattern: FORUM83_IMPORT_KEY_PATTERN,
    });
    assert.equal(unresolved.status, 'UNRESOLVED');
    assert.equal(unresolved.resolution.location.reason, 'NOT_FOUND');

    const withoutMembership = resolveForumCandidate(
      parsed,
      { ...SNAPSHOT, memberships: [] },
      { importKeyPattern: FORUM83_IMPORT_KEY_PATTERN },
    );
    assert.equal(withoutMembership.status, 'UNRESOLVED');
    assert.equal(withoutMembership.resolution.fishingBaseFish.status, 'MISSING');
  });
});

function named(id: string, name: string) {
  return { id, name, nameNormalized: name.toLowerCase(), isActive: true };
}
