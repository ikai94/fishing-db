import assert from 'node:assert/strict';
import { validate } from 'class-validator';
import { describe, it } from 'node:test';
import { normalizeUserNoteRaw } from './catch-report-raw-note.js';
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
