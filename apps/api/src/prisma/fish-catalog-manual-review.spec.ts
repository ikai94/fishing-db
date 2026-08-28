import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildForumFishCorpus,
  stableJson,
  type FishReconciliationEntry,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';
import {
  FINAL_HUMAN_DB_FISH_NAMES,
  FINAL_HUMAN_WORKBOOK_CANDIDATES,
  MANUAL_REVIEW_COLLISIONS,
  buildManualDbReview,
  buildManualWorkbookDecisions,
  finalizeFishReconciliation,
  projectManualWorkbookDecisions,
} from './fish-catalog-manual-review.js';

function manualRow(rawName: string, sourceCell: string): WorkbookFishResolution {
  return {
    baseName: 'Монголия',
    sourceSheet: 'Монголия',
    sourceCell,
    rawName,
    lookupName: rawName,
    annotationStripped: false,
    category: 'MANUAL',
    topicId: null,
    canonicalName: null,
  };
}

function manualDbEntry(
  currentFishId: string,
  currentName: string,
  topicId: string | null,
  canonicalName: string | null,
): FishReconciliationEntry {
  return {
    category: 'MANUAL',
    currentFishId,
    currentName,
    currentIsActive: true,
    topicId,
    canonicalName,
    preservesFishId: true,
    decision: 'MANUAL',
    reason: 'test',
  };
}

