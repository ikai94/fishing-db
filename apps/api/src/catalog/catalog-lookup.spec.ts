import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildCatalogLookupIndex,
  normalizeCatalogLookupText,
  resolveCatalogLookup,
} from './catalog-lookup.js';

void describe('catalog lookup normalization', () => {
  void it('normalizes deterministic user variants without changing punctuation', () => {
    assert.equal(normalizeCatalogLookupText('  ВАЛЕ\u0308К\u00a0 \tКРАЙНИЙ  '), 'валек краинии');
    assert.equal(normalizeCatalogLookupText('Pilk-107'), 'pilk-107');
    assert.notEqual(normalizeCatalogLookupText('Pilk-107'), normalizeCatalogLookupText('Pilk 107'));
  });

  void it('resolves empty, unique and colliding lookup buckets explicitly', () => {
    const valyok = { id: 'fish-valyok', name: 'Валёк' };
    const valek = { id: 'fish-valek', name: 'Валек' };
    const index = buildCatalogLookupIndex([valyok, valek, { id: 'fish-carp', name: 'Карп' }]);

    assert.deepEqual(resolveCatalogLookup(index, 'карась'), { status: 'NOT_FOUND' });
    assert.deepEqual(resolveCatalogLookup(index, 'valek'), { status: 'NOT_FOUND' });
    assert.deepEqual(resolveCatalogLookup(index, 'КАРП'), {
      status: 'UNIQUE',
      item: { id: 'fish-carp', name: 'Карп' },
    });
    assert.deepEqual(resolveCatalogLookup(index, 'валек'), {
      status: 'AMBIGUOUS',
      items: [valyok, valek],
    });
    assert.deepEqual(resolveCatalogLookup(index, 'Валёк'), {
      status: 'AMBIGUOUS',
      items: [valyok, valek],
    });
  });
});
