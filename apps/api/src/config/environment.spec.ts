import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEnvironment } from './environment.js';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/fishing_test',
  WEB_ORIGIN: 'http://localhost:3000',
};

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
