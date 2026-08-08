import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PasswordService } from './password.service.js';

void describe('PasswordService', () => {
  const service = new PasswordService();
  const password = 'correct horse 🐟';

  void it('stores a self-describing salted scrypt hash and verifies it', async () => {
    const firstHash = await service.hashPassword(password);
    const secondHash = await service.hashPassword(password);

    assert.match(firstHash, /^\$scrypt\$v=1\$N=65536,r=8,p=2,dk=64\$/);
    assert.equal(firstHash.includes(password), false);
    assert.notEqual(firstHash, secondHash);
    assert.equal(await service.verifyPassword(password, firstHash), true);
    assert.equal(await service.verifyPassword('incorrect password', firstHash), false);
  });

  void it('strictly rejects malformed or unsafe stored parameters', async () => {
    const validHash = await service.hashPassword(password);
    const oversizedHash = validHash.replace('N=65536', 'N=1048576');

    assert.equal(await service.verifyPassword(password, 'not-a-password-hash'), false);
    assert.equal(await service.verifyPassword(password, oversizedHash), false);
  });

  void it('performs a valid dummy scrypt path for an unknown email', async () => {
    assert.equal(await service.verifyPasswordOrDummy(password), false);
  });
});
