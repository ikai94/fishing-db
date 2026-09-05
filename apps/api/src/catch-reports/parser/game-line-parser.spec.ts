import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  matchCatalogPrefix,
  parseGameLine,
  sourceAfterComma,
  splitLocationAndBaitFallback,
} from './game-line-parser.js';

void describe('game notebook line parser', () => {
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
