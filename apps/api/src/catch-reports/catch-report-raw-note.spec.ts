import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { describe, it } from 'node:test';
import {
  normalizeRawSourceText,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
  RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN,
  VALID_RAW_SOURCE_TEXT_PATTERN,
  VALID_USER_NOTE_RAW_PATTERN,
} from './catch-report-raw-note.js';
import { CreateCatchReportDto } from './dto/create-catch-report.dto.js';

const LOCATION_ID = '10000000-0000-4000-8000-000000000001';
const FISH_ID = '10000000-0000-4000-8000-000000000002';
const BAIT_ID = '10000000-0000-4000-8000-000000000003';

async function noteErrors(value: unknown) {
  const dto = Object.assign(new CreateCatchReportDto(), {
    locationId: LOCATION_ID,
    fishId: FISH_ID,
    baitId: BAIT_ID,
    weightGrams: 40,
    userNoteRaw: value,
  });

  return (await validate(dto)).filter((error) => error.property === 'userNoteRaw');
}

void describe('CatchReport raw note', () => {
  void it('preserves meaningful text exactly without trimming or normalization', async () => {
    const note = '  ямка 6,00 — удочка  ';

    assert.equal((await noteErrors(note)).length, 0);
    assert.equal(normalizeUserNoteRaw(note), note);
  });

  void it('normalizes undefined, null, and the exact empty string to null', async () => {
    assert.equal(normalizeUserNoteRaw(undefined), null);
    assert.equal(normalizeUserNoteRaw(null), null);
    assert.equal(normalizeUserNoteRaw(''), null);
    assert.equal((await noteErrors(null)).length, 0);
    assert.equal((await noteErrors('')).length, 0);
  });

  void it('rejects whitespace-only nonempty text', async () => {
    assert.equal((await noteErrors('   ')).length, 1);
    assert.equal((await noteErrors('\u00a0\u2003')).length, 1);
  });

  void it('rejects control and invisible format characters', async () => {
    assert.equal((await noteErrors('ямка\n6,00')).length, 1);
    assert.equal((await noteErrors('ямка\u200b6,00')).length, 1);
  });

  void it('accepts at most 1000 characters', async () => {
    assert.equal((await noteErrors('а'.repeat(1_000))).length, 0);
    assert.equal((await noteErrors('а'.repeat(1_001))).length, 1);
    assert.equal((await noteErrors('😀'.repeat(1_000))).length, 0);
    assert.equal((await noteErrors('😀'.repeat(1_001))).length, 1);
    assert.equal((await noteErrors('❤️'.repeat(500))).length, 0);
    assert.equal((await noteErrors('❤️'.repeat(501))).length, 1);
  });
});

void describe('CatchReport position and source text', () => {
  void it('preserves complex position text exactly and normalizes only exact empty to null', () => {
    const value = '  уда-леска надпись нахлыст  ';
    assert.equal(normalizeSpotPositionRaw(value), value);
    assert.equal(normalizeSpotPositionRaw(''), null);
  });

  void it('allows multiline raw source with TAB/LF/CR and rejects other Cc/Cf', () => {
    const accepted = 'Первая строка\r\n\tВторая строка';
    assert.match(accepted, VALID_RAW_SOURCE_TEXT_PATTERN);
    assert.equal(normalizeRawSourceText(accepted), accepted);

    for (const rejected of ['текст\u0000', 'текст\u0008', 'текст\u200B']) {
      assert.doesNotMatch(rejected, VALID_RAW_SOURCE_TEXT_PATTERN);
    }
  });

  void it('rejects unpaired surrogates while preserving valid supplementary characters', () => {
    assert.equal(VALID_USER_NOTE_RAW_PATTERN.test('Трофей 🎣'), true);
    assert.equal(VALID_RAW_SOURCE_TEXT_PATTERN.test('Строка 🎣\r\n'), true);
    assert.equal(VALID_USER_NOTE_RAW_PATTERN.test('Повреждено \ud800'), false);
    assert.equal(VALID_RAW_SOURCE_TEXT_PATTERN.test('Повреждено \udfff'), false);
  });

  void it('enforces the approved 20000-code-point source cap', () => {
    assert.match('😀'.repeat(20_000), RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN);
    assert.doesNotMatch('😀'.repeat(20_001), RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN);
  });
});
