import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseFishWeightAuditCsv,
  buildBaseFishWeightAudit,
  parseWeightCell,
  readWorksheetAuditCells,
  type BaseFishWeightAuditInput,
  type XlsxAuditCell,
} from './base-fish-weight-audit.js';
import {
  stableJson,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';

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
  sourceSheet: string,
  sourceCell: string,
  topicId: string | null,
  canonicalName: string | null,
): WorkbookFishResolution {
  return {
    baseName,
    sourceSheet,
    sourceCell,
    rawName: canonicalName ?? 'Не Fish',
    lookupName: canonicalName ?? 'Не Fish',
    annotationStripped: false,
    category: topicId === null ? 'DO_NOT_MAP' : 'CANONICAL_EXACT',
    topicId,
    canonicalName,
  };
}

function cell(
  reference: string,
  rawValue: string | null,
  overrides: Partial<XlsxAuditCell> = {},
): XlsxAuditCell {
  return {
    reference,
    cellType: 'n',
    rawValue,
    formula: null,
    ...overrides,
  };
}

function input(
  reconciliationRows: WorkbookFishResolution[],
  forum: ForumFishIdentity[],
  worksheets: Map<string, Map<string, XlsxAuditCell>>,
): BaseFishWeightAuditInput {
  return {
    reconciliationRows,
    forumFish: forum,
    worksheets,
    sources: {
      workbookFileName: 'test.xlsx',
      workbookSha256: 'workbook',
      reconciliationSha256: 'reconciliation',
      forum69Sha256: 'forum69',
    },
  };
}

