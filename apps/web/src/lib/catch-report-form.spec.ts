import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatCentimetersAsMeters,
  MAX_DATABASE_INTEGER,
  normalizeUserNoteRaw,
  parseMetersToCentimeters,
} from './catch-report-form.ts';

describe('parseMetersToCentimeters', () => {
  test('converts supported meter notation without floating point', () => {
    assert.equal(parseMetersToCentimeters('6'), 600);
    assert.equal(parseMetersToCentimeters('6,0'), 600);
    assert.equal(parseMetersToCentimeters('6,00'), 600);
    assert.equal(parseMetersToCentimeters('7.63'), 763);
    assert.equal(parseMetersToCentimeters(' 0,01 '), 1);
  });

  test('converts an empty input to null', () => {
    assert.equal(parseMetersToCentimeters(''), null);
    assert.equal(parseMetersToCentimeters('   '), null);
  });

  test('rejects zero and excessive precision', () => {
    assert.throws(() => parseMetersToCentimeters('0'), /больше нуля/);
    assert.throws(() => parseMetersToCentimeters('0,00'), /больше нуля/);
    assert.throws(() => parseMetersToCentimeters('6,000'), /не более двух знаков/);
  });

  test('rejects malformed or unsupported notation', () => {
    for (const value of ['-1', '+1', '1e2', '1,2.3', ',50', '1,', 'метр']) {
      assert.throws(() => parseMetersToCentimeters(value));
    }
  });

  test('rejects a PostgreSQL integer overflow', () => {
    assert.equal(parseMetersToCentimeters('21474836,47'), MAX_DATABASE_INTEGER);
    assert.throws(() => parseMetersToCentimeters('21474836,48'), /превышает/);
    assert.throws(() => parseMetersToCentimeters('999999999999999999999999999'));
  });
});

describe('formatCentimetersAsMeters', () => {
  test('formats integer centimeters without floating point', () => {
    assert.equal(formatCentimetersAsMeters(600), '6,00');
    assert.equal(formatCentimetersAsMeters(763), '7,63');
    assert.equal(formatCentimetersAsMeters(605), '6,05');
    assert.equal(formatCentimetersAsMeters(1), '0,01');
  });

  test('rejects invalid centimeter values', () => {
    assert.throws(() => formatCentimetersAsMeters(0));
    assert.throws(() => formatCentimetersAsMeters(1.5));
    assert.throws(() => formatCentimetersAsMeters(MAX_DATABASE_INTEGER + 1));
  });
});

describe('normalizeUserNoteRaw', () => {
  test('counts Unicode code points consistently with the API and PostgreSQL', () => {
    const maximumEmojiNote = '😀'.repeat(1_000);

    assert.equal(normalizeUserNoteRaw(maximumEmojiNote), maximumEmojiNote);
    assert.throws(() => normalizeUserNoteRaw('😀'.repeat(1_001)), /не длиннее 1000/);
    assert.equal(normalizeUserNoteRaw('❤️'.repeat(500)), '❤️'.repeat(500));
    assert.throws(() => normalizeUserNoteRaw('❤️'.repeat(501)), /не длиннее 1000/);
  });
});
