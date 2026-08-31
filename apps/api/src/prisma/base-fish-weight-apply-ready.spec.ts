import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseFishWeightApplyReadySha256,
  buildBaseFishWeightApplyReadyManifest,
  classifyBaseFishWeight,
  type BaseFishWeightReviewedDecisions,
} from './base-fish-weight-apply-ready.js';
import {
  buildBaseFishWeightAudit,
  type BaseFishWeightAudit,
  type XlsxAuditCell,
} from './base-fish-weight-audit.js';
import type { ForumFishIdentity, WorkbookFishResolution } from './fish-catalog-audit.js';

function forumFish(topicId: string, canonicalName: string): ForumFishIdentity {
  return {
    sourceIdentity: `rus-fishsoft:forum69:topic:${topicId}`,
    topicId,
    subforumId: '70',
    sourceTitle: canonicalName,
    canonicalName,
    canonicalNameNormalized: canonicalName.toLowerCase(),
    aliases: [],
    mixedScriptTokens: [],
  };
}

function reconciliationRow(
  baseName: string,
  sourceCell: string,
  topicId: string,
  canonicalName: string,
): WorkbookFishResolution {
  return {
    baseName,
    sourceSheet: baseName,
    sourceCell,
    rawName: canonicalName,
    lookupName: canonicalName,
    annotationStripped: false,
    category: 'CANONICAL_EXACT',
    topicId,
    canonicalName,
  };
}

function cell(
  reference: string,
  rawValue: string | null,
  overrides: Partial<XlsxAuditCell> = {},
): XlsxAuditCell {
  return { reference, cellType: 'n', rawValue, formula: null, ...overrides };
}

function fixture(): {
  audit: BaseFishWeightAudit;
  reviewedDecisions: BaseFishWeightReviewedDecisions;
} {
  const sources = {
    workbookFileName: 'test.xlsx',
    workbookSha256: 'workbook',
    reconciliationSha256: 'reconciliation',
    forum69Sha256: 'forum69',
  };
  const audit = buildBaseFishWeightAudit({
    reconciliationRows: [
      reconciliationRow('База A', 'A1', '1', 'Рыба 1'),
      reconciliationRow('База B', 'A1', '2', 'Рыба 2'),
      reconciliationRow('База C', 'A1', '3', 'Рыба 3'),
      reconciliationRow('База D', 'A1', '4', 'Рыба 4'),
      reconciliationRow('База D', 'A2', '4', 'Рыба 4'),
    ],
    forumFish: [
      forumFish('1', 'Рыба 1'),
      forumFish('2', 'Рыба 2'),
      forumFish('3', 'Рыба 3'),
      forumFish('4', 'Рыба 4'),
    ],
    worksheets: new Map([
      [
        'База A',
        new Map([
          ['E1', cell('E1', '10')],
          ['F1', cell('F1', '20')],
        ]),
      ],
      ['База B', new Map([['F1', cell('F1', '50')]])],
      [
        'База C',
        new Map([
          ['E1', cell('E1', '5', { cellType: 's' })],
          ['F1', cell('F1', '100')],
        ]),
      ],
      [
        'База D',
        new Map([
          ['E1', cell('E1', '20')],
          ['F1', cell('F1', '200')],
          ['E2', cell('E2', '20')],
          ['F2', cell('F2', '220')],
        ]),
      ],
    ]),
    sources,
  });
  const reviewedDecisions: BaseFishWeightReviewedDecisions = {
    schemaVersion: 1,
    mode: 'REVIEWED',
    sources,
    policy: {
      missingBoundsAreValidNullableData: true,
      automaticSwapsOrFixes: false,
      conflictsRequireExplicitDecision: true,
    },
    decisions: [
      {
        baseName: 'База C',
        canonicalFish: 'Рыба 3',
        forumTopicId: '3',
        minWeightGrams: 5,
        maxWeightGrams: 100,
        sourceRows: [
          {
            sourceSheet: 'База C',
            fishCell: 'A1',
            minCell: 'E1',
            maxCell: 'F1',
            rawMin: '5',
            rawMax: '100',
          },
        ],
        rationale: 'reviewed numeric text',
      },
      {
        baseName: 'База D',
        canonicalFish: 'Рыба 4',
        forumTopicId: '4',
        minWeightGrams: 20,
        maxWeightGrams: null,
        sourceRows: [
          {
            sourceSheet: 'База D',
            fishCell: 'A1',
            minCell: 'E1',
            maxCell: 'F1',
            rawMin: '20',
            rawMax: '200',
          },
          {
            sourceSheet: 'База D',
            fishCell: 'A2',
            minCell: 'E2',
            maxCell: 'F2',
            rawMin: '20',
            rawMax: '220',
          },
        ],
        rationale: 'retain only the independently known minimum',
      },
    ],
  };
  return { audit, reviewedDecisions };
}