void describe('BaseFish weight audit', () => {
  void it('reads normal E/F and Волга G/H cells without using Excel Fish names as identity', () => {
    const rows = [
      reconciliationRow('Амур', 'Амур', 'A1', '1', 'Канонический амур'),
      reconciliationRow('Волга', 'Волга', 'C2', '2', 'Каноническая белуга'),
      reconciliationRow('Амур', 'Амур', 'A3', null, null),
      reconciliationRow('Амур', 'Амур', 'A4', '3', 'Рыба с одной границей'),
    ];
    rows[0].rawName = 'Excel alias that must not become Fish.name';
    const worksheets = new Map([
      [
        'Амур',
        new Map([
          ['E1', cell('E1', '100')],
          ['F1', cell('F1', '200')],
          ['G1', cell('G1', '900')],
          ['H1', cell('H1', '901')],
          ['E3', cell('E3', '1')],
          ['F3', cell('F3', '2')],
          ['F4', cell('F4', '400')],
        ]),
      ],
      [
        'Волга',
        new Map([
          ['E2', cell('E2', '1')],
          ['F2', cell('F2', '2')],
          ['G2', cell('G2', '300')],
          ['H2', cell('H2', '250')],
        ]),
      ],
    ]);

    const audit = buildBaseFishWeightAudit(
      input(
        rows,
        [
          forumFish('1', 'Канонический амур'),
          forumFish('2', 'Каноническая белуга'),
          forumFish('3', 'Рыба с одной границей'),
        ],
        worksheets,
      ),
    );

    assert.deepEqual(
      audit.rows.map((row) => [row.canonicalFish, row.min.cell, row.max.cell, row.status]),
      [
        ['Канонический амур', 'E1', 'F1', 'VALID_COMPLETE'],
        [null, 'E3', 'F3', 'NO_TARGET'],
        ['Рыба с одной границей', 'E4', 'F4', 'MISSING_MIN'],
        ['Каноническая белуга', 'G2', 'H2', 'SWAPPED'],
      ],
    );
    assert.equal(audit.rows[0]?.canonicalFish, 'Канонический амур');
    assert.equal(audit.manualReviewRows.length, 1);
    assert.match(audit.blockersBeforeApplyReady.join('\n'), /SWAPPED/u);
  });

  void it('parses exact integer numeric cells and rejects formulas, text, fractions and range errors', () => {
    for (const [rawValue, expected] of [
      ['100.0', 100],
      ['1e3', 1_000],
      ['0.001e3', 1],
      ['2147483647', 2_147_483_647],
    ] as const) {
      assert.deepEqual(parseWeightCell('E1', cell('E1', rawValue)), {
        cell: 'E1',
        cellType: 'n',
        rawValue,
        formula: null,
        status: 'VALID',
        valueGrams: expected,
        invalidReason: null,
      });
    }

    const invalid = [
      cell('E1', '1.5'),
      cell('E1', '0'),
      cell('E1', '-1'),
      cell('E1', '2147483648'),
      cell('E1', '100', { cellType: 's' }),
      cell('E1', '100', { formula: '50+50' }),
    ];
    assert.deepEqual(
      invalid.map((candidate) => parseWeightCell('E1', candidate).status),
      Array.from({ length: invalid.length }, () => 'INVALID'),
    );
    assert.equal(parseWeightCell('E1', undefined).status, 'MISSING');
  });

  void it('reports identical duplicates separately from conflicts and marks every conflict row', () => {
    const rows = [
      reconciliationRow('База 1', 'Лист 1', 'A1', '1', 'Рыба 1'),
      reconciliationRow('База 1', 'Лист 1', 'A2', '1', 'Рыба 1'),
      reconciliationRow('База 2', 'Лист 2', 'A1', '2', 'Рыба 2'),
      reconciliationRow('База 2', 'Лист 2', 'A2', '2', 'Рыба 2'),
    ];
    const worksheets = new Map([
      [
        'Лист 1',
        new Map([
          ['E1', cell('E1', '10')],
          ['F1', cell('F1', '20')],
          ['E2', cell('E2', '10.0')],
          ['F2', cell('F2', '2e1')],
        ]),
      ],
      [
        'Лист 2',
        new Map([
          ['E1', cell('E1', '30')],
          ['F1', cell('F1', '40')],
          ['E2', cell('E2', '31')],
          ['F2', cell('F2', '40')],
        ]),
      ],
    ]);

    const audit = buildBaseFishWeightAudit(
      input(rows, [forumFish('1', 'Рыба 1'), forumFish('2', 'Рыба 2')], worksheets),
    );

    assert.equal(audit.uniqueTargetMemberships, 2);
    assert.equal(audit.duplicateIdenticalGroups, 1);
    assert.equal(audit.conflictingGroups, 1);
    assert.deepEqual(
      audit.manualReviewRows.map((row) => [row.baseName, row.fishCell, row.manualReviewReasons]),
      [
        ['База 2', 'A1', ['CONFLICTING_TARGET_GROUP']],
        ['База 2', 'A2', ['CONFLICTING_TARGET_GROUP']],
      ],
    );
    assert.match(audit.blockersBeforeApplyReady.join('\n'), /conflicting Base\+Fish groups/u);
    assert.equal(
      stableJson(audit),
      stableJson(
        buildBaseFishWeightAudit(
          input(
            [...rows].reverse(),
            [forumFish('2', 'Рыба 2'), forumFish('1', 'Рыба 1')],
            worksheets,
          ),
        ),
      ),
    );
  });

  void it('preserves self-closing cells as missing and emits raw audit evidence in CSV', () => {
    const cells = readWorksheetAuditCells(
      [
        '<worksheet><sheetData><row r="1">',
        '<c r="E1" s="1"/>',
        '<c r="F1" t="n"><v>250</v></c>',
        '<c r="G1" t="s"><v>0</v></c>',
        '<c r="H1" t="n"><f t="shared"/><v>300</v></c>',
        '</row></sheetData></worksheet>',
      ].join(''),
      ['text value'],
    );
    assert.deepEqual(cells.get('E1'), {
      reference: 'E1',
      cellType: 'n',
      rawValue: null,
      formula: null,
    });
    assert.equal(cells.get('G1')?.rawValue, 'text value');
    assert.equal(parseWeightCell('H1', cells.get('H1')).invalidReason, 'FORMULA_NOT_ACCEPTED');

    const audit = buildBaseFishWeightAudit(
      input(
        [reconciliationRow('База', 'Лист', 'A1', '1', 'Рыба')],
        [forumFish('1', 'Рыба')],
        new Map([['Лист', cells]]),
      ),
    );
    assert.equal(audit.rows[0]?.status, 'MISSING_MIN');
    const csv = baseFishWeightAuditCsv(audit.rows);
    assert.match(csv, /База,Рыба,1/u);
    assert.match(csv, /E1,F1,,250/u);
  });
});
