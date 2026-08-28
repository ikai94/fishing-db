import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFishReconciliation,
  buildForumFishCorpus,
  readWorksheetFishCells,
  reconcileWorkbookFishCells,
  stableJson,
  type CatalogFishRow,
  type ForumPostIdentity,
} from './fish-catalog-audit.js';

function post(topicId: string, topicTitle: string): ForumPostIdentity {
  return { topicId, topicTitle, subforumId: '70' };
}

function fish(id: string, name: string): CatalogFishRow {
  return {
    id,
    name,
    nameNormalized: name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase(),
    isActive: true,
  };
}

void describe('Fish catalog reconciliation audit', () => {
  void it('builds deterministic topic identities and keeps semantic qualifiers in Fish.name', () => {
    const input = [
      post('33074', 'Кит синий (альбинос)'),
      post('2', 'Монгольский краснопер (Краснопер монгольский)'),
    ];
    const forward = buildForumFishCorpus(input);
    const reverse = buildForumFishCorpus([...input].reverse());

    assert.equal(stableJson(forward), stableJson(reverse));
    assert.deepEqual(
      forward.map((entry) => ({ topicId: entry.topicId, name: entry.canonicalName })),
      [
        { topicId: '2', name: 'Монгольский краснопер' },
        { topicId: '33074', name: 'Кит синий (альбинос)' },
      ],
    );
    assert.equal(forward[0]?.aliases[0]?.name, 'Краснопер монгольский');
    assert.equal(forward[1]?.aliases[0]?.name, 'Кит синий альбинос');
  });

  void it('refuses normalized and е/ё canonical collisions', () => {
    assert.throws(
      () => buildForumFishCorpus([post('1', 'Рыба'), post('2', ' рыба ')]),
      /canonical normalized Fish collisions/u,
    );
    assert.throws(
      () => buildForumFishCorpus([post('1', 'Ерш'), post('2', 'Ёрш')]),
      /е\/ё-folded Fish collisions/u,
    );
  });

  void it('preserves Fish.id for safe renames and makes duplicate-target renames manual', () => {
    const corpus = buildForumFishCorpus([post('32600', 'Клюворыл')]);
    const entries = buildFishReconciliation(
      [fish('canonical-id', 'Клюворыл'), fish('legacy-id', 'Клюварыл')],
      corpus,
    );
    const canonical = entries.find((entry) => entry.currentFishId === 'canonical-id');
    const legacy = entries.find((entry) => entry.currentFishId === 'legacy-id');

    assert.equal(canonical?.decision, 'KEEP');
    assert.equal(canonical?.preservesFishId, true);
    assert.equal(legacy?.decision, 'MANUAL');
    assert.equal(legacy?.currentFishId, 'legacy-id');
    assert.match(legacy?.reason ?? '', /merge\/repoint is not auto-decided/u);
  });

  void it('does not use fuzzy punctuation or Excel abbreviations as Fish names', () => {
    const corpus = buildForumFishCorpus([
      post('1', 'Рыба-лира'),
      post('2', 'Монгольский краснопер (Краснопер монгольский)'),
    ]);
    const rows = reconcileWorkbookFishCells(
      [
        {
          baseName: 'База',
          sourceSheet: 'База',
          sourceCell: 'A1',
          rawName: 'Рыба лира',
        },
        {
          baseName: 'База',
          sourceSheet: 'База',
          sourceCell: 'A2',
          rawName: 'Монгол.Краснопёр',
        },
        {
          baseName: 'База',
          sourceSheet: 'База',
          sourceCell: 'A3',
          rawName: 'Рыба-лира (140)',
        },
      ],
      corpus,
    );

    assert.deepEqual(
      rows.map((row) => row.category),
      ['MANUAL', 'MANUAL', 'CANONICAL_EXACT'],
    );
    assert.equal(rows[2]?.canonicalName, 'Рыба-лира');
  });

  void it('treats self-closing XLSX cells as empty instead of borrowing the next cell value', () => {
    const worksheet = [
      '<worksheet><sheetData><row r="1">',
      '<c r="A1" s="1"/>',
      '<c r="B1" t="s"><v>0</v></c>',
      '<c r="A2" t="s"><v>1</v></c>',
      '</row></sheetData></worksheet>',
    ].join('');
    const rows = readWorksheetFishCells(worksheet, ['not-a-fish-column', 'Карась'], {
      name: 'База',
      sourceSheet: 'Лист',
      fishColumn: 'A',
    });

    assert.deepEqual(rows, [
      {
        baseName: 'База',
        sourceSheet: 'Лист',
        sourceCell: 'A2',
        rawName: 'Карась',
      },
    ]);
  });

  void it('is idempotent for the same reviewed inputs', () => {
    const corpus = buildForumFishCorpus([post('1', 'Рыба')]);
    const current = [fish('fish-id', 'Рыба')];
    const first = stableJson(buildFishReconciliation(current, corpus));
    const second = stableJson(buildFishReconciliation(current, corpus));
    assert.equal(first, second);
  });
});
