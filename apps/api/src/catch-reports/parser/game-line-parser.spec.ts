import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCatalogLookupIndex } from '../../catalog/catalog-lookup.js';
import {
  matchCatalogPrefix,
  matchFishCatalog,
  parseGameLine,
  sourceAfterComma,
  splitLocationAndBaitFallback,
} from './game-line-parser.js';

void describe('game notebook line parser', () => {
  void it('resolves the longest exact Fish suffix and preserves source offsets and leading prose', () => {
    const raw = '  улов: РУЧЬЕВАЯ\u00a0  ФОРЕЛЬ  1 кг';
    const range = parseGameLine(raw).fishSource;
    assert.ok(range !== null);
    const match = matchFishCatalog(
      raw,
      range,
      buildCatalogLookupIndex([
        { id: 'short', name: 'Форель' },
        { id: 'long', name: 'Ручьевая форель' },
      ]),
    );
    assert.equal(match?.resolution.status, 'UNIQUE');
    assert.equal(match?.resolution.status === 'UNIQUE' ? match.resolution.item.id : null, 'long');
    assert.equal(match?.source.text, 'РУЧЬЕВАЯ\u00a0  ФОРЕЛЬ');
    assert.equal(match?.leadingSource?.text, 'улов:');
    for (const source of [match?.source, match?.leadingSource]) {
      assert.ok(source !== null && source !== undefined);
      assert.equal(raw.slice(source.start, source.end), source.text);
    }
  });

  void it('keeps exact Fish lookup ahead of suffix fallback, including exact ambiguity', () => {
    const raw = 'Ручьевая форель';
    const source = { text: raw, start: 0, end: raw.length };
    for (const duplicate of [false, true]) {
      const match = matchFishCatalog(
        raw,
        source,
        buildCatalogLookupIndex([
          { id: 'long', name: raw },
          { id: 'short', name: 'Форель' },
          ...(duplicate ? [{ id: 'duplicate', name: raw }] : []),
        ]),
      );
      assert.equal(match?.resolution.status, duplicate ? 'AMBIGUOUS' : 'UNIQUE');
      assert.deepEqual(match?.source, source);
      assert.equal(match?.leadingSource, null);
    }
  });

  void it('keeps the longest colliding suffix ambiguous rather than selecting a shorter Fish', () => {
    const raw = 'улов Ручьевая форель';
    const match = matchFishCatalog(
      raw,
      { text: raw, start: 0, end: raw.length },
      buildCatalogLookupIndex([
        { id: 'long', name: 'Ручьевая форель' },
        { id: 'collision', name: 'Ручьевая форель' },
        { id: 'short', name: 'Форель' },
      ]),
    );
    assert.equal(match?.resolution.status, 'AMBIGUOUS');
    assert.equal(match?.source.text, 'Ручьевая форель');
  });

  void it('does not select a shorter Fish when repeated whitespace lengthens the canonical suffix', () => {
    const raw = `улов Ручьевая${' '.repeat(130)}форель`;
    const match = matchFishCatalog(
      raw,
      { text: raw, start: 0, end: raw.length },
      buildCatalogLookupIndex([
        { id: 'long', name: 'Ручьевая форель' },
        { id: 'short', name: 'Форель' },
      ]),
    );
    assert.equal(match?.resolution.status === 'UNIQUE' ? match.resolution.item.id : null, 'long');
    assert.equal(match?.source.text, raw.slice('улов '.length));
  });

  void it('rejects trailing text, partial Fish names and suffixes without a safe left boundary', () => {
    const index = buildCatalogLookupIndex([{ id: 'fish', name: 'Ручьевая форель' }]);
    for (const raw of [
      'улов Ручьевая форель потом',
      'улов Ручьевая форелька',
      'улов Ручьевая форел',
      'улов форель',
      'уловРучьевая форель',
      'улов1Ручьевая форель',
      'улов_Ручьевая форель',
      'улов-Ручьевая форель',
      'улов\u0301Ручьевая форель',
      'улов Ручьевая форель.',
    ]) {
      assert.equal(
        matchFishCatalog(raw, { text: raw, start: 0, end: raw.length }, index),
        null,
        raw,
      );
    }
  });

  void it('extracts the generated core while preserving exact source offsets', () => {
    const raw =
      '  Шамбардия Валберга 40 грамм. Поймана на Озера Танзании: Берег слоновьего бивня, Мотыль. ямка 6,00 удочка  ';
    const result = parseGameLine(raw);

    assert.equal(result.hasGameCore, true);
    assert.equal(result.fishSource?.text, 'Шамбардия Валберга');
    assert.equal(result.weight?.value, 40);
    assert.equal(result.fishingBaseSource?.text, 'Озера Танзании');
    assert.equal(
      result.locationAndBaitSource?.text,
      'Берег слоновьего бивня, Мотыль. ямка 6,00 удочка',
    );
    assert.deepEqual(result.unresolvedFragments, []);

    for (const source of [
      result.fishSource,
      result.weight?.source,
      result.fishingBaseSource,
      result.locationAndBaitSource,
    ]) {
      assert.ok(source !== null && source !== undefined);
      assert.equal(raw.slice(source.start, source.end), source.text);
    }
  });

  void it('preserves meaningful text between weight and the generated catch clause', () => {
    const raw = 'Кижуч 7,242 кг. СКРЫТЫЙ ФРАГМЕНТ Поймана на Амур: Протока, Vib-rapan.';
    const result = parseGameLine(raw);

    assert.equal(result.hasGameCore, true);
    assert.deepEqual(
      result.unresolvedFragments.map((fragment) => fragment.text),
      ['. СКРЫТЫЙ ФРАГМЕНТ'],
    );
    const fragment = result.unresolvedFragments[0];
    assert.ok(fragment);
    assert.equal(raw.slice(fragment.start, fragment.end), fragment.text);

    const symbolRaw = 'Кижуч 7,242 кг. 🎣 Поймана на Амур: Протока, Vib-rapan.';
    assert.deepEqual(
      parseGameLine(symbolRaw).unresolvedFragments.map((item) => item.text),
      ['. 🎣'],
    );
  });

  void it('leaves a suffix-only note available to the observation parser', () => {
    const raw = 'ямка 7,63 вполводы';
    const result = parseGameLine(raw);

    assert.equal(result.hasGameCore, false);
    assert.equal(result.weight, null);
    assert.deepEqual(result.observationSource, { text: raw, start: 0, end: raw.length });
  });

  void it('does not salvage a valid-looking weight from an unsafe representation', () => {
    for (const raw of [
      'Кижуч -7,242 кг. Поймана на Амур: Локация, Приманка.',
      'Кижуч 7,2420 кг. Поймана на Амур: Локация, Приманка.',
    ]) {
      assert.equal(parseGameLine(raw).weight, null, raw);
    }
  });

  void it('matches exact normalized catalog prefixes with safe boundaries only', () => {
    const raw = 'Протока   бешеная - створы, Pilk-107.ср\\м';
    const whole = { text: raw, start: 0, end: raw.length };
    const location = matchCatalogPrefix(
      raw,
      whole,
      [{ id: 'location', name: 'Протока бешеная - створы' }],
      'COMMA',
    );

    assert.equal(location?.resolution.status, 'UNIQUE');
    assert.equal(
      location?.resolution.status === 'UNIQUE' ? location.resolution.item.id : null,
      'location',
    );
    assert.equal(location?.source.text, 'Протока   бешеная - створы');

    assert.ok(location !== null);
    const baitRange = sourceAfterComma(raw, location.source);
    const bait = matchCatalogPrefix(raw, baitRange, [{ id: 'bait', name: 'Pilk-107' }], 'SUFFIX');

    assert.equal(bait?.source.text, 'Pilk-107');
  });

  void it('does not fuzzy-match a catalog name or accept an unsafe name prefix', () => {
    const typo = 'Амурская Щукка, Мотыль';
    const prefix = 'Pilk-107. ср';

    assert.equal(
      matchCatalogPrefix(
        typo,
        { text: typo, start: 0, end: typo.length },
        [{ id: 'pike', name: 'Амурская Щука' }],
        'COMMA',
      ),
      null,
    );
    assert.equal(
      matchCatalogPrefix(
        prefix,
        { text: prefix, start: 0, end: prefix.length },
        [{ id: 'pilk', name: 'Pilk' }],
        'SUFFIX',
      ),
      null,
    );
  });

  void it('returns an ambiguous longest prefix without falling back to a shorter match', () => {
    const raw = 'Темные, воды, Мотыль';
    const match = matchCatalogPrefix(
      raw,
      { text: raw, start: 0, end: raw.length },
      [
        { id: 'shorter', name: 'Темные' },
        { id: 'with-yo', name: 'Тёмные, воды' },
        { id: 'without-yo', name: 'Темные, воды' },
      ],
      'COMMA',
    );

    assert.equal(match?.source.text, 'Темные, воды');
    assert.equal(match?.resolution.status, 'AMBIGUOUS');
    assert.deepEqual(
      match?.resolution.status === 'AMBIGUOUS' ? match.resolution.items.map((item) => item.id) : [],
      ['with-yo', 'without-yo'],
    );
  });

  void it('provides a conservative delimiter fallback for unresolved locations', () => {
    const raw = 'Неизвестная локация, Неизвестная наживка. ямка 6,00';
    const result = splitLocationAndBaitFallback(raw, { text: raw, start: 0, end: raw.length });

    assert.equal(result.locationSource.text, 'Неизвестная локация');
    assert.equal(result.baitAndSuffixSource?.text, 'Неизвестная наживка. ямка 6,00');
  });
});
