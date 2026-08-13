import { describe, expect, test } from 'vitest';
import {
  formatCentimetersAsMeters,
  MAX_DATABASE_INTEGER,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
  parseMetersToCentimeters,
  validateRawSourceText,
} from './catch-report-form';

describe('parseMetersToCentimeters', () => {
  test('converts supported meter notation without floating point', () => {
    expect(parseMetersToCentimeters('6')).toBe(600);
    expect(parseMetersToCentimeters('6,0')).toBe(600);
    expect(parseMetersToCentimeters('6,00')).toBe(600);
    expect(parseMetersToCentimeters('7.63')).toBe(763);
    expect(parseMetersToCentimeters(' 0,01 ')).toBe(1);
  });

  test('converts empty input to null and rejects unsafe notation', () => {
    expect(parseMetersToCentimeters('   ')).toBeNull();
    for (const value of ['0', '-1', '+1', '1e2', '1,2.3', ',50', '1,', '6,000']) {
      expect(() => parseMetersToCentimeters(value)).toThrow();
    }
  });

  test('rejects PostgreSQL integer overflow', () => {
    expect(parseMetersToCentimeters('21474836,47')).toBe(MAX_DATABASE_INTEGER);
    expect(() => parseMetersToCentimeters('21474836,48')).toThrow(
      /\u043f\u0440\u0435\u0432\u044b\u0448\u0430\u0435\u0442/,
    );
  });
});

describe('formatCentimetersAsMeters', () => {
  test('formats integer centimeters without floating point', () => {
    expect(formatCentimetersAsMeters(600)).toBe('6,00');
    expect(formatCentimetersAsMeters(763)).toBe('7,63');
    expect(formatCentimetersAsMeters(1)).toBe('0,01');
  });
});

describe('exact text validation', () => {
  test('counts Unicode code points and preserves meaningful text', () => {
    const maximumEmoji = '😀'.repeat(1_000);
    expect(normalizeUserNoteRaw(maximumEmoji)).toBe(maximumEmoji);
    expect(() => normalizeUserNoteRaw('😀'.repeat(1_001))).toThrow(/1000/);
    expect(normalizeSpotPositionRaw(' уда-леска  ')).toBe(' уда-леска  ');
    expect(() => normalizeSpotPositionRaw('   ')).toThrow(
      /\u043f\u0440\u043e\u0431\u0435\u043b\u043e\u0432/,
    );
  });

  test('allows only TAB, LF and CR controls in the preserved raw source', () => {
    const source = 'строка 1\n\tстрока 2\r\n';
    expect(validateRawSourceText(source)).toBe(source);
    expect(() => validateRawSourceText(`строка\u0000`)).toThrow();
    expect(() => validateRawSourceText(`строка\u200d`)).toThrow();
    expect(() => validateRawSourceText(`строка\ud800`)).toThrow();
  });
});
