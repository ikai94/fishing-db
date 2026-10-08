import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendManualWeightGoldBatch,
  validateManualWeightGoldBatch,
} from './manual-weight-gold-batch.js';
import { runManualWeightGoldCommand } from './manual-weight-gold-cli.js';
import type { ManualWeightGoldDataset } from './manual-weight-gold.js';

const header = 'fishName,baseName,confirmedMaxWeightGrams,confirmedMinWeightGrams,note\n';
const oldPair = { fishId: 'old', fishingBaseId: 'base', fishName: 'Старая рыба', baseName: 'База' };
const pair = { fishId: 'new', fishingBaseId: 'base', fishName: 'Рыба ёж', baseName: 'База' };
const other = { fishId: 'other', fishingBaseId: 'base', fishName: 'Другая рыба', baseName: 'База' };
const catalog = [oldPair, pair, other];

/** Предыдущий эталон содержит одну пару, поэтому пакет должен проверять межверсионные дубликаты. */
function gold(): ManualWeightGoldDataset {
  return {
    schemaVersion: 1,
    datasetVersion: '2026-10-05.v1',
    entries: [
      {
        ...oldPair,
        confirmedMaxWeightGrams: 100,
        confirmedMinWeightGrams: null,
        note: null,
        source: 'MANUAL',
      },
    ],
  };
}