void describe('BaseFish weight APPLY_READY materialization', () => {
  void it('uses independently known bounds and exact integer 105% classification', () => {
    assert.equal(classifyBaseFishWeight(99, 100, 200), 'suspicious-low');
    assert.equal(classifyBaseFishWeight(100, 100, 200), 'ordinary');
    assert.equal(classifyBaseFishWeight(200, 100, 200), 'ordinary');
    assert.equal(classifyBaseFishWeight(201, 100, 200), 'mutant');
    assert.equal(classifyBaseFishWeight(210, 100, 200), 'mutant');
    assert.equal(classifyBaseFishWeight(211, 100, 200), 'suspicious-high');

    assert.equal(classifyBaseFishWeight(99, 100, null), 'suspicious-low');
    assert.equal(classifyBaseFishWeight(100, 100, null), 'unclassified');
    assert.equal(classifyBaseFishWeight(200, null, 200), 'unclassified');
    assert.equal(classifyBaseFishWeight(210, null, 200), 'mutant');
    assert.equal(classifyBaseFishWeight(211, null, 200), 'suspicious-high');
    assert.equal(classifyBaseFishWeight(100, null, null), 'unclassified');
  });

  void it('accepts nullable source bounds and resolves only reviewed invalid/conflicting targets', () => {
    const { audit, reviewedDecisions } = fixture();
    const manifest = buildBaseFishWeightApplyReadyManifest({
      audit,
      reviewedDecisions,
      reviewedDecisionsSha256: 'decisions',
      expectedTargetCount: 4,
    });

    assert.equal(manifest.mode, 'APPLY_READY');
    assert.deepEqual(manifest.counts, {
      targets: 4,
      bothKnown: 2,
      minOnly: 1,
      maxOnly: 1,
      neither: 0,
      sourceResolved: 2,
      reviewedDecisionResolved: 2,
    });
    assert.deepEqual(
      manifest.entries.map((entry) => [
        entry.baseName,
        entry.minWeightGrams,
        entry.maxWeightGrams,
        entry.resolution,
      ]),
      [
        ['База A', 10, 20, 'SOURCE'],
        ['База B', null, 50, 'SOURCE'],
        ['База C', 5, 100, 'REVIEWED_DECISION'],
        ['База D', 20, null, 'REVIEWED_DECISION'],
      ],
    );
    assert.match(baseFishWeightApplyReadySha256(manifest), /^[0-9a-f]{64}$/u);
  });

  void it('blocks APPLY_READY when a required decision is absent or its evidence is stale', () => {
    const { audit, reviewedDecisions } = fixture();
    assert.throws(
      () =>
        buildBaseFishWeightApplyReadyManifest({
          audit,
          reviewedDecisions: {
            ...reviewedDecisions,
            decisions: reviewedDecisions.decisions.slice(0, 1),
          },
          reviewedDecisionsSha256: 'decisions',
        }),
      /requires a reviewed decision/u,
    );

    const stale = structuredClone(reviewedDecisions);
    const sourceRow = stale.decisions[0]?.sourceRows[0];
    if (sourceRow === undefined) throw new Error('fixture decision evidence is missing');
    sourceRow.rawMin = 'different';
    assert.throws(
      () =>
        buildBaseFishWeightApplyReadyManifest({
          audit,
          reviewedDecisions: stale,
          reviewedDecisionsSha256: 'decisions',
        }),
      /source evidence differs/u,
    );
  });
});
