import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { KlevalkaCatalogSnapshot, KlevalkaSourceRow } from './klevalka-catch-generator.js';
import {
  KlevalkaProjectionReviewer,
  type KlevalkaGroupedDecision,
} from './klevalka-snapshot-review.js';
import {
  parseKlevalkaSnapshotReviewCommand,
  validateKlevalkaReviewManifest,
} from './review-klevalka-snapshots.js';
import { parseKlevalkaReleaseCommand } from './release-klevalka-catches.js';

const catalog: KlevalkaCatalogSnapshot = {
  schemaVersion: 1,
  fishingBases: [
    {
      id: 'base-1',
      name: 'Амур',
      locations: [{ id: 'location-1', name: 'Протока', number: 1 }],
    },
  ],
  fish: [{ id: 'fish-1', name: 'Сима' }],
  baits: [{ id: 'bait-1', name: 'Живец', type: 'BAIT' }],
  memberships: [
    {
      fishingBaseId: 'base-1',
      fishId: 'fish-1',
      minWeightGrams: 100,
      maxWeightGrams: 100,
    },
  ],
};

function row(
  sourceId: string,
  int: number,
  baitNameRaw = 'Живец',
  sourceWeightGrams = 100,
): KlevalkaSourceRow {
  return {
    sourceFile: 'fish/00000175.html',
    sourceRow: int,
    sourceId,
    fishNameRaw: 'Сима',
    fishingBaseNameRaw: 'Амур',
    locationNameRaw: 'Протока',
    baitNameRaw,
    sourceWeightGramsRaw: String(sourceWeightGrams),
    sourceWeightGrams,
    intRaw: String(int),
    int,
  };
}