void describe('MANUAL GOLD CSV batches', () => {
  void it('resolves stable IDs and preserves quoted commas, quotes, multiline notes, BOM and CRLF', () => {
    const csv =
      '\uFEFF' +
      header.replace('\n', '\r\n') +
      'Рыба ёж,База,120,5,"заметка, ""важно""\r\nпродолжение"\r\n' +
      'Другая рыба,База,150,,\r\n';
    const result = validateManualWeightGoldBatch(csv, gold(), catalog);
    assert.equal(result.valid, true);
    assert.equal(result.accepted, 2);
    assert.equal(result.rejected, 0);
    assert.equal(result.entries[0].fishId, pair.fishId);
    assert.equal(result.entries[0].confirmedMinWeightGrams, 5);
    assert.equal(result.entries[0].note, 'заметка, "важно"\r\nпродолжение');
    assert.equal(result.entries[1].confirmedMinWeightGrams, null);
    assert.equal(result.entries[1].note, null);
    assert.ok(result.entries.every((e) => e.source === 'MANUAL'));
  });

  void it('uses exact names without trimming, case folding or е/ё mapping', () => {
    const result = validateManualWeightGoldBatch(
      header + 'рыба ёж,База,120,,\nРыба еж,База,120,,\nРыба ёж ,База,120,,\nРыба ёж, база,120,,\n',
      gold(),
      catalog,
    );
    assert.equal(result.accepted, 0);
    assert.equal(result.rejected, 4);
    assert.deepEqual(
      result.errors.map((e) => e.row),
      [2, 3, 4, 5],
    );
    assert.ok(result.errors.every((e) => e.message.startsWith('Unknown exact')));
  });

  void it('rejects an ambiguous exact-name pair rather than selecting its first ID', () => {
    const result = validateManualWeightGoldBatch(header + 'Рыба ёж,База,120,,', gold(), [
      ...catalog,
      { ...pair, fishId: 'second-id' },
    ]);
    assert.equal(result.rejected, 1);
    assert.match(result.errors[0].message, /Ambiguous/u);
    assert.equal(result.errors[0].row, 2);
  });

  void it('rejects existing pairs and both occurrences of a duplicate within the batch', () => {
    const result = validateManualWeightGoldBatch(
      header +
        'Старая рыба,База,110,,\nРыба ёж,База,120,,\nРыба ёж,База,125,,\nДругая рыба,База,150,,',
      gold(),
      catalog,
    );
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 3);
    assert.deepEqual(
      result.errors.map((e) => e.row),
      [2, 3, 4],
    );
    assert.match(result.errors[0].message, /already in GOLD/u);
    assert.match(result.errors[1].message, /rows 3, 4/u);
    assert.throws(
      () => appendManualWeightGoldBatch(gold(), result, '2026-10-05.v2', catalog),
      /Batch rejected/u,
    );
  });

  void it('rejects non-integer or unsafe grams and min greater than max', () => {
    for (const max of ['0', '-1', '1.5', '1e3', ' 120', '9007199254740992', '']) {
      const result = validateManualWeightGoldBatch(
        header + `Рыба ёж,База,${max},,`,
        gold(),
        catalog,
      );
      assert.equal(result.rejected, 1, max);
      assert.match(result.errors[0].message, /positive integer grams/u);
    }
    for (const min of ['0', '-1', '0.5', '121']) {
      assert.equal(
        validateManualWeightGoldBatch(header + `Рыба ёж,База,120,${min},`, gold(), catalog)
          .rejected,
        1,
      );
    }
  });

  void it('reports physical start rows and concise CSV syntax/header errors', () => {
    const result = validateManualWeightGoldBatch(
      header + 'Рыба ёж,База,120,,"первая\nвторая"\nНеизвестная,База,100,,',
      gold(),
      catalog,
    );
    assert.equal(result.accepted, 1);
    assert.equal(result.errors[0].row, 4);
    const broken = validateManualWeightGoldBatch(
      header + 'Рыба ёж,База,120,,"незакрыто',
      gold(),
      catalog,
    );
    assert.equal(broken.rejected, 1);
    assert.deepEqual(broken.errors, [{ row: 2, message: 'Unterminated CSV quote' }]);
    assert.equal(
      validateManualWeightGoldBatch(header + 'Рыба ёж,База,120,,"x"oops', gold(), catalog).rejected,
      1,
    );
    assert.equal(
      validateManualWeightGoldBatch(header + 'Рыба ёж,База,120,', gold(), catalog).rejected,
      1,
    );
    assert.equal(validateManualWeightGoldBatch('wrong,header\n', gold(), catalog).valid, false);
    assert.equal(validateManualWeightGoldBatch(header, gold(), catalog).valid, false);
  });

  void it('creates a new dataset only from a completely valid batch', () => {
    const current = gold();
    const result = validateManualWeightGoldBatch(header + 'Рыба ёж,База,120,,', current, catalog);
    const next = appendManualWeightGoldBatch(current, result, '2026-10-05.v2', catalog);
    assert.equal(current.entries.length, 1);
    assert.equal(next.entries.length, 2);
    assert.equal(next.datasetVersion, '2026-10-05.v2');
    assert.throws(
      () => appendManualWeightGoldBatch(current, result, current.datasetVersion, catalog),
      /new dataset version/u,
    );
  });

  void it('dry-run writes nothing; create writes all rows once and never overwrites GOLD', (context) => {
    const dir = mkdtempSync(join(tmpdir(), 'gold-batch-'));
    const log = context.mock.method(console, 'log', () => {});
    try {
      const old = join(dir, '2026-10-05.v1.json'),
        output = join(dir, '2026-10-05.v2.json');
      const csv = join(dir, 'batch.csv'),
        snapshot = join(dir, 'catalog.json');
      writeFileSync(old, JSON.stringify(gold()));
      writeFileSync(snapshot, JSON.stringify({ pairs: catalog }));
      writeFileSync(csv, header + 'Рыба ёж,База,120,,');
      const flags = ['--gold', old, '--catalog', snapshot, '--csv', csv];
      runManualWeightGoldCommand(['validate-batch', ...flags]);
      assert.equal(existsSync(output), false);
      const summary = JSON.parse(log.mock.calls[0].arguments[0] as string) as {
        accepted: number;
        rejected: number;
        written: boolean;
      };
      assert.deepEqual([summary.accepted, summary.rejected, summary.written], [1, 0, false]);
      runManualWeightGoldCommand(['append-batch', ...flags, '--output', output]);
      const saved = readFileSync(output, 'utf8');
      assert.equal((JSON.parse(saved) as ManualWeightGoldDataset).entries.length, 2);
      assert.throws(
        () => runManualWeightGoldCommand(['append-batch', ...flags, '--output', output]),
        /EEXIST/u,
      );
      assert.equal(readFileSync(output, 'utf8'), saved);
      const rejectedOutput = join(dir, '2026-10-05.v3.json');
      writeFileSync(csv, header + 'Рыба ёж,База,120,,\nНеизвестная,База,120,,');
      assert.throws(
        () => runManualWeightGoldCommand(['append-batch', ...flags, '--output', rejectedOutput]),
        /Batch rejected/u,
      );
      assert.equal(existsSync(rejectedOutput), false);
      assert.equal(readFileSync(old, 'utf8'), JSON.stringify(gold()));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
