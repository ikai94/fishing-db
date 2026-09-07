import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CatchReportParserService } from '../catch-reports/parser/catch-report-parser.service.js';
import {
  absoluteCatchCount,
  deterministicCatchCount,
  deterministicWeight,
  formatKlevalkaCatchLine,
  formatKlevalkaWeight,
  generateKlevalkaCatches,
  KLEVALKA_CONSERVATIVE_WEIGHT_BASE_NAMES,
  klevalkaSourceAwareGeneratorMax,
  klevalkaWeightProfileForBase,
  parseKlevalkaHtml,
  weightFromDeterministicDraws,
  type KlevalkaCatalogSnapshot,
} from './klevalka-catch-generator.js';
import {
  determineKlevalkaRunMode,
  parseKlevalkaGeneratorCommand,
} from './generate-klevalka-catches.js';

const CATALOG = {
  schemaVersion: 1,
  fishingBases: [
    {
      id: 'base-amur',
      name: 'Амур',
      locations: [{ id: 'location-creek', number: 1, name: 'Тихая протока' }],
    },
  ],
  fish: [{ id: 'fish-burbot', name: 'Налим' }],
  baits: [{ id: 'bait-frog', name: 'Лягушка', type: 'BAIT' }],
  memberships: [
    {
      fishingBaseId: 'base-amur',
      fishId: 'fish-burbot',
      minWeightGrams: 100,
      maxWeightGrams: 1_000,
    },
  ],
} as const satisfies KlevalkaCatalogSnapshot;

function pageHtml(
  rows: ReadonlyArray<{ fish: string; bait: string; int: string; weight?: string }>,
): string {
  return `<!doctype html>
    <html><body><div class="padding">
      <b>Локация:</b> Тихая протока<br>
      <b>База:</b> Амур<br>
      <input type="radio" name="count_show" value="all" checked="checked">
      <input type="radio" name="count_show" value="good">
      <input type="radio" name="count_show" value="best">
      <table class="large" id="founds_items">
        <tr><th>#</th><th>рыба</th><th>вес (гр)</th><th>наживка</th><th>добавил(а)</th><th>&nbsp;</th><th>инт</th><th></th></tr>
        ${rows
          .map(
            (row, index) =>
              `<tr class="tr_item item_ch_1"><td>${index + 1}</td><td><a href="/fish/detail/1">${row.fish}</a></td><td>${row.weight ?? '999'}</td><td><a href="/bait/detail/2">${row.bait}</a></td><td>author</td><td></td><td>${row.int}</td><td></td></tr>`,
          )
          .join('')}
      </table>
    </div></body></html>`;
}

function realFishPageHtml(): string {
  return `<!doctype html>
    <html><body>
      <div class="header"><h2>рыба: Сима</h2></div>
      <input type="radio" name="count_show" value="all" checked="checked">
      <input type="radio" name="count_show" value="good">
      <input type="radio" name="count_show" value="best">
      <table class="large" id="founds_items">
        <tr><th>#</th><th>вес (гр)</th><th>база, локация</th><th>наживка / блесна</th><th>добавил(а)</th><th>&nbsp;</th><th>инт</th><th></th></tr>
        <tr class="baza_2 tr_item item_8966">
          <td>1</td><td>9.053</td>
          <td><a href="/location/baza/2">Амур</a>, <a href="/location/detail/30">Протока бешеная - огороды</a></td>
          <td><a href="/nazhivka/detail/4">Крабовое мясо</a></td><td>author</td><td></td><td>134</td><td></td>
        </tr>
        <tr class="baza_2 tr_item item_2242">
          <td>2</td><td>9.895</td>
          <td><a href="/location/baza/2">Амур</a>, <a href="/location/detail/31">Старый затон</a></td>
          <td><a href="/nazhivka/detail/2">Живец</a></td><td>author</td><td></td><td>1121</td><td></td>
        </tr>
        <tr class="baza_2 tr_item item_2242"><td colspan="2"></td><td colspan="6" class="comment">пол воды, ямка 1021</td></tr>
      </table>
    </body></html>`;
}

function generated(
  rows: ReadonlyArray<{ fish: string; bait: string; int: string; weight?: string }>,
) {
  const page = parseKlevalkaHtml(pageHtml(rows), 'location-1.html');
  return {
    page,
    result: generateKlevalkaCatches({ pages: [page], catalog: CATALOG, datasetId: 'test-dataset' }),
  };
}

