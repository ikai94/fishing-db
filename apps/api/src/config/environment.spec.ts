import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEnvironment } from './environment.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/fishing_test',
  WEB_ORIGIN: 'http://localhost:3000',
};

void describe('Auth email environment', () => {
  void it('defaults to console with a development-only encryption key outside production', () => {
    const result = validateEnvironment(base);

    assert.equal(result.AUTH_EMAIL_DELIVERY_MODE, 'console');
    assert.equal(typeof result.AUTH_EMAIL_TOKEN_ENCRYPTION_KEY, 'string');
  });

  void it('requires SMTP delivery, sender, URL, and a non-development key in production', () => {
    assert.throws(
      () => validateEnvironment({ ...base, NODE_ENV: 'production' }),
      /AUTH_EMAIL_DELIVERY_MODE must be smtp in production/u,
    );

    const result = validateEnvironment({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://fishing.example.ru',
      AUTH_EMAIL_DELIVERY_MODE: 'smtp',
      AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64url'),
      EMAIL_FROM: 'Fishing Database <no-reply@example.ru>',
      SMTP_URL: 'smtps://user:password@smtp.example.ru:465',
    });

    assert.equal(result.AUTH_EMAIL_DELIVERY_MODE, 'smtp');
    assert.equal(result.SMTP_URL, 'smtps://user:password@smtp.example.ru:465');
  });

  void it('rejects insecure production links and SMTP URL option overrides', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://fishing.example.ru',
      AUTH_EMAIL_DELIVERY_MODE: 'smtp',
      AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64url'),
      EMAIL_FROM: 'no-reply@example.ru',
      SMTP_URL: 'smtp://user:password@smtp.example.ru:587',
    };
    assert.throws(
      () => validateEnvironment({ ...production, WEB_ORIGIN: 'http://fishing.example.ru' }),
      /WEB_ORIGIN must use HTTPS in production/u,
    );
    for (const option of [
      'ignoreTLS=true',
      'tls.rejectUnauthorized=false',
      'logger=true',
      'debug=true',
    ]) {
      assert.throws(
        () => validateEnvironment({ ...production, SMTP_URL: `${production.SMTP_URL}?${option}` }),
        /SMTP_URL must not contain/u,
      );
    }
    assert.throws(
      () => validateEnvironment({ ...production, AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: 'A'.repeat(43) }),
      /must not use the development key/u,
    );
  });

  void it('rejects malformed encryption keys and SMTP URLs', () => {
    assert.throws(
      () => validateEnvironment({ ...base, AUTH_EMAIL_TOKEN_ENCRYPTION_KEY: 'short' }),
      /canonical 32-byte base64url/u,
    );
    assert.throws(
      () =>
        validateEnvironment({
          ...base,
          AUTH_EMAIL_DELIVERY_MODE: 'smtp',
          EMAIL_FROM: 'no-reply@example.ru',
          SMTP_URL: 'https://smtp.example.ru',
        }),
      /SMTP_URL must be a valid SMTP URL/u,
    );
  });
});

void describe('Fish image environment', () => {
  void it('defaults delivery to disabled without requiring storage', () => {
    const result = validateEnvironment(base);

    assert.equal(result.FISH_IMAGE_DELIVERY_MODE, 'disabled');
    assert.equal('FISH_IMAGE_STORAGE_ROOT' in result, false);
  });

  void it('accepts local delivery only with a non-empty storage root', () => {
    const result = validateEnvironment({
      ...base,
      FISH_IMAGE_DELIVERY_MODE: 'local',
      FISH_IMAGE_STORAGE_ROOT: ' /var/lib/fishing-db/fish-images ',
    });

    assert.equal(result.FISH_IMAGE_DELIVERY_MODE, 'local');
    assert.equal(result.FISH_IMAGE_STORAGE_ROOT, '/var/lib/fishing-db/fish-images');
    assert.throws(
      () => validateEnvironment({ ...base, FISH_IMAGE_DELIVERY_MODE: 'local' }),
      /FISH_IMAGE_STORAGE_ROOT must be a non-empty string/u,
    );
  });

  void it('rejects unknown delivery modes', () => {
    assert.throws(
      () => validateEnvironment({ ...base, FISH_IMAGE_DELIVERY_MODE: 'remote' }),
      /FISH_IMAGE_DELIVERY_MODE must be one of/u,
    );
  });
});

void describe('Bait image environment', () => {
  void it('defaults delivery to disabled without requiring storage', () => {
    const result = validateEnvironment(base);

    assert.equal(result.BAIT_IMAGE_DELIVERY_MODE, 'disabled');
    assert.equal('BAIT_IMAGE_STORAGE_ROOT' in result, false);
  });

  void it('accepts local delivery only with a non-empty storage root', () => {
    const result = validateEnvironment({
      ...base,
      BAIT_IMAGE_DELIVERY_MODE: 'local',
      BAIT_IMAGE_STORAGE_ROOT: ' .local/bait-images ',
    });

    assert.equal(result.BAIT_IMAGE_DELIVERY_MODE, 'local');
    assert.equal(result.BAIT_IMAGE_STORAGE_ROOT, '.local/bait-images');
    assert.throws(
      () => validateEnvironment({ ...base, BAIT_IMAGE_DELIVERY_MODE: 'local' }),
      /BAIT_IMAGE_STORAGE_ROOT must be a non-empty string/u,
    );
  });

  void it('rejects unknown delivery modes', () => {
    assert.throws(
      () => validateEnvironment({ ...base, BAIT_IMAGE_DELIVERY_MODE: 'remote' }),
      /BAIT_IMAGE_DELIVERY_MODE must be one of/u,
    );
  });
});
