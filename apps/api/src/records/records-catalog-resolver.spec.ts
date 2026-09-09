import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getOfficialFishMapping, resolveOfficialRecordRows } from './records-catalog-resolver.js';

const source = {
  fishName: 'Рыба',
  fishPath: '/fish.html',
  imageKey: 7,
  weightGrams: 900,
  waterbody: 'База',
  playerName: 'Игрок',
  caughtAt: new Date('2026-09-09T10:00:00Z'),
  caughtAtRaw: '09.09.2026 13:00',
};
const fish = [
  { id: 'fish-1', nameNormalized: 'рыба', forumTopicId: 'topic-1', officialFishImageKey: 7 },
];
const mapping = (imageEntries: Array<[number, string]> = [[7, 'topic-1']]) => ({
  byImageKey: new Map(imageEntries),
  byNameNormalized: new Map([['рыба', 'topic-1']]),
});

void describe('official record catalog resolution', () => {
  void it('includes reviewed local mappings for official record-only item paths', async () => {
    const mapping = await getOfficialFishMapping();
    assert.equal(mapping.byImageKey.get(4002), '22706');
    assert.equal(mapping.byNameNormalized.get('клад пиратский'), '202');
  });

  void it('requires agreeing stable identity and resolves Base exactly', () => {
    const rows = resolveOfficialRecordRows(
      [source],
      fish,
      [{ id: 'base-1', nameNormalized: 'база' }],
      mapping(),
    );
    assert.equal(rows[0]?.fishId, 'fish-1');
    assert.equal(rows[0]?.fishingBaseId, 'base-1');
  });

  void it('skips a known official species absent from the local catalog', () => {
    assert.deepEqual(resolveOfficialRecordRows([source], [], [], mapping()), []);
  });

  void it('rejects unknown and conflicting identities', () => {
    assert.throws(
      () =>
        resolveOfficialRecordRows([source], fish, [], {
          byImageKey: new Map(),
          byNameNormalized: new Map(),
        }),
      /Unknown official/u,
    );
    assert.throws(
      () =>
        resolveOfficialRecordRows(
          [source],
          [{ ...fish[0], officialFishImageKey: 8 }],
          [],
          mapping(),
        ),
      /image key disagrees/u,
    );
  });
});