void describe('Klevalka CatchReport generator', () => {
  void it('reads Base, Location, Fish, Bait and INT from the observed Klevalka table structure', () => {
    const page = parseKlevalkaHtml(
      pageHtml([{ fish: 'Налим', bait: 'Лягушка', int: '12 345' }]),
      'page.html',
    );
    assert.equal(page.fishingBaseNameRaw, 'Амур');
    assert.equal(page.locationNameRaw, 'Тихая протока');
    assert.deepEqual(
      page.rows.map((row) => [row.fishNameRaw, row.baitNameRaw, row.sourceWeightGrams, row.int]),
      [['Налим', 'Лягушка', 999, 12_345]],
    );
    assert.deepEqual(page.issues, []);
  });

  void it('preserves an observed zero source weight without using it as a generated catch weight', () => {
    const { page, result } = generated([{ fish: 'Налим', bait: 'Лягушка', weight: '0', int: '1' }]);
    assert.equal(page.rows[0]?.sourceWeightGrams, 0);
    assert.deepEqual(page.issues, []);
    assert.equal(result.generatedCount, 1);
    assert.ok((result.generatedFiles[0]?.rows[0]?.weightGrams ?? 0) >= 100);
  });

  void it('accepts only an explicitly selected all-mode Fish snapshot for full generation', () => {
    const allPage = parseKlevalkaHtml(realFishPageHtml(), 'all.html');
    assert.equal(allPage.sourceMode, 'ALL');
    assert.equal(
      determineKlevalkaRunMode({ blockedRowCount: 0, reviewIssueCount: 0 }),
      'EXPORT_READY',
    );

    for (const filteredMode of ['good', 'best'] as const) {
      const filteredHtml = realFishPageHtml()
        .replace('value="all" checked="checked"', 'value="all"')
        .replace(`value="${filteredMode}"`, `value="${filteredMode}" checked="checked"`);
      const page = parseKlevalkaHtml(filteredHtml, `${filteredMode}.html`);
      assert.equal(page.sourceMode, filteredMode.toLocaleUpperCase('en-US'));
      assert.equal(page.issues[0]?.code, 'SOURCE_MODE_FILTERED');
      assert.equal(
        determineKlevalkaRunMode({
          blockedRowCount: 0,
          reviewIssueCount: page.issues.length,
        }),
        'BLOCKED_REVIEW',
      );
      assert.equal(
        determineKlevalkaRunMode({
          maxTuples: 2,
          blockedRowCount: 0,
          reviewIssueCount: page.issues.length,
        }),
        'DRY_RUN',
      );
    }

    const unknownPage = parseKlevalkaHtml(
      realFishPageHtml().replace(' checked="checked"', ''),
      'unknown.html',
    );
    assert.equal(unknownPage.sourceMode, 'UNKNOWN');
    assert.equal(unknownPage.issues[0]?.code, 'SOURCE_MODE_UNKNOWN');
  });

  void it('keeps each real fish-page table row intact and ignores its comment row', () => {
    const page = parseKlevalkaHtml(realFishPageHtml(), 'real-sima.html');
    assert.deepEqual(
      page.rows.map((row) => ({
        fish: row.fishNameRaw,
        fishingBase: row.fishingBaseNameRaw,
        location: row.locationNameRaw,
        bait: row.baitNameRaw,
        sourceWeightGrams: row.sourceWeightGrams,
        int: row.int,
      })),
      [
        {
          fish: 'Сима',
          fishingBase: 'Амур',
          location: 'Протока бешеная - огороды',
          bait: 'Крабовое мясо',
          sourceWeightGrams: 9_053,
          int: 134,
        },
        {
          fish: 'Сима',
          fishingBase: 'Амур',
          location: 'Старый затон',
          bait: 'Живец',
          sourceWeightGrams: 9_895,
          int: 1121,
        },
      ],
    );
    assert.deepEqual(page.issues, []);
  });

  void it('uses the approved absolute scale and preserves small INT values', () => {
    assert.deepEqual(
      [1, 2, 5, 9, 10, 100, 1_000, 10_000, 25_000, 50_000, 55_000, 100_000].map(absoluteCatchCount),
      [1, 2, 5, 9, 10, 34, 58, 82, 92, 99, 100, 100],
    );
    for (let int = 1; int < 10; int += 1) {
      assert.equal(deterministicCatchCount(int, 'dataset', 'source'), int);
      assert.ok(deterministicCatchCount(int, 'dataset', 'source') < 10);
    }
    assert.equal(deterministicCatchCount(55_000, 'dataset', 'source'), 100);
  });

  void it('keeps only the maximum INT for a resolved tuple without summing duplicates', () => {
    const { page, result } = generated([
      { fish: 'Налим', bait: 'Лягушка', int: '100' },
      { fish: 'Налим', bait: 'Лягушка', int: '500' },
      { fish: 'Налим', bait: 'Лягушка', int: '200' },
    ]);
    const retained = page.rows.find((row) => row.int === 500);
    assert.ok(retained);
    assert.equal(result.retainedRows.length, 1);
    assert.equal(result.retainedRows[0]?.int, 500);
    assert.equal(result.ignoredDuplicateCount, 2);
    assert.equal(
      result.generatedCount,
      deterministicCatchCount(500, 'test-dataset', retained.sourceId),
    );
    assert.equal(result.reviewRows.filter((row) => row.status === 'IGNORED_DUPLICATE').length, 2);
  });

  void it('is unchanged when lower-INT duplicates are reordered or removed', () => {
    const first = generated([
      { fish: 'Налим', bait: 'Лягушка', int: '100' },
      { fish: 'Налим', bait: 'Лягушка', int: '500' },
      { fish: 'Налим', bait: 'Лягушка', int: '200' },
    ]).result.generatedFiles[0]?.content;
    const second = generated([
      { fish: 'Налим', bait: 'Лягушка', int: '200' },
      { fish: 'Налим', bait: 'Лягушка', int: '500' },
    ]).result.generatedFiles[0]?.content;
    const third = generated([{ fish: 'Налим', bait: 'Лягушка', int: '500' }]).result
      .generatedFiles[0]?.content;
    assert.equal(first, second);
    assert.equal(second, third);
  });

  void it('selects the approved deterministic weight buckets and positions', () => {
    const weights = Array.from({ length: 20_000 }, (_value, index) =>
      deterministicWeight(1, 100_001, 'dataset', 'source', index + 1),
    );
    assert.deepEqual(
      weights.slice(0, 10),
      [50_958, 65_570, 22_074, 57_972, 79_895, 80_928, 62_206, 23_160, 64_827, 38_116],
    );
    assert.ok(
      weights.every((weight) => Number.isInteger(weight) && weight >= 1 && weight <= 100_001),
    );

    const buckets = [0, 0, 0, 0, 0];
    for (const weight of weights) {
      if (weight < 35_001) buckets[0] += 1;
      else if (weight < 60_001) buckets[1] += 1;
      else if (weight < 82_001) buckets[2] += 1;
      else if (weight < 95_001) buckets[3] += 1;
      else buckets[4] += 1;
    }
    const expectedShares = [0.08, 0.35, 0.4, 0.14, 0.03];
    for (const [index, count] of buckets.entries()) {
      assert.ok(
        Math.abs(count / weights.length - (expectedShares[index] ?? 0)) < 0.015,
        `unexpected bucket distribution ${JSON.stringify(buckets)}`,
      );
    }
  });

  void it('uses the conservative deterministic profile only for the explicit audit Base list', () => {
    const expectedBases = [
      'Амазония',
      'Антарктика',
      'Большой Барьерный Риф',
      'Борнео',
      'Восточный Крит',
      'Гавайские острова',
      'Гренландия',
      'Залив Александры',
      'Кроноцкий залив',
      'Лофотенские острова',
      'Миссисипи',
      'Нил',
      'Озера Танзании',
      'Патагонское озеро',
      'Побережье Камчатки',
      'Побережье Танзании',
      'Побережье Чили',
      'Полинезия',
      'Саргассово море',
      'Сейшельские острова',
      'ЮАР',
      'Юго-восточное побережье',
      'Янцзы',
    ];
    assert.deepEqual(KLEVALKA_CONSERVATIVE_WEIGHT_BASE_NAMES, expectedBases);
    for (const base of expectedBases) {
      assert.equal(klevalkaWeightProfileForBase(base), 'CONSERVATIVE', base);
    }
    assert.equal(klevalkaWeightProfileForBase('Амур'), 'DEFAULT');
    assert.equal(klevalkaWeightProfileForBase('Дема'), 'DEFAULT');
    assert.equal(klevalkaWeightProfileForBase('Озеро'), 'DEFAULT');
    assert.equal(klevalkaWeightProfileForBase('юар'), 'DEFAULT');

    const weights = Array.from({ length: 20_000 }, (_value, index) =>
      deterministicWeight(1, 100_001, 'dataset', 'source', index + 1, 'CONSERVATIVE'),
    );
    assert.deepEqual(
      weights.slice(0, 10),
      [50_958, 41_330, 22_074, 57_972, 79_895, 80_928, 62_206, 23_160, 40_485, 38_116],
    );

    const buckets = [0, 0, 0, 0, 0];
    for (const weight of weights) {
      if (weight < 35_001) buckets[0] += 1;
      else if (weight < 60_001) buckets[1] += 1;
      else if (weight < 82_001) buckets[2] += 1;
      else if (weight < 94_001) buckets[3] += 1;
      else buckets[4] += 1;
    }
    const expectedShares = [0.1, 0.4, 0.38, 0.1, 0.02];
    for (const [index, count] of buckets.entries()) {
      assert.ok(
        Math.abs(count / weights.length - (expectedShares[index] ?? 0)) < 0.015,
        `unexpected conservative bucket distribution ${JSON.stringify(buckets)}`,
      );
    }
  });

  void it('applies integer source-aware caps only to conservative Bases above the 1.5 ratio', () => {
    const generatorMax = (sourceRowCount: number, sourceMaxWeightGrams = 100) =>
      klevalkaSourceAwareGeneratorMax({
        fishingBaseName: 'Амазония',
        fishName: 'Налим',
        effectiveMaxWeightGrams: 1_000,
        sourceMaxWeightGrams,
        sourceRowCount,
      });

    assert.equal(generatorMax(1), 200);
    assert.equal(generatorMax(2), 200);
    assert.equal(generatorMax(3), 175);
    assert.equal(generatorMax(5), 175);
    assert.equal(generatorMax(6), 150);
    assert.equal(generatorMax(20), 150);
    assert.equal(generatorMax(21), 135);
    assert.equal(generatorMax(100), 135);
    assert.equal(generatorMax(101), 125);
    assert.equal(generatorMax(3, 101), 176);
    assert.equal(
      klevalkaSourceAwareGeneratorMax({
        fishingBaseName: 'Амазония',
        fishName: 'Налим',
        effectiveMaxWeightGrams: 150,
        sourceMaxWeightGrams: 100,
        sourceRowCount: 1,
      }),
      150,
    );
    assert.equal(
      klevalkaSourceAwareGeneratorMax({
        fishingBaseName: 'Амур',
        fishName: 'Налим',
        effectiveMaxWeightGrams: 1_000,
        sourceMaxWeightGrams: 100,
        sourceRowCount: 1,
      }),
      1_000,
    );
  });

  void it('exempts only the three reviewed blue-whale empirical-bound pairs', () => {
    for (const fishingBaseName of ['Кроноцкий залив', 'Саргассово море', 'ЮАР']) {
      assert.equal(
        klevalkaSourceAwareGeneratorMax({
          fishingBaseName,
          fishName: 'Кит синий северный',
          effectiveMaxWeightGrams: 1_000,
          sourceMaxWeightGrams: 100,
          sourceRowCount: 1,
          usesReviewedWeightOverride: true,
        }),
        1_000,
      );
    }
    assert.equal(
      klevalkaSourceAwareGeneratorMax({
        fishingBaseName: 'Кроноцкий залив',
        fishName: 'Кит синий северный',
        effectiveMaxWeightGrams: 1_000,
        sourceMaxWeightGrams: 100,
        sourceRowCount: 1,
      }),
      200,
    );
    assert.equal(
      klevalkaSourceAwareGeneratorMax({
        fishingBaseName: 'ЮАР',
        fishName: 'Кит синий (альбинос)',
        effectiveMaxWeightGrams: 1_000,
        sourceMaxWeightGrams: 100,
        sourceRowCount: 1,
        usesReviewedWeightOverride: true,
      }),
      200,
    );
  });

  void it('handles collapsed ranges and permits the exact maximum', () => {
    const uint64Space = 1n << 64n;
    const drawAtPercent = (percent: number) => (BigInt(percent) * uint64Space + 99n) / 100n;
    assert.equal(deterministicWeight(777, 777, 'dataset', 'source', 1), 777);
    assert.equal(deterministicWeight(777, 777, 'dataset', 'source', 1, 'CONSERVATIVE'), 777);
    assert.equal(weightFromDeterministicDraws(100, 1_000, 0n, 0n), 190);
    assert.equal(weightFromDeterministicDraws(100, 1_000, drawAtPercent(8), 0n), 415);
    assert.equal(weightFromDeterministicDraws(100, 1_000, drawAtPercent(43), 0n), 640);
    assert.equal(weightFromDeterministicDraws(100, 1_000, drawAtPercent(83), 0n), 838);
    assert.equal(weightFromDeterministicDraws(100, 1_000, drawAtPercent(97), 0n), 955);
    assert.equal(
      weightFromDeterministicDraws(100, 1_000, drawAtPercent(98), 0n, 'CONSERVATIVE'),
      946,
    );
    assert.equal(
      weightFromDeterministicDraws(100, 1_000, (1n << 64n) - 1n, (1n << 64n) - 1n),
      1_000,
    );
    assert.equal(
      weightFromDeterministicDraws(100, 1_000, (1n << 64n) - 1n, (1n << 64n) - 1n, 'CONSERVATIVE'),
      1_000,
    );
  });

  void it('blocks unknown and ambiguous catalog matches and never emits them', () => {
    const page = parseKlevalkaHtml(
      pageHtml([
        { fish: 'Неизвестная рыба', bait: 'Лягушка', int: '100' },
        { fish: 'Налим', bait: 'Неизвестная наживка', int: '100' },
      ]),
      'unknown.html',
    );
    const ambiguousCatalog: KlevalkaCatalogSnapshot = {
      ...CATALOG,
      fish: [
        { id: 'fish-one', name: 'Налим' },
        { id: 'fish-two', name: 'Налйм' },
      ],
    };
    const result = generateKlevalkaCatches({
      pages: [page],
      catalog: ambiguousCatalog,
      datasetId: 'test-dataset',
    });
    assert.equal(result.generatedCount, 0);
    assert.ok(result.reviewRows.every((row) => row.status === 'BLOCKED'));
    assert.ok(
      result.reviewRows.some((row) =>
        row.issues.some((issue) => issue.code === 'CATALOG_MATCH_UNKNOWN'),
      ),
    );
    assert.ok(
      result.reviewRows.some((row) =>
        row.issues.some((issue) => issue.code === 'CATALOG_MATCH_AMBIGUOUS'),
      ),
    );
  });

  void it('blocks missing BaseFish membership and incomplete weight bounds', () => {
    const page = parseKlevalkaHtml(
      pageHtml([{ fish: 'Налим', bait: 'Лягушка', int: '100' }]),
      'membership.html',
    );
    const missingMembership = generateKlevalkaCatches({
      pages: [page],
      catalog: { ...CATALOG, memberships: [] },
      datasetId: 'test-dataset',
    });
    assert.equal(missingMembership.generatedCount, 0);
    assert.equal(missingMembership.reviewRows[0]?.issues[0]?.code, 'FISH_NOT_IN_BASE');

    const missingBounds = generateKlevalkaCatches({
      pages: [page],
      catalog: {
        ...CATALOG,
        memberships: [
          {
            fishingBaseId: 'base-amur',
            fishId: 'fish-burbot',
            minWeightGrams: null,
            maxWeightGrams: 1_000,
          },
        ],
      },
      datasetId: 'test-dataset',
    });
    assert.equal(missingBounds.generatedCount, 0);
    assert.equal(missingBounds.reviewRows[0]?.issues[0]?.code, 'WEIGHT_BOUNDS_MISSING');
  });

  void it('accepts an explicit reviewed mapping to a current catalog ID', () => {
    const page = parseKlevalkaHtml(
      pageHtml([{ fish: 'Налим', bait: 'лягуха из Клевалки', int: '1' }]),
      'reviewed.html',
    );
    const sourceId = page.rows[0]?.sourceId;
    assert.ok(sourceId);
    const result = generateKlevalkaCatches({
      pages: [page],
      catalog: CATALOG,
      datasetId: 'test-dataset',
      decisions: [
        {
          sourceId,
          action: 'MAP',
          reason: 'Reviewed Klevalka alias for the canonical bait',
          baitId: 'bait-frog',
        },
      ],
    });
    assert.equal(result.generatedCount, 1);
    assert.equal(result.reviewRows[0]?.status, 'RESOLVED');
    assert.equal(result.reviewRows[0]?.decision?.action, 'MAP');
  });

  void it('emits plain lines that round-trip through the existing parser without observations', async () => {
    const { result } = generated([{ fish: 'Налим', bait: 'Лягушка', int: '1' }]);
    const file = result.generatedFiles[0];
    assert.ok(file);
    assert.match(file.relativePath, /^catches\/амур--base-amur\.part-0001\.txt$/u);
    assert.match(file.content, /^Налим \d+ грамм\. Поймана на Амур: Тихая протока, Лягушка\.\n$/u);
    const retained = result.retainedRows[0];
    assert.ok(retained);
    assert.equal(
      formatKlevalkaCatchLine(retained, 321),
      'Налим 321 грамм. Поймана на Амур: Тихая протока, Лягушка.',
    );
    assert.equal(
      formatKlevalkaCatchLine(retained, 12_345),
      'Налим 12,345 кг. Поймана на Амур: Тихая протока, Лягушка.',
    );

    const parser = new CatchReportParserService({
      fishingBase: { findMany: () => Promise.resolve([{ id: 'base-amur', name: 'Амур' }]) },
      fish: { findMany: () => Promise.resolve([{ id: 'fish-burbot', name: 'Налим' }]) },
      bait: {
        findMany: () => Promise.resolve([{ id: 'bait-frog', name: 'Лягушка', type: 'BAIT' }]),
      },
      screenAnchor: { findMany: () => Promise.resolve([]) },
      location: {
        findMany: () =>
          Promise.resolve([
            { id: 'location-creek', fishingBaseId: 'base-amur', number: 1, name: 'Тихая протока' },
          ]),
      },
      fishingBaseFish: {
        findMany: () => Promise.resolve([{ fishingBaseId: 'base-amur', fishId: 'fish-burbot' }]),
      },
    } as never);
    const parsed = await parser.parseBatch(file.content);
    assert.equal(parsed.rows.length, 1);
    const draft = parsed.rows[0]?.draft;
    assert.equal(draft?.canConfirm, true);
    assert.equal(draft?.fields.fish.value?.id, 'fish-burbot');
    assert.equal(draft?.fields.fishingBase.value?.id, 'base-amur');
    assert.equal(draft?.fields.location.value?.id, 'location-creek');
    assert.equal(draft?.fields.bait.value?.id, 'bait-frog');
    assert.equal(draft?.fields.holeDepthCm.value, null);
    assert.equal(draft?.fields.spotPositionRaw.value, null);
    assert.equal(draft?.fields.fishingNote.value, null);
    assert.equal(draft?.fields.userNoteRaw.value, null);

    const kilogramLine = formatKlevalkaCatchLine(retained, 12_345);
    const kilogramDraft = (await parser.parseBatch(kilogramLine)).rows[0]?.draft;
    assert.ok(kilogramDraft);
    assert.equal(kilogramDraft.canConfirm, true);
    assert.equal(kilogramDraft.fields.weightGrams.value, 12_345);
    assert.equal(kilogramDraft.fields.holeDepthCm.value, null);
    assert.equal(kilogramDraft.fields.spotPositionRaw.value, null);
    assert.equal(kilogramDraft.fields.fishingNote.value, null);
    assert.equal(kilogramDraft.fields.userNoteRaw.value, null);
  });

  void it('formats canonical notebook weights exactly at the gram/kilogram boundary', () => {
    assert.equal(formatKlevalkaWeight(1), '1 грамм');
    assert.equal(formatKlevalkaWeight(999), '999 грамм');
    assert.equal(formatKlevalkaWeight(1_000), '1,000 кг');
    assert.equal(formatKlevalkaWeight(1_001), '1,001 кг');
    assert.equal(formatKlevalkaWeight(12_034), '12,034 кг');
    assert.throws(() => formatKlevalkaWeight(0), /positive integer/u);
    assert.throws(() => formatKlevalkaWeight(1.5), /positive integer/u);
  });

  void it('requires explicit absolute source and external-workspace arguments', () => {
    assert.throws(() => parseKlevalkaGeneratorCommand([]), /usage/u);
    assert.throws(
      () =>
        parseKlevalkaGeneratorCommand(['--source', 'source.html', '--workspace', '/tmp/output']),
      /--source must be an absolute path/u,
    );
    assert.deepEqual(
      parseKlevalkaGeneratorCommand([
        '--source',
        '/tmp/source.html',
        '--workspace',
        '/tmp/output',
        '--max-tuples',
        '3',
      ]),
      {
        sourcePath: '/tmp/source.html',
        workspacePath: '/tmp/output',
        datasetId: 'klevalka-html-v1',
        maxTuples: 3,
        decisionsPath: undefined,
      },
    );
  });
});
