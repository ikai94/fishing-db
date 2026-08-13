import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from '../catch-reports.constants.js';
import { parseObservation } from './observation-parser.js';

const ANCHORS = [
  { name: 'Удочка', nameNormalized: 'удочка' },
  { name: 'Леска', nameNormalized: 'леска' },
  { name: 'Блокнот', nameNormalized: 'блокнот' },
  { name: 'Чат', nameNormalized: 'чат' },
] as const;

function source(raw: string) {
  return { text: raw, start: 0, end: raw.length };
}

void describe('observation parser', () => {
  void it('parses bait holes, positions, and fishing notes independently', () => {
    const first = parseObservation(
      'ямка 6,00 удочка',
      source('ямка 6,00 удочка'),
      'BAIT_FISHING',
      ANCHORS,
    );
    const secondRaw = 'ямка 7,63 вполводы';
    const second = parseObservation(secondRaw, source(secondRaw), 'BAIT_FISHING', ANCHORS);
    const thirdRaw = 'ямка 5,55 блокнот вполводы';
    const third = parseObservation(thirdRaw, source(thirdRaw), 'BAIT_FISHING', ANCHORS);

    assert.equal(first.holeDepthCm?.value, 600);
    assert.equal(first.spotPositionRaw?.value, 'удочка');
    assert.equal(first.fishingNote, null);
    assert.deepEqual(first.unresolvedFragments, []);
    assert.equal(second.holeDepthCm?.value, 763);
    assert.equal(second.fishingNote?.value, 'MIDWATER');
    assert.equal(second.spotPositionRaw, null);
    assert.equal(third.holeDepthCm?.value, 555);
    assert.equal(third.spotPositionRaw?.value, 'блокнот');
    assert.equal(third.fishingNote?.value, 'MIDWATER');
    assert.deepEqual(third.unresolvedFragments, []);
  });

  void it('accepts both explicit hole prefixes without leaving source behind', () => {
    for (const prefix of ['яма', 'ямка']) {
      const raw = `${prefix} 6,00 удочка`;
      const result = parseObservation(raw, source(raw), 'BAIT_FISHING', ANCHORS);

      assert.equal(result.holeDepthCm?.value, 600, prefix);
      assert.deepEqual(result.unresolvedFragments, [], prefix);
    }
  });

  void it('supports all size/speed combinations with slash and backslash', () => {
    const sizes: Array<readonly [string, CatchReportSpinningSize]> = [
      ['м', 'SMALL'],
      ['ср', 'MEDIUM'],
      ['б', 'LARGE'],
    ];
    const speeds: Array<readonly [string, CatchReportSpinningSpeed]> = [
      ['м', 'SLOW'],
      ['ср', 'MEDIUM'],
      ['б', 'FAST'],
    ];

    for (const separator of ['/', '\\']) {
      for (const [sizeAlias, expectedSize] of sizes) {
        for (const [speedAlias, expectedSpeed] of speeds) {
          const raw = `${sizeAlias}${separator}${speedAlias}`;
          const result = parseObservation(raw, source(raw), 'SPINNING', ANCHORS);
          assert.equal(result.spinningSize?.value, expectedSize, raw);
          assert.equal(result.spinningSpeed?.value, expectedSpeed, raw);
          assert.deepEqual(result.unresolvedFragments, [], raw);
        }
      }
    }
  });

  void it('supports approved textual spinning aliases', () => {
    for (const raw of ['ср. медл', 'ср., проводка медленная', 'средняя, проводка медленная']) {
      const result = parseObservation(raw, source(raw), 'SPINNING', ANCHORS);
      assert.equal(result.spinningSize?.value, 'MEDIUM', raw);
      assert.equal(result.spinningSpeed?.value, 'SLOW', raw);
    }
  });

  void it('does not interpret one-letter spinning tokens outside resolved LURE context', () => {
    const raw = 'ср/м';
    const result = parseObservation(raw, source(raw), null, ANCHORS);

    assert.equal(result.spinningSize, null);
    assert.equal(result.spinningSpeed, null);
    assert.deepEqual(
      result.unresolvedFragments.map((fragment) => fragment.text),
      ['ср/м'],
    );
  });

  void it('accepts a spinning hole and exact position after compact parameters', () => {
    const raw = 'ср\\м 10.78 чат';
    const result = parseObservation(raw, source(raw), 'SPINNING', ANCHORS);

    assert.equal(result.spinningSize?.value, 'MEDIUM');
    assert.equal(result.spinningSpeed?.value, 'SLOW');
    assert.equal(result.holeDepthCm?.value, 1_078);
    assert.equal(result.spotPositionRaw?.value, 'чат');
    assert.deepEqual(result.unresolvedFragments, []);
  });

  void it('preserves a complex alias-led position exactly', () => {
    const raw = '3.61 уда-леска надпись нахлыст.';
    const result = parseObservation(raw, source(raw), 'BAIT_FISHING', ANCHORS);

    assert.equal(result.holeDepthCm?.value, 361);
    assert.equal(result.spotPositionRaw?.value, 'уда-леска надпись нахлыст');
    assert.deepEqual(result.unresolvedFragments, []);
  });

  void it('keeps unknown suffix text unresolved instead of fabricating a comment', () => {
    const raw = '14.68 блокнот.игродень.';
    const result = parseObservation(raw, source(raw), 'BAIT_FISHING', ANCHORS);

    assert.equal(result.holeDepthCm?.value, 1_468);
    assert.equal(result.spotPositionRaw?.value, 'блокнот');
    assert.equal(result.userNoteRaw, null);
    assert.deepEqual(
      result.unresolvedFragments.map((fragment) => fragment.text),
      ['игродень'],
    );
  });

  void it('does not salvage a hole from signs or excess precision', () => {
    for (const raw of ['-6,00 чат', '6,001 чат']) {
      const result = parseObservation(raw, source(raw), 'BAIT_FISHING', ANCHORS);
      assert.equal(result.holeDepthCm, null, raw);
    }
  });

  void it('proposes commentary only across a deterministic line or sentence boundary', () => {
    const withLine =
      'ср., проводка медленная.\nПоймал сразу, первую и зачетную. Наверное, повезло)';
    const sameLine = 'ср., проводка медленная. Поймал сразу, первую и зачетную.';

    assert.equal(
      parseObservation(withLine, source(withLine), 'SPINNING', ANCHORS).userNoteRaw?.value,
      'Поймал сразу, первую и зачетную. Наверное, повезло)',
    );
    assert.equal(
      parseObservation(sameLine, source(sameLine), 'SPINNING', ANCHORS).userNoteRaw?.value,
      'Поймал сразу, первую и зачетную.',
    );
  });

  void it('does not misclassify a BAIT observation on the next line as commentary', () => {
    const raw = '\nямка 6,00 удочка';
    const result = parseObservation(raw, source(raw), 'BAIT_FISHING', ANCHORS);

    assert.equal(result.holeDepthCm?.value, 600);
    assert.equal(result.spotPositionRaw?.value, 'удочка');
    assert.equal(result.userNoteRaw, null);
  });

  void it('preserves JavaScript string offsets for every extracted source', () => {
    const raw = '🎣 ср\\м 10.78 чат';
    const range = { text: raw.slice(3), start: 3, end: raw.length };
    const result = parseObservation(raw, range, 'SPINNING', ANCHORS);

    for (const parsed of [
      result.spinningSize,
      result.spinningSpeed,
      result.holeDepthCm,
      result.spotPositionRaw,
    ]) {
      assert.ok(parsed !== null);
      assert.equal(raw.slice(parsed.source.start, parsed.source.end), parsed.source.text);
    }
  });
});
