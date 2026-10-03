import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyRecoveryMatch,
  isHistoricalForumKey,
  recoverySourceLine,
  snapshotCommentParser,
  currentParserDifferences,
  recoveredCommentDecision,
  type RecoveryRow,
} from './comment-recovery.js';
import { deriveExternalImportKey } from './identity.js';
import type { StagingCandidate } from './staging.js';
import type { CatalogSnapshot } from './catalog-source.js';

const key = deriveExternalImportKey('123', 1);
const row: RecoveryRow = {
  id: 'report',
  importKey: key,
  contributorKey: 'external-contributor',
  userId: 'admin',
  fishId: 'fish',
  baitId: 'bait',
  locationId: 'location',
  weightGrams: 1000,
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: null,
  spotPositionRaw: null,
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: null,
  rawSourceText: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};
const candidate = {
  ...row,
  status: 'USABLE_COMPLETE',
  resolution: {
    fish: { id: 'fish' },
    bait: { id: 'bait' },
    location: { id: 'location' },
  },
} as unknown as StagingCandidate;

void describe('historical forum comment recovery', () => {
  void it('requires the exact historical namespace and digest', () => {
    assert.equal(isHistoricalForumKey(key), true);
    for (const value of [
      null,
      'external:other:observation:v1:abc',
      `${key}:new`,
      'external:rus-fishsoft:observation:v2:abc',
    ]) {
      assert.equal(isHistoricalForumKey(value), false);
    }
  });

  void it('rejects duplicated identities even when their structured content is identical', () => {
    assert.equal(classifyRecoveryMatch(row, [candidate]).status, 'EXACT');
    assert.equal(classifyRecoveryMatch(row, [candidate, candidate]).status, 'AMBIGUOUS');
    assert.equal(classifyRecoveryMatch(row, []).status, 'MISSING');
    assert.throws(() =>
      classifyRecoveryMatch(row, [{ ...candidate, importKey: deriveExternalImportKey('124', 1) }]),
    );
  });

  void it('holds contributor, reference and historical observation mismatches', () => {
    for (const patch of [
      { contributorKey: 'other' },
      { fishId: 'other' },
      { weightGrams: 999 },
      { holeDepthCm: 600 },
      { spotPositionRaw: 'левее' },
      { fishingNote: 'MIDWATER' },
    ]) {
      assert.equal(classifyRecoveryMatch({ ...row, ...patch }, [candidate]).status, 'MISMATCH');
    }
    assert.equal(
      classifyRecoveryMatch({ ...row, userNoteRaw: 'existing' }, [candidate]).status,
      'EXACT',
    );
  });

  void it('recovers the forum83 tail only on its physical line, before the next candidate', () => {
    const first = 'Налим 1000 грамм. Поймана на Амур: Берег, Мотыль.';
    const body = `${first} ямка 6,00, левее.\nДругой комментарий`;
    const boundary = {
      importKey: key,
      candidateOrdinal: 1,
      startOffset: 0,
      endOffset: first.length,
      sourceTextSha256: '',
    };
    assert.equal(
      recoverySourceLine(body, boundary, [boundary], true).source,
      `${first} ямка 6,00, левее.`,
    );
    assert.equal(recoverySourceLine(body, boundary, [boundary], false).source, first);
    const next = {
      ...boundary,
      candidateOrdinal: 2,
      startOffset: first.length + 1,
      endOffset: body.length,
    };
    assert.equal(recoverySourceLine(body, boundary, [boundary, next], true).source, `${first} `);
  });

  void it('rejects overlapping ranges and more than one game core', () => {
    const body =
      'Налим 1000 грамм. Поймана на Амур: Берег, Мотыль. Налим 1000 грамм. Поймана на Амур: Берег, Мотыль.';
    const boundary = {
      importKey: key,
      candidateOrdinal: 1,
      startOffset: 0,
      endOffset: body.length,
      sourceTextSha256: '',
    };
    assert.equal(
      recoverySourceLine(body, boundary, [boundary], false).reason,
      'MULTIPLE_GAME_CORES',
    );
    assert.equal(
      recoverySourceLine(body, boundary, [boundary, { ...boundary, startOffset: 10 }], false)
        .reason,
      'OVERLAPPING_SOURCE_RANGES',
    );
  });

  void it('uses the current parser verbatim and reports historical depth disagreements', async () => {
    const named = (id: string, name: string) => ({
      id,
      name,
      nameNormalized: name.toLowerCase(),
      isActive: true,
    });
    const catalog: CatalogSnapshot = {
      version: 1,
      fingerprint: '',
      fishingBases: [named('base', 'Амур')],
      fish: [named('fish', 'Налим')],
      locations: [{ ...named('location', 'Берег'), fishingBaseId: 'base', number: 1 }],
      baits: [{ ...named('bait', 'Мотыль'), type: 'BAIT' }],
      memberships: [{ fishingBaseId: 'base', fishId: 'fish' }],
    };
    const source = 'Налим 1000 грамм. Поймана на Амур: Берег, Мотыль. Ямка 6,00 м,  Левее удочки!';
    const { rows } = await snapshotCommentParser(catalog, []).parseBatch(source);
    const draft = rows[0]?.draft;
    assert.ok(draft);
    assert.equal(draft.fields.userNoteRaw.value, 'Ямка 6,00 м,  Левее удочки!');
    assert.ok(currentParserDifferences(row, draft).includes('holeDepthCm'));
    assert.equal(recoveredCommentDecision(row, draft).status, 'CANDIDATE');
    assert.equal(recoveredCommentDecision({ ...row, userNoteRaw: '' }, draft).status, 'PRESERVED');
    assert.equal(
      recoveredCommentDecision({ ...row, userNoteRaw: 'old comment' }, draft).status,
      'PRESERVED',
    );
    assert.equal(
      recoveredCommentDecision({ ...row, fishId: 'other' }, draft).reason,
      'CORE_MISMATCH',
    );
    const withoutPeriod = await snapshotCommentParser(catalog, []).parseBatch(
      source.replace('Мотыль.', 'Мотыль,'),
    );
    assert.equal(withoutPeriod.rows[0]?.draft.fields.userNoteRaw.value, null);
  });
});
