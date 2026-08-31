import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveExternalContributorKey, deriveExternalImportKey } from '../identity.js';
import {
  deriveForum83ContributorKey,
  deriveForum83ImportKey,
  forum83CandidateIdentity,
  forum83PostIdentity,
  forum83TopicIdentity,
} from './identity.js';

void describe('forum83 source identities', () => {
  void it('reuses the site-wide member contributor namespace', () => {
    assert.equal(deriveForum83ContributorKey('000123'), deriveExternalContributorKey('123'));
  });

  void it('derives a pinned source-specific import key without changing forum69', () => {
    assert.equal(
      deriveForum83ImportKey('000456', 2),
      'external:rus-fishsoft:forum83:observation:v1:49ad600bf7c12629cbd6a61f408c6ec47162f64e92f2de5abeb7a5e73eeb2fd0',
    );
    assert.equal(
      deriveExternalImportKey('000456', 2),
      'external:rus-fishsoft:observation:v1:a2417e7331cf7d8faaeee37fb544e1063c033cb4590a5bc492731a5d9d456284',
    );
    assert.notEqual(deriveForum83ImportKey('456', 2), deriveExternalImportKey('456', 2));
  });

  void it('exposes stable source identities and validates ordinals', () => {
    assert.equal(forum83TopicIdentity('00357'), 'rus-fishsoft:forum83:topic:357');
    assert.equal(forum83PostIdentity('00510'), 'rus-fishsoft:forum83:post:510');
    assert.equal(
      forum83CandidateIdentity('00510', 3),
      'rus-fishsoft:forum83:post-candidate:v1:510:3',
    );
    assert.throws(() => deriveForum83ImportKey('510', 0), RangeError);
  });
});
