import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKlevalkaCatchImportCommand } from './import-klevalka-catches.js';

void describe('Klevalka catch import CLI', () => {
  void it('requires one absolute release path and target UUID', () => {
    assert.deepEqual(
      parseKlevalkaCatchImportCommand([
        '--release',
        '/tmp/klevalka-generated-catches-v3',
        '--user-id',
        '00000000-0000-4000-8000-000000000001',
      ]),
      {
        releasePath: '/tmp/klevalka-generated-catches-v3',
        targetUserId: '00000000-0000-4000-8000-000000000001',
      },
    );
    assert.throws(() => parseKlevalkaCatchImportCommand(['--release', 'relative']));
    assert.throws(() => parseKlevalkaCatchImportCommand(['--unknown', 'value']));
  });
});
