import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catalogLookupTokens,
  rankCatalogSearchCandidates,
  type CatalogSearchCandidate,
} from './catalog-global-search.js';

const candidates: CatalogSearchCandidate[] = [
  { kind: 'FISH', id: 'fish-black', name: 'Чёрный амур' },
  { kind: 'FISH', id: 'fish-grass', name: 'Белый амур' },
  { kind: 'FISHING_BASE', id: 'base-amur', name: 'Амур' },
  { kind: 'BAIT', id: 'bait-amur', name: 'Амурский червь', baitType: 'BAIT' },
  {
    kind: 'LOCATION',
    id: 'location-amur',
    name: 'Чёрный берег Амура',
    number: 4,
    fishingBase: { id: 'base-river', name: 'Большая река' },
  },
];

void describe('global catalog search ranking', () => {
  void it('uses the accepted lookup normalization and punctuation token boundaries', () => {
    assert.deepEqual(catalogLookupTokens(' ВАЛЕ\u0308К\u00a0— КРАЙНИЙ '), ['валек', 'краинии']);
  });

  void it('requires every query token and ranks exact, phrase-prefix, token-prefix and substring matches', () => {
    assert.deepEqual(
      rankCatalogSearchCandidates(candidates, 'АМУР').map((item) => item.id),
      ['base-amur', 'bait-amur', 'location-amur', 'fish-grass', 'fish-black'],
    );
    assert.deepEqual(
      rankCatalogSearchCandidates(candidates, 'амур чер').map((item) => item.id),
      ['location-amur', 'fish-black', 'bait-amur'],
    );
    assert.deepEqual(
      rankCatalogSearchCandidates(candidates, 'бел амур').map((item) => item.id),
      ['fish-grass'],
    );
  });

  void it('keeps collisions and has deterministic kind, normalized-name and id tie breakers', () => {
    const collisions: CatalogSearchCandidate[] = [
      { kind: 'FISH', id: 'fish-b', name: 'Валёк' },
      { kind: 'FISH', id: 'fish-a', name: 'Валек' },
      { kind: 'FISHING_BASE', id: 'base', name: 'Валек' },
    ];

    assert.deepEqual(
      rankCatalogSearchCandidates(collisions, 'валек').map((item) => item.id),
      ['base', 'fish-a', 'fish-b'],
    );
    assert.deepEqual(rankCatalogSearchCandidates(candidates, 'омур'), []);
    assert.deepEqual(rankCatalogSearchCandidates(candidates, ' — '), []);
  });
});
