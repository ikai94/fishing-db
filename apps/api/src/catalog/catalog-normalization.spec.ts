import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatalogNameValidationError, normalizeCatalogName } from './catalog-normalization.js';

void describe('normalizeCatalogName', () => {
  void it('trims outer whitespace and preserves display capitalization', () => {
    assert.deepEqual(normalizeCatalogName('  Озера Танзании  '), {
      name: 'Озера Танзании',
      nameNormalized: 'озера танзании',
    });
  });

  void it('uses NFKC and lowercase for the normalized key', () => {
    assert.deepEqual(normalizeCatalogName('ＡＢＣ'), {
      name: 'ＡＢＣ',
      nameNormalized: 'abc',
    });
  });

  void it('collapses repeated Unicode whitespace only in the normalized key', () => {
    assert.deepEqual(normalizeCatalogName('Озера\u00a0 \tТанзании'.replace('\t', ' ')), {
      name: 'Озера\u00a0  Танзании',
      nameNormalized: 'озера танзании',
    });
  });

  void it('does not merge е and ё', () => {
    assert.notEqual(
      normalizeCatalogName('Ерш').nameNormalized,
      normalizeCatalogName('Ёрш').nameNormalized,
    );
  });

  void it('preserves meaningful punctuation', () => {
    assert.equal(
      normalizeCatalogName('Протока бешеная — створы').nameNormalized,
      'протока бешеная — створы',
    );
    assert.notEqual(
      normalizeCatalogName('Озеро-1').nameNormalized,
      normalizeCatalogName('Озеро 1').nameNormalized,
    );
  });

  void it('rejects control and invisible format characters', () => {
    assert.throws(() => normalizeCatalogName('Амур\n'), CatalogNameValidationError);
    assert.throws(() => normalizeCatalogName('А\u200bмур'), CatalogNameValidationError);
  });

  void it('enforces the 1..128 code point limit', () => {
    assert.equal(normalizeCatalogName('я'.repeat(128)).name.length, 128);
    assert.throws(() => normalizeCatalogName('я'.repeat(129)), CatalogNameValidationError);
    assert.throws(() => normalizeCatalogName('   '), CatalogNameValidationError);
  });

  void it('requires at least one Unicode letter or digit', () => {
    assert.throws(() => normalizeCatalogName('— ... —'), CatalogNameValidationError);
  });
});
