import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AuthInputValidationError,
  normalizeEmail,
  normalizeNickname,
  validatePassword,
} from './normalization.js';

function hasValidationCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof AuthInputValidationError && error.issue.code === code;
}

void describe('auth normalization', () => {
  void it('normalizes an uppercase .ru email including surrounding whitespace', () => {
    assert.equal(normalizeEmail(' User@Sub.Mail.RU '), 'user@sub.mail.ru');
  });

  void it('rejects domains that do not end exactly in .ru', () => {
    assert.throws(
      () => normalizeEmail('user@example.ru.com'),
      hasValidationCode('EMAIL_DOMAIN_NOT_ALLOWED'),
    );
    assert.throws(
      () => normalizeEmail('user@example.ru.fake.com'),
      hasValidationCode('EMAIL_DOMAIN_NOT_ALLOWED'),
    );
    assert.throws(() => normalizeEmail('user@example.ru.'), hasValidationCode('INVALID_EMAIL'));
  });

  void it('keeps the display nickname and builds an NFKC lowercase uniqueness key', () => {
    assert.deepEqual(normalizeNickname('  ＢigFish  '), {
      nickname: 'ＢigFish',
      nicknameNormalized: 'bigfish',
    });
    assert.equal(normalizeNickname('Ёрш').nicknameNormalized, 'ёрш');
    assert.notEqual(
      normalizeNickname('Ерш').nicknameNormalized,
      normalizeNickname('Ёрш').nicknameNormalized,
    );
  });

  void it('rejects unsupported nickname characters and separator-only values', () => {
    assert.throws(
      () => normalizeNickname('fish‮bait'),
      hasValidationCode('INVALID_NICKNAME_CHARACTERS'),
    );
    assert.throws(() => normalizeNickname('---'), hasValidationCode('INVALID_NICKNAME_CHARACTERS'));
  });

  void it('counts password Unicode code points and never trims it', () => {
    const password = 'correct horse 🐟';
    assert.equal(validatePassword(password), password);
    assert.throws(
      () => validatePassword('short password'),
      hasValidationCode('INVALID_PASSWORD_LENGTH'),
    );
    assert.throws(
      () => validatePassword('valid password!!\n'),
      hasValidationCode('INVALID_PASSWORD_CHARACTERS'),
    );
  });
});