void describe('manual Fish/BaseFish review', () => {
  void it('maps Монгол.Краснопёр only to the exact full forum69 identity', () => {
    const corpus = buildForumFishCorpus([
      {
        topicId: '2',
        subforumId: '70',
        topicTitle: 'Монгольский краснопер (Краснопер монгольский)',
      },
    ]);
    const decisions = buildManualWorkbookDecisions([manualRow('Монгол.Краснопёр', 'A2')], corpus);

    assert.deepEqual(decisions, [
      {
        rawName: 'Монгол.Краснопёр',
        rows: 1,
        cells: [{ baseName: 'Монголия', sourceSheet: 'Монголия', sourceCell: 'A2' }],
        decision: 'PROPOSED',
        topicId: '2',
        canonicalName: 'Монгольский краснопер',
        rationale: 'Explicit reviewed source-cell alias to an exact full forum69 canonical name',
      },
    ]);
  });

  void it('does not fuzzy-match an unreviewed similar workbook value', () => {
    const corpus = buildForumFishCorpus([
      { topicId: '2', subforumId: '70', topicTitle: 'Монгольский краснопер' },
    ]);
    const decisions = buildManualWorkbookDecisions([manualRow('Монгол.Краснопёрка', 'A3')], corpus);

    assert.equal(decisions[0]?.decision, 'MANUAL');
    assert.equal(decisions[0]?.canonicalName, null);
  });

  void it('excludes reviewed items and source noise from Fish and BaseFish projection', () => {
    const input = [manualRow('Якорь', 'A4'), manualRow('№1. 15кг-49кг.', 'A5')];
    const decisions = buildManualWorkbookDecisions(input, []);
    const projected = projectManualWorkbookDecisions(input, decisions);

    assert.deepEqual(
      decisions.map((entry) => entry.decision),
      ['EXCLUDE_NON_FISH', 'EXCLUDE_NOISE'],
    );
    assert.ok(projected.every((row) => row.topicId === null && row.canonicalName === null));
  });

  void it('preserves explicit DO_NOT_MAP evidence without a Fish or BaseFish target', () => {
    const input = [
      manualRow('Губка', 'A6'),
      manualRow('Кит синий', 'A7'),
      manualRow('Поплак', 'A8'),
    ];
    const decisions = buildManualWorkbookDecisions(input, []);
    const projected = projectManualWorkbookDecisions(input, decisions);

    assert.deepEqual(
      decisions.map((entry) => entry.decision),
      ['DO_NOT_MAP', 'DO_NOT_MAP', 'DO_NOT_MAP'],
    );
    assert.ok(
      projected.every(
        (row) =>
          row.category === 'DO_NOT_MAP' && row.topicId === null && row.canonicalName === null,
      ),
    );
  });

  void it('requires every proposed display target to be an exact canonical corpus name', () => {
    const corpus = buildForumFishCorpus([
      { topicId: '2', subforumId: '70', topicTitle: 'Краснопер монгольский' },
    ]);

    assert.throws(
      () => buildManualWorkbookDecisions([manualRow('Монгол.Краснопёр', 'A2')], corpus),
      /not an exact forum69 canonical name/u,
    );
  });

  void it('is deterministic and projection is idempotent', () => {
    const corpus = buildForumFishCorpus([
      { topicId: '2', subforumId: '70', topicTitle: 'Монгольский краснопер' },
    ]);
    const input = [manualRow('Монгол.Краснопёр', 'A2')];
    const first = buildManualWorkbookDecisions(input, corpus);
    const second = buildManualWorkbookDecisions([...input], corpus);
    const projected = projectManualWorkbookDecisions(input, first);

    assert.equal(stableJson(first), stableJson(second));
    assert.equal(
      stableJson(projectManualWorkbookDecisions(projected, first)),
      stableJson(projected),
    );
  });

  void it('keeps collision sides on distinct immutable Fish IDs', () => {
    assert.equal(new Set(MANUAL_REVIEW_COLLISIONS.map((entry) => entry.topicId)).size, 2);
    for (const collision of MANUAL_REVIEW_COLLISIONS) {
      assert.notEqual(collision.legacyFishId, collision.canonicalFishId);
    }
  });

  void it('limits the final human queue to the approved 3 DB and 6 workbook values', () => {
    assert.deepEqual([...FINAL_HUMAN_DB_FISH_NAMES].sort(), [
      'Коралловый группер',
      'Красный луциан',
      'Лещ морской',
    ]);
    assert.deepEqual([...FINAL_HUMAN_WORKBOOK_CANDIDATES.keys()].sort(), [
      'Губка',
      'Кит синий',
      'Коралловый группер',
      'Красный луциан',
      'Лещ морской',
      'Поплак',
    ]);
  });

  void it('preserves the five finalized high-confidence DB actions', () => {
    const corpus = buildForumFishCorpus([
      { topicId: '32600', subforumId: '70', topicTitle: 'Клюворыл' },
      { topicId: '33510', subforumId: '70', topicTitle: 'Мобула серповидная' },
      { topicId: '32914', subforumId: '70', topicTitle: 'Скампи голубой' },
      { topicId: '32927', subforumId: '70', topicTitle: 'Панцирник мисcисипский' },
      { topicId: '32201', subforumId: '70', topicTitle: 'Кои Сёва' },
    ]);
    const entries = [
      manualDbEntry('1', 'Клюварыл', '32600', 'Клюворыл'),
      manualDbEntry('2', 'Мабула серповидная', '33510', 'Мобула серповидная'),
      manualDbEntry('3', 'Омар голубой', '32914', 'Скампи голубой'),
      manualDbEntry('4', 'Панцирник миссисипский', '32927', 'Панцирник мисcисипский'),
      manualDbEntry('5', 'Сева', '32201', 'Кои Сёва'),
    ];
    const references = entries.map((entry) => ({
      fishId: entry.currentFishId as string,
      catchReports: 0,
      catchReportIds: [],
      fishingBaseFish: 0,
      fishingBases: [],
    }));
    const review = buildManualDbReview(entries, references, corpus, []);

    assert.deepEqual(
      review.map((entry) => [entry.currentName, entry.recommendation, entry.proposedCanonicalName]),
      [
        ['Клюварыл', 'REPOINT+DEACTIVATE', 'Клюворыл'],
        ['Мабула серповидная', 'REPOINT+DEACTIVATE', 'Мобула серповидная'],
        ['Омар голубой', 'RENAME', 'Скампи голубой'],
        ['Панцирник миссисипский', 'RENAME', 'Панцирник мисcисипский'],
        ['Сева', 'RENAME', 'Кои Сёва'],
      ],
    );
  });

  void it('finalizes generic Акула and Скат as inactive local extras', () => {
    const entries = [
      manualDbEntry('1', 'Акула', null, null),
      manualDbEntry('2', 'Скат', null, null),
    ];
    const references = entries.map((entry) => ({
      fishId: entry.currentFishId as string,
      catchReports: 0,
      catchReportIds: [],
      fishingBaseFish: 0,
      fishingBases: [],
    }));
    const review = buildManualDbReview(entries, references, [], []);

    assert.deepEqual(
      review.map((entry) => [entry.currentName, entry.recommendation, entry.recommendedIsActive]),
      [
        ['Акула', 'KEEP_EXTRA', false],
        ['Скат', 'KEEP_EXTRA', false],
      ],
    );
  });

  void it('finalizes report-backed DB renames and matching workbook aliases', () => {
    const corpus = buildForumFishCorpus([
      {
        topicId: '318',
        subforumId: '70',
        topicTitle: 'Красный коралловый группер (Группер коралловый красный)',
      },
      {
        topicId: '317',
        subforumId: '70',
        topicTitle: 'Красный императорский луциан (Луциан императорский красный)',
      },
      { topicId: '32766', subforumId: '70', topicTitle: 'Лещ морской обыкновенный' },
      { topicId: '32768', subforumId: '70', topicTitle: 'Лещ морской кинжальный' },
      { topicId: '32772', subforumId: '70', topicTitle: 'Лещ морской белый' },
    ]);
    const entries = [
      manualDbEntry('1', 'Коралловый группер', null, null),
      manualDbEntry('2', 'Красный луциан', null, null),
      manualDbEntry('3', 'Лещ морской', null, null),
    ];
    const references = entries.map((entry) => ({
      fishId: entry.currentFishId as string,
      catchReports: 1,
      catchReportIds: ['report'],
      fishingBaseFish: 1,
      fishingBases: [],
    }));
    const dbReview = buildManualDbReview(entries, references, corpus, []);
    const workbookReview = buildManualWorkbookDecisions(
      [
        manualRow('Коралловый группер', 'A1'),
        manualRow('Красный луциан', 'A2'),
        manualRow('Лещ морской', 'A3'),
      ],
      corpus,
    );

    assert.deepEqual(
      dbReview.map((entry) => [entry.recommendation, entry.proposedCanonicalName]),
      [
        ['RENAME', 'Красный коралловый группер'],
        ['RENAME', 'Красный императорский луциан'],
        ['RENAME', 'Лещ морской обыкновенный'],
      ],
    );
    assert.deepEqual(
      workbookReview.map((entry) => [entry.decision, entry.canonicalName]),
      [
        ['PROPOSED', 'Красный коралловый группер'],
        ['PROPOSED', 'Красный императорский луциан'],
        ['PROPOSED', 'Лещ морской обыкновенный'],
      ],
    );
  });

  void it('produces zero-MANUAL apply entries with explicit repoint targets', () => {
    const corpus = buildForumFishCorpus([
      { topicId: '32600', subforumId: '70', topicTitle: 'Клюворыл' },
      { topicId: '32914', subforumId: '70', topicTitle: 'Скампи голубой' },
    ]);
    const entries: FishReconciliationEntry[] = [
      manualDbEntry('9e3c612f-048c-41bc-a268-5a0d35bef4a4', 'Клюварыл', '32600', 'Клюворыл'),
      {
        category: 'EXACT_CANONICAL',
        currentFishId: '4a3821cf-861b-4302-bf0c-e34b88ca25b1',
        currentName: 'Клюворыл',
        currentIsActive: true,
        topicId: '32600',
        canonicalName: 'Клюворыл',
        preservesFishId: true,
        decision: 'KEEP',
        reason: 'test',
      },
      manualDbEntry('rename-id', 'Омар голубой', null, null),
      {
        category: 'MISSING_CREATE',
        currentFishId: null,
        currentName: null,
        currentIsActive: null,
        topicId: '32914',
        canonicalName: 'Скампи голубой',
        preservesFishId: false,
        decision: 'CREATE',
        reason: 'test',
      },
    ];
    const references = ['9e3c612f-048c-41bc-a268-5a0d35bef4a4', 'rename-id'].map((fishId) => ({
      fishId,
      catchReports: 0,
      catchReportIds: [],
      fishingBaseFish: 0,
      fishingBases: [],
    }));
    const review = buildManualDbReview(
      entries.filter((entry) => entry.category === 'MANUAL'),
      references,
      corpus,
      [],
    );
    const finalized = finalizeFishReconciliation(entries, review, corpus);

    assert.equal(
      finalized.some((entry) => entry.decision === 'MANUAL'),
      false,
    );
    assert.equal(
      finalized.find((entry) => entry.currentFishId === 'rename-id')?.preservesFishId,
      true,
    );
    assert.equal(
      finalized.find((entry) => entry.currentFishId === '9e3c612f-048c-41bc-a268-5a0d35bef4a4')
        ?.repointTargetFishId,
      '4a3821cf-861b-4302-bf0c-e34b88ca25b1',
    );
    assert.equal(
      finalized.filter((entry) => entry.topicId === '32914').length,
      1,
      'reviewed rename must replace the redundant CREATE',
    );
  });
});