void describe('Klevalka frozen snapshot projection review', () => {
  void it('resolves rows, retains maximum INT per tuple and projects without catch files', () => {
    const reviewer = new KlevalkaProjectionReviewer(catalog, 'dataset');
    reviewer.addRows([row('lower', 1), row('higher', 10), row('blocked', 7, 'Неизвестно')]);

    const { projection: result, retainedRows } = reviewer.finishForGeneration();

    assert.equal(result.sourceRows, 3);
    assert.equal(result.resolvedRows, 2);
    assert.equal(result.blockedRows, 1);
    assert.equal(result.excludedRows, 0);
    assert.equal(result.uniqueTuples, 1);
    assert.equal(result.duplicatesRemoved, 1);
    assert.equal(result.projectedGeneratedCount, 10);
    assert.equal(result.projectedOutputFiles, 1);
    assert.equal(
      result.projectedOutputBytes,
      Buffer.byteLength('Сима 100 грамм. Поймана на Амур: Протока, Живец.\n', 'utf8') * 10,
    );
    assert.deepEqual(result.generatedCountDistribution, { '10': 1 });
    assert.equal(result.retainedIntDistribution.minimum, 10);
    assert.equal(result.issues[0]?.code, 'CATALOG_MATCH_UNKNOWN');
    assert.equal(result.issues[0]?.field, 'bait');
    assert.equal(result.issues[0]?.count, 1);
    assert.deepEqual(result.largestContributors.fish, [
      { id: 'fish-1', name: 'Сима', tuples: 1, generatedCount: 10 },
    ]);
    assert.deepEqual(
      retainedRows.map((item) => item.sourceId),
      ['higher'],
    );
  });

  void it('requires an absolute frozen snapshot path', () => {
    assert.throws(
      () => parseKlevalkaSnapshotReviewCommand(['--snapshots', 'relative']),
      /absolute/u,
    );
    assert.deepEqual(parseKlevalkaSnapshotReviewCommand(['--snapshots', '/external/snapshots']), {
      snapshotsPath: '/external/snapshots',
      datasetId: 'klevalka-html-v1',
    });
    assert.deepEqual(
      parseKlevalkaSnapshotReviewCommand([
        '--snapshots',
        '/external/snapshots',
        '--review-manifest',
        '/external/review.json',
      ]),
      {
        snapshotsPath: '/external/snapshots',
        reviewManifestPath: '/external/review.json',
        datasetId: 'klevalka-html-v1',
      },
    );
    assert.throws(
      () =>
        parseKlevalkaSnapshotReviewCommand([
          '--snapshots',
          '/external/snapshots',
          '--review-manifest',
          'relative.json',
        ]),
      /review-manifest.*absolute/u,
    );
  });

  void it('requires explicit external release paths and expected line count', () => {
    assert.deepEqual(
      parseKlevalkaReleaseCommand([
        '--snapshots',
        '/external/snapshots',
        '--output',
        '/external/output',
        '--expected-lines',
        '7105791',
      ]),
      {
        snapshotsPath: '/external/snapshots',
        outputPath: '/external/output',
        reviewManifestPath: '/external/snapshots/review-manifest.json',
        datasetId: 'klevalka-html-v1',
        expectedLines: 7_105_791,
        skipParserValidation: false,
      },
    );
    assert.equal(
      parseKlevalkaReleaseCommand([
        '--snapshots',
        '/external/snapshots',
        '--output',
        '/external/output',
        '--expected-lines',
        '7105791',
        '--skip-parser-validation',
      ]).skipParserValidation,
      true,
    );
    assert.throws(
      () =>
        parseKlevalkaReleaseCommand([
          '--snapshots',
          '/external/snapshots',
          '--output',
          'relative',
          '--expected-lines',
          '7105791',
        ]),
      /output.*absolute/u,
    );
  });

  void it('applies exact Fish mappings and generator-only bounds without catalog membership', () => {
    const catalogWithoutMembership: KlevalkaCatalogSnapshot = {
      ...catalog,
      memberships: [],
    };
    const decisions: KlevalkaGroupedDecision[] = [
      {
        groupId: 'fish-map',
        action: 'MAP_FISH',
        sourceFile: 'fish/00000175.html',
        sourceFishName: 'Сима источник',
        targetFishId: 'fish-1',
        targetFishName: 'Сима',
        expectedRows: 1,
        reason: 'reviewed identity',
        evidence: ['manual review'],
      },
      {
        groupId: 'weight-override',
        action: 'OVERRIDE_WEIGHT_BOUNDS',
        fishingBaseId: 'base-1',
        fishingBaseName: 'Амур',
        fishId: 'fish-1',
        fishName: 'Сима',
        minWeightGrams: 1_000,
        maxWeightGrams: 7_800,
        expectedRows: 1,
        reason: 'generator-only bounds',
        evidence: ['manual review'],
      },
    ];
    const reviewer = new KlevalkaProjectionReviewer(catalogWithoutMembership, 'dataset', decisions);
    reviewer.addRows([{ ...row('mapped', 10), fishNameRaw: 'Сима источник' }]);

    const result = reviewer.finish();

    assert.equal(result.resolvedRows, 1);
    assert.equal(result.blockedRows, 0);
    assert.equal(result.excludedRows, 0);
    assert.equal(result.projectedGeneratedCount, 10);
    assert.equal(result.decisionApplications.length, 2);
    assert.ok(
      result.decisionApplications.every(
        (application) =>
          application.appliedRows === 1 && /^[a-f0-9]{64}$/u.test(application.affectedRowsSha256),
      ),
    );
  });

  void it('derives a conservative generator maximum from all resolved rows before tuple dedup', () => {
    const conservativeCatalog: KlevalkaCatalogSnapshot = {
      ...catalog,
      fishingBases: catalog.fishingBases.map((base) => ({ ...base, name: 'Амазония' })),
      memberships: catalog.memberships.map((membership) => ({
        ...membership,
        maxWeightGrams: 1_000,
      })),
    };
    const reviewer = new KlevalkaProjectionReviewer(conservativeCatalog, 'dataset');
    reviewer.addRows(
      [
        row('low', 1, 'Живец', 80),
        row('middle', 5, 'Живец', 90),
        row('high', 10, 'Живец', 100),
      ].map((item) => ({ ...item, fishingBaseNameRaw: 'Амазония' })),
    );

    const { projection, retainedRows } = reviewer.finishForGeneration();

    assert.equal(projection.uniqueTuples, 1);
    assert.equal(projection.duplicatesRemoved, 2);
    assert.equal(projection.projectedGeneratedCount, 10);
    assert.equal(retainedRows[0]?.sourceId, 'high');
    assert.equal(retainedRows[0]?.maxWeightGrams, 175);
  });

  void it('excludes reviewed groups and fails closed when their row set changes', () => {
    const decision: KlevalkaGroupedDecision = {
      groupId: 'bait-exclusion',
      action: 'EXCLUDE_BAIT',
      sourceBaitName: 'Криль',
      expectedRows: 1,
      reason: 'unsupported source bait',
      evidence: ['manual review'],
    };
    const initial = new KlevalkaProjectionReviewer(catalog, 'dataset', [decision]);
    initial.addRows([row('excluded', 4, 'Криль')]);
    const result = initial.finish();
    assert.equal(result.excludedRows, 1);
    assert.equal(result.resolvedRows, 0);
    assert.equal(result.blockedRows, 0);

    const pinned = new KlevalkaProjectionReviewer(catalog, 'dataset', [
      { ...decision, affectedRowsSha256: '0'.repeat(64) },
    ]);
    pinned.addRows([row('excluded', 4, 'Криль')]);
    assert.throws(() => pinned.finish(), /source rows changed/u);
  });

  void it('validates review manifest structure', () => {
    assert.throws(
      () =>
        validateKlevalkaReviewManifest({
          schemaVersion: 2,
          snapshotManifestSha256: 'a'.repeat(64),
          catalogSha256: 'b'.repeat(64),
          datasetId: 'dataset',
          decisions: [
            {
              groupId: 'bad',
              action: 'EXCLUDE_BAIT',
              sourceBaitName: 'Криль',
              expectedRows: 1,
              reason: 'unsupported',
            },
          ],
          acceptedSourceFailures: [],
        }),
      /evidence/u,
    );
  });
});
