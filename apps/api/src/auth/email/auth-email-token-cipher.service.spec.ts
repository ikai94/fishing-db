import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { describe, it } from 'node:test';
import { AuthEmailTokenCipher } from './auth-email-token-cipher.service.js';

function cipher(): AuthEmailTokenCipher {
  return new AuthEmailTokenCipher({
    getOrThrow: () => Buffer.alloc(32, 7).toString('base64url'),
  } as unknown as ConfigService);
}

void describe('AuthEmailTokenCipher', () => {
  void it('round-trips a token through a randomized authenticated envelope', () => {
    const service = cipher();
    const rawToken = Buffer.alloc(32, 4).toString('base64url');
    const first = service.encrypt(rawToken);
    const second = service.encrypt(rawToken);

    assert.notEqual(first, second);
    assert.equal(first.includes(rawToken), false);
    assert.equal(service.decrypt(first), rawToken);
    assert.equal(service.decrypt(second), rawToken);
  });

  void it('rejects malformed or tampered envelopes', () => {
    const service = cipher();
    const envelope = service.encrypt(Buffer.alloc(32, 5).toString('base64url'));
    const replacement = envelope.endsWith('A') ? 'B' : 'A';

    assert.throws(() => service.decrypt('invalid'), /Invalid auth email token envelope/u);
    assert.throws(
      () => service.decrypt(`${envelope.slice(0, -1)}${replacement}`),
      /Invalid auth email token envelope/u,
    );
  });
});
