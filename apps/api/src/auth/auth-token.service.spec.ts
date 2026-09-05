import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { EMAIL_VERIFICATION_LIFETIME_MS, PASSWORD_RESET_LIFETIME_MS } from './auth.constants.js';
import { hashAuthToken, isCanonicalAuthToken, AuthTokenService } from './auth-token.service.js';

void describe('AuthTokenService', () => {
  void it('creates canonical 256-bit verification and reset tokens with purpose-specific expiry', () => {
    const service = new AuthTokenService();
    const now = new Date('2026-09-04T12:00:00.000Z');
    const verification = service.prepareToken('EMAIL_VERIFICATION', now);
    const reset = service.prepareToken('PASSWORD_RESET', now);

    for (const token of [verification, reset]) {
      assert.equal(token.rawToken.length, 43);
      assert.equal(isCanonicalAuthToken(token.rawToken), true);
      assert.equal(Buffer.from(token.rawToken, 'base64url').length, 32);
      assert.equal(token.tokenHash, hashAuthToken(token.rawToken));
      assert.equal(
        token.tokenHash,
        createHash('sha256').update(token.rawToken, 'utf8').digest('hex'),
      );
      assert.notEqual(token.tokenHash, token.rawToken);
    }
    assert.equal(verification.expiresAt.getTime() - now.getTime(), EMAIL_VERIFICATION_LIFETIME_MS);
    assert.equal(reset.expiresAt.getTime() - now.getTime(), PASSWORD_RESET_LIFETIME_MS);
  });

  void it('rejects malformed and non-canonical values', () => {
    assert.equal(isCanonicalAuthToken(''), false);
    assert.equal(isCanonicalAuthToken('!'.repeat(43)), false);
    assert.equal(isCanonicalAuthToken(`${Buffer.alloc(32).toString('base64url')}=`), false);
  });
});
