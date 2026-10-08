import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  discoverWeightGrids,
  exactWeightName,
  reconcileWeights,
  type ReconciliationInput,
  type WeightPair,
} from './weight-reconciliation.js';
import { parseWeightReconciliationCommand } from './reconcile-all-weights.js';

/** Небольшой срез проверяет доменные решения без подключения к БД. */
function input(pairs: WeightPair[]): ReconciliationInput {
  return {
    capturedAt: '2026-10-04T00:00:00Z',
    head: 'test',
    pairs,
    issues: [],
    official: { pairs, observations: [], snapshots: [] },
    klevalka: {},
    workbook: {},
    historicalCorrections: [],
    sources: [],
    mappingReviews: [],
  };
}

/** Тестовая пара намеренно имеет отдельные стабильные ключи рыбы и базы. */
function pair(fishName = 'Рыба-лягушка', baseName = 'Побережье Камчатки', max = 3520): WeightPair {
  return {
    fishId: fishName,
    fishingBaseId: baseName,
    fishName,
    baseName,
    forumTopicId: null,
    minWeightGrams: 80,
    maxWeightGrams: max,
  };
}

void describe('Read-only full weight reconciliation', () => {
  void it('discovers a data grid without requiring an eleven-based multiplier', () => {
    const grids = discoverWeightGrids(Array.from({ length: 30 }, (_, i) => (20 + i) * 7));
    assert.equal(grids.find((g) => g.magnitude === 2)?.stepGrams, 7);
    assert.equal(exactWeightName(' Рыба  Ёж '), 'рыба ёж');
    assert.notEqual(exactWeightName('Ёж'), exactWeightName('Еж'));
  });

  void it('manual max overrides inference while retaining an explicitly unconfirmed min', () => {
    const report = reconcileWeights(input([pair()]));
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].status, 'SAFE_TO_CORRECT');
    assert.equal(report.rows[0].proposedMaxWeightGrams, 3850);
    assert.equal(report.rows[0].minAssessment.independentlyConfirmed, false);
    assert.equal(report.benchmark.review.exact, 0);
    assert.equal(report.policy.inferenceTrusted, false);
    assert.equal(report.decisions[0].appliedToTxt, false);
    assert.equal(report.decisions[0].appliedToCatalog, false);
    assert.equal(report.decisions[0].appliedToCatches, false);
  });

  void it('never assigns an ambiguous global admin value to several Bases', () => {
    const source = input([pair('Уклейка', 'А', 242), pair('Уклейка', 'Б', 230)]);
    source.issues = [{ fishId: 'Уклейка', expectedWeightGrams: 241, note: null, updatedAt: 'now' }];
    const report = reconcileWeights(source);
    assert.ok(report.rows.every((r) => r.status === 'LIKELY_WRONG_SMALL_WEIGHT'));
    assert.ok(report.rows.every((r) => r.proposedMaxWeightGrams === null));
    assert.ok(report.decisions.every((r) => !r.manuallyConfirmed));
  });

  void it('uses an exact admin Base note but never invents an alias', () => {
    const source = input([pair('Уклейка', 'А', 242), pair('Уклейка', 'Б', 230)]);
    source.issues = [
      { fishId: 'Уклейка', expectedWeightGrams: 241, note: ' а ', updatedAt: 'now' },
    ];
    const report = reconcileWeights(source);
    assert.equal(report.rows.find((r) => r.baseName === 'А')?.proposedMaxWeightGrams, 241);
    assert.equal(report.rows.find((r) => r.baseName === 'Б')?.status, 'INSUFFICIENT');
  });

  void it('conflicting manual evidence and stale old bounds block a correction', () => {
    const source = input([pair()]);
    source.issues = [
      { fishId: 'Рыба-лягушка', expectedWeightGrams: 3900, note: null, updatedAt: 'now' },
    ];
    assert.equal(reconcileWeights(source).rows[0].status, 'CONFLICT');
    assert.equal(reconcileWeights(source).rows[0].proposedMaxWeightGrams, null);
    assert.equal(
      reconcileWeights(input([pair('Рыба-лягушка', 'Побережье Камчатки', 3600)])).rows[0].status,
      'CONFLICT',
    );
  });

  void it('an observation below min flags grams and relative error without inventing the true min', () => {
    const source = input([pair('Малая рыба', 'База', 200)]);
    source.official.observations.push({
      fishId: 'Малая рыба',
      fishingBaseId: 'База',
      weightGrams: 79,
      weekStartsAt: '2026-09-06',
      waterbodyRaw: 'База',
      caughtAt: '2026-09-07',
      copies: 100,
    });
    const report = reconcileWeights(source);
    assert.equal(report.rows[0].status, 'LIKELY_WRONG_SMALL_WEIGHT');
    assert.equal(report.rows[0].minAssessment.maximumShortfallGrams, 1);
    assert.equal(report.rows[0].minAssessment.maximumRelativeShortfall, 1 / 80);
    assert.equal(report.rows[0].proposedMinWeightGrams, 80);
    assert.equal(report.rows[0].minAssessment.proposedChange, false);
    assert.equal(report.smallWeight.minAnomalies, 1);
    assert.equal(report.decisions.length, 1);
  });

  void it('rejects unknown write options and requires a reviewed Klevalka release', () => {
    assert.throws(() => parseWeightReconciliationCommand(['--apply', 'true']));
    assert.throws(() => parseWeightReconciliationCommand(['--klevalka-snapshots', '/tmp/source']));
    assert.throws(() =>
      parseWeightReconciliationCommand(['--output', '/tmp/a', '--output', '/tmp/b']),
    );
  });

  void it('rejects duplicate memberships and fractional gram bounds in a frozen input', () => {
    assert.throws(() => reconcileWeights(input([pair(), pair()])), /Duplicate Fish\/Base/);
    assert.throws(
      () => reconcileWeights(input([{ ...pair(), minWeightGrams: 0.5 }])),
      /Invalid integer/,
    );
  });

  void it('restores historical old bounds before scoring an already corrected benchmark', () => {
    const controls = Array.from({ length: 20 }, (_, i) =>
      pair(`Контроль ${i}`, 'База', 1100 + i * 110),
    );
    const source = input([...controls, pair('Эталон', 'База', 1100)]);
    source.historicalCorrections = [
      {
        fishName: 'Эталон',
        baseName: 'База',
        oldMaxWeightGrams: 1000,
        proposedMaxWeightGrams: 1100,
        reference: 'historical-test',
      },
    ];
    for (const p of source.pairs)
      for (const week of ['2026-09-06', '2026-09-13', '2026-09-20']) {
        for (const weight of p.fishName === 'Эталон' ? [1000, 1100] : [p.maxWeightGrams!]) {
          source.official.observations.push({
            fishId: p.fishId,
            fishingBaseId: p.fishingBaseId,
            weightGrams: weight,
            weekStartsAt: week,
            waterbodyRaw: 'База',
            caughtAt: week,
            copies: 100,
          });
        }
      }
    const report = reconcileWeights(source);
    assert.equal(
      report.rows.find((r) => r.fishName === 'Эталон')?.maxAssessment.inferredCandidateGrams,
      1100,
    );
    assert.equal(report.benchmark.historical.exact, 0);
  });
});
