import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendManualWeightGold,
  benchmarkManualWeightGold,
  parseGoldCatalog,
  parseGoldPredictions,
  validateManualWeightGold,
  type ManualWeightGoldDataset,
} from './manual-weight-gold.js';
import { runManualWeightGoldCommand } from './manual-weight-gold-cli.js';

const pair = { fishId: 'fish-1', fishingBaseId: 'base-1', fishName: 'Рыба', baseName: 'База' };
const otherPair = { ...pair, fishingBaseId: 'base-2', baseName: 'Другая база' };
const catalog = [pair, otherPair];

/** Минимальный эталон отделяет подтвержденный вес от текущего каталога и прогнозов. */
function fixture(): ManualWeightGoldDataset {
  return {
    schemaVersion: 1,
    datasetVersion: '2026-10-05.v1',
    entries: [
      {
        ...pair,
        confirmedMaxWeightGrams: 1145,
        confirmedMinWeightGrams: null,
        note: null,
        source: 'MANUAL',
      },
    ],
  };
}

void describe('Versioned MANUAL weight GOLD', () => {
  void it('seeds the nine exact manually confirmed maxima without inventing minima', () => {
    const file = new URL(
      '../../prisma/catalog-data/weight-gold/2026-10-05.v1.json',
      import.meta.url,
    );
    const data = JSON.parse(readFileSync(file, 'utf8')) as ManualWeightGoldDataset;
    assert.equal(data.entries.length, 9);
    assert.deepEqual(
      data.entries.map((e) => e.confirmedMaxWeightGrams),
      [1430000, 154000, 3850, 51700000, 13200, 14300, 2750, 2530000, 19800],
    );
    assert.ok(
      data.entries.every(
        (e) => e.source === 'MANUAL' && e.confirmedMinWeightGrams === null && e.note === null,
      ),
    );
    assert.equal(new Set(data.entries.map((e) => `${e.fishId}/${e.fishingBaseId}`)).size, 9);
  });

  void it('preserves the original nine rows and includes only the 143 resolved manual additions', () => {
    const root = new URL('../../prisma/catalog-data/weight-gold/', import.meta.url);
    const previous = JSON.parse(
      readFileSync(new URL('2026-10-05.v1.json', root), 'utf8'),
    ) as ManualWeightGoldDataset;
    const expanded = JSON.parse(
      readFileSync(new URL('2026-10-05.v2.json', root), 'utf8'),
    ) as ManualWeightGoldDataset;
    const resolution = JSON.parse(
      readFileSync(new URL('2026-10-05.v2.resolution.json', root), 'utf8'),
    ) as {
      inputCount: number;
      acceptedCount: number;
      rejectedCount: number;
      conflictingCount: number;
      accepted: Array<{
        input: { confirmedMaxWeightGrams: number };
        resolved: {
          fishId: string;
          fishingBaseId: string;
          fishName: string;
          baseName: string;
        };
      }>;
      rejected: Array<{ autoAccepted: boolean }>;
    };
    assert.equal(resolution.inputCount, 149);
    assert.equal(resolution.acceptedCount, 143);
    assert.equal(resolution.rejectedCount, 6);
    assert.equal(resolution.conflictingCount, 0);
    assert.equal(expanded.entries.length, 152);
    assert.deepEqual(expanded.entries.slice(0, 9), previous.entries);
    assert.deepEqual(
      expanded.entries.slice(9),
      resolution.accepted.map((r) => ({
        ...r.resolved,
        confirmedMaxWeightGrams: r.input.confirmedMaxWeightGrams,
        confirmedMinWeightGrams: null,
        note: null,
        source: 'MANUAL',
      })),
    );
    assert.equal(new Set(expanded.entries.map((r) => `${r.fishId}/${r.fishingBaseId}`)).size, 152);
    assert.ok(resolution.rejected.every((r) => r.autoAccepted === false));
  });

  void it('rejects unknown memberships, name drift and non-manual sources', () => {
    assert.throws(() => validateManualWeightGold(fixture(), [otherPair]), /does not exist/u);
    const data = fixture();
    data.entries[0].fishName = 'Рыба ёж';
    assert.throws(() => validateManualWeightGold(data, catalog), /names differ/u);
    assert.throws(
      () =>
        validateManualWeightGold(
          { ...fixture(), entries: [{ ...fixture().entries[0], source: 'ADMIN' }] },
          catalog,
        ),
      /MANUAL/u,
    );
  });

  void it('rejects duplicate pairs even if weights or notes differ', () => {
    const data = fixture();
    data.entries.push({ ...data.entries[0], confirmedMaxWeightGrams: 1200, note: 'duplicate' });
    assert.throws(() => validateManualWeightGold(data, catalog), /Duplicate GOLD/u);
    assert.throws(
      () =>
        appendManualWeightGold(
          fixture(),
          { ...pair, confirmedMaxWeightGrams: 1200 },
          '2026-10-05.v2',
          catalog,
        ),
      /Duplicate GOLD/u,
    );
  });

  void it('requires positive safe integer grams and nullable min/note', () => {
    for (const bad of [0, -1, 1.5, '1145', Number.MAX_SAFE_INTEGER + 1, undefined]) {
      assert.throws(
        () =>
          validateManualWeightGold(
            { ...fixture(), entries: [{ ...fixture().entries[0], confirmedMaxWeightGrams: bad }] },
            catalog,
          ),
        /positive safe integer/u,
      );
    }
    for (const min of [-1, 0, 0.5, undefined, 2000]) {
      assert.throws(() =>
        validateManualWeightGold(
          { ...fixture(), entries: [{ ...fixture().entries[0], confirmedMinWeightGrams: min }] },
          catalog,
        ),
      );
    }
    assert.throws(
      () =>
        validateManualWeightGold(
          { ...fixture(), entries: [{ ...fixture().entries[0], note: 123 }] },
          catalog,
        ),
      /note/u,
    );
  });

  void it('appends only a new version with names resolved by IDs, preserving previous data', () => {
    const old = fixture();
    const next = appendManualWeightGold(
      old,
      {
        fishId: pair.fishId,
        fishingBaseId: otherPair.fishingBaseId,
        confirmedMaxWeightGrams: 1300,
        confirmedMinWeightGrams: 30,
      },
      '2026-10-05.v2',
      catalog,
    );
    assert.equal(old.entries.length, 1);
    assert.equal(next.entries.length, 2);
    assert.equal(next.entries[1].baseName, otherPair.baseName);
    assert.equal(next.entries[1].confirmedMinWeightGrams, 30);
    assert.throws(
      () => appendManualWeightGold(old, next.entries[1], old.datasetVersion, catalog),
      /new dataset version/u,
    );
  });

  void it('scores frozen predictions without feeding confirmed values back into them', () => {
    const predictions = parseGoldPredictions({
      rows: [{ ...pair, fusion: { candidate: 1145, rangeGrams: [1144, 1147] } }],
    });
    const frozen = JSON.stringify(predictions);
    const gold = fixture();
    const good = benchmarkManualWeightGold(predictions, gold);
    assert.equal(good.exact, 1);
    gold.entries[0].confirmedMaxWeightGrams = 99999;
    assert.equal(benchmarkManualWeightGold(predictions, gold).exact, 0);
    assert.equal(JSON.stringify(predictions), frozen);
    const absent = benchmarkManualWeightGold([], gold);
    assert.equal(absent.abstentions, 1);
    assert.equal(absent.exactAccuracyIncludingAbstentions, 0);
    assert.equal(absent.precisionAmongPredictions, null);
    assert.equal(absent.missingPredictions, 1);
  });

  void it('keeps range hits separate from exact matches and rejects duplicate predictions', () => {
    const row = { ...pair, predictedMaxWeightGrams: 1144, rangeGrams: [1144, 1147] };
    const result = benchmarkManualWeightGold(parseGoldPredictions({ rows: [row] }), fixture());
    assert.equal(result.exact, 0);
    assert.equal(result.withinRange, 1);
    assert.throws(() => parseGoldPredictions({ rows: [row, row] }), /Duplicate prediction/u);
    assert.deepEqual(parseGoldCatalog({ pairs: [{ ...pair, confirmedMaxWeightGrams: 99999 }] }), [
      pair,
    ]);
  });

  void it('validates before writing and refuses to overwrite an existing version file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manual-weight-gold-'));
    try {
      const old = join(dir, '2026-10-05.v1.json');
      const output = join(dir, '2026-10-05.v2.json');
      const entry = join(dir, 'entry.json');
      const snapshot = join(dir, 'catalog.json');
      writeFileSync(old, JSON.stringify(fixture()));
      writeFileSync(snapshot, JSON.stringify({ pairs: catalog }));
      writeFileSync(entry, JSON.stringify({ ...otherPair, confirmedMaxWeightGrams: 1300 }));
      writeFileSync(output, 'existing version');
      assert.throws(
        () =>
          runManualWeightGoldCommand([
            'append',
            '--gold',
            old,
            '--catalog',
            snapshot,
            '--entry',
            entry,
            '--output',
            output,
          ]),
        /EEXIST/u,
      );
      assert.equal(readFileSync(output, 'utf8'), 'existing version');
      assert.equal(
        (JSON.parse(readFileSync(old, 'utf8')) as ManualWeightGoldDataset).entries.length,
        1,
      );
      assert.throws(() => runManualWeightGoldCommand(['validate', '--unknown', 'x']), /Invalid/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
