import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CatchReportDraft, DraftField } from './catch-report-parser.types.js';
import { CatchReportParserService } from './catch-report-parser.service.js';

const BASES = [
  { id: 'base-amur', name: 'Амур', nameNormalized: 'амур' },
  {
    id: 'base-tanzania',
    name: 'Озера Танзании',
    nameNormalized: 'озера танзании',
  },
] as const;

const LOCATIONS = [
  {
    id: 'location-amur',
    fishingBaseId: 'base-amur',
    number: 1,
    name: 'Протока бешеная - створы',
    nameNormalized: 'протока бешеная - створы',
  },
  {
    id: 'location-tanzania',
    fishingBaseId: 'base-tanzania',
    number: 2,
    name: 'Берег слоновьего бивня',
    nameNormalized: 'берег слоновьего бивня',
  },
] as const;

const FISH = [
  { id: 'fish-kizhuch', name: 'Кижуч', nameNormalized: 'кижуч' },
  {
    id: 'fish-zherekh',
    name: 'Жерех-лысач',
    nameNormalized: 'жерех-лысач',
  },
  { id: 'fish-saithe', name: 'Сайда', nameNormalized: 'сайда' },
  { id: 'fish-zheltoshchek', name: 'Желтощек', nameNormalized: 'желтощек' },
  {
    id: 'fish-shambardia',
    name: 'Шамбардия Валберга',
    nameNormalized: 'шамбардия валберга',
  },
] as const;

const BAITS = [
  { id: 'bait-vib', name: 'Vib-rapan', nameNormalized: 'vib-rapan', type: 'LURE' },
  { id: 'bait-vob', name: 'Vob-3006', nameNormalized: 'vob-3006', type: 'LURE' },
  { id: 'bait-pilk', name: 'Pilk-107', nameNormalized: 'pilk-107', type: 'LURE' },
  {
    id: 'bait-meat',
    name: 'Мясо шашеня',
    nameNormalized: 'мясо шашеня',
    type: 'BAIT',
  },
  {
    id: 'bait-live',
    name: 'Большой живец',
    nameNormalized: 'большой живец',
    type: 'BAIT',
  },
  { id: 'bait-bloodworm', name: 'Мотыль', nameNormalized: 'мотыль', type: 'BAIT' },
] as const;

const ANCHORS = [
  { name: 'Удочка', nameNormalized: 'удочка' },
  { name: 'Леска', nameNormalized: 'леска' },
  { name: 'Блокнот', nameNormalized: 'блокнот' },
  { name: 'Чат', nameNormalized: 'чат' },
] as const;

interface FixtureOptions {
  withoutMembership?: boolean;
  withoutBaits?: boolean;
}

function fixtureService(options: FixtureOptions = {}): CatchReportParserService {
  const prisma = {
    fishingBase: {
      findFirst: ({ where }: { where: { nameNormalized: string } }) =>
        Promise.resolve(BASES.find((base) => base.nameNormalized === where.nameNormalized) ?? null),
    },
    fish: {
      findFirst: ({ where }: { where: { nameNormalized: string } }) =>
        Promise.resolve(FISH.find((fish) => fish.nameNormalized === where.nameNormalized) ?? null),
    },
    location: {
      findMany: ({ where }: { where: { fishingBaseId: string } }) =>
        Promise.resolve(
          LOCATIONS.filter((location) => location.fishingBaseId === where.fishingBaseId),
        ),
    },
    bait: {
      findMany: () => Promise.resolve(options.withoutBaits === true ? [] : BAITS),
    },
    screenAnchor: {
      findMany: () => Promise.resolve(ANCHORS),
    },
    fishingBaseFish: {
      findUnique: () =>
        Promise.resolve(
          options.withoutMembership === true
            ? null
            : { fishingBaseId: 'base-amur', fishId: 'fish' },
        ),
    },
  } as unknown as PrismaService;

  return new CatchReportParserService(prisma);
}

function amurLine(fish: string, weight: string, baitAndSuffix: string): string {
  return `${fish} ${weight}. Поймана на Амур: Протока бешеная - створы, ${baitAndSuffix}`;
}

function resolvedValue<T>(field: DraftField<T>): T | null {
  assert.equal(field.status, 'RESOLVED');
  return field.value;
}

async function parse(raw: string, options?: FixtureOptions): Promise<CatchReportDraft> {
  return (await fixtureService(options).parse(raw)).draft;
}

void describe('CatchReportParserService', () => {
  void it('returns a confirmable SPINNING draft when the game omitted size and speed', async () => {
    const draft = await parse(amurLine('Кижуч', '7,242 кг', 'Vib-rapan.'));

    assert.equal(resolvedValue(draft.fields.weightGrams), 7_242);
    assert.equal(resolvedValue(draft.fields.fishingMethod), 'SPINNING');
    assert.equal(draft.fields.holeDepthCm.status, 'RESOLVED');
    assert.equal(draft.fields.holeDepthCm.value, null);
    assert.equal(resolvedValue(draft.fields.spinningSize), null);
    assert.equal(draft.fields.spinningSize.required, false);
    assert.equal(resolvedValue(draft.fields.spinningSpeed), null);
    assert.equal(draft.fields.spinningSpeed.required, false);
    assert.equal(draft.canConfirm, true);
  });

  void it('parses textual spinning parameters into a confirmable draft', async () => {
    const draft = await parse(amurLine('Жерех-лысач', '3,747 кг', 'Vob-3006. ср. медл'));

    assert.equal(resolvedValue(draft.fields.weightGrams), 3_747);
    assert.equal(resolvedValue(draft.fields.spinningSize), 'MEDIUM');
    assert.equal(resolvedValue(draft.fields.spinningSpeed), 'SLOW');
    assert.equal(draft.canConfirm, true);
  });

  void it('proposes a clear comment without losing the original source', async () => {
    const raw = amurLine(
      'Жерех-лысач',
      '1,449 кг',
      'Vob-3006, ср., проводка медленная.\nПоймал сразу, первую и зачетную. Наверное, повезло)',
    );
    const draft = await parse(raw);

    assert.equal(draft.rawSourceText, raw);
    assert.equal(resolvedValue(draft.fields.spinningSize), 'MEDIUM');
    assert.equal(resolvedValue(draft.fields.spinningSpeed), 'SLOW');
    assert.equal(
      resolvedValue(draft.fields.userNoteRaw),
      'Поймал сразу, первую и зачетную. Наверное, повезло)',
    );
  });

  void it('resolves Pilk-107 before parsing the following hole', async () => {
    const draft = await parse(amurLine('Сайда', '25,101 кг', 'Pilk-107.ср\\м 10.78 чат'));

    assert.equal(resolvedValue(draft.fields.bait)?.name, 'Pilk-107');
    assert.equal(resolvedValue(draft.fields.weightGrams), 25_101);
    assert.equal(resolvedValue(draft.fields.spinningSize), 'MEDIUM');
    assert.equal(resolvedValue(draft.fields.spinningSpeed), 'SLOW');
    assert.equal(resolvedValue(draft.fields.holeDepthCm), 1_078);
    assert.equal(resolvedValue(draft.fields.spotPositionRaw), 'чат');
    assert.equal(draft.canConfirm, true);
  });

  void it('keeps unknown bait suffix text as a non-blocking unresolved fragment', async () => {
    const draft = await parse(
      amurLine('Сайда', '21,257 кг', 'Мясо шашеня.14.68 блокнот.игродень.'),
    );

    assert.equal(resolvedValue(draft.fields.fishingMethod), 'BAIT_FISHING');
    assert.equal(resolvedValue(draft.fields.holeDepthCm), 1_468);
    assert.equal(resolvedValue(draft.fields.spotPositionRaw), 'блокнот');
    assert.deepEqual(
      draft.unresolvedFragments.map((fragment) => fragment.text),
      ['игродень'],
    );
    assert.ok(draft.issues.some((issue) => issue.severity === 'WARNING'));
    assert.equal(draft.canConfirm, true);
  });

  void it('keeps meaningful text before the catch clause as a warning fragment', async () => {
    const raw =
      'Жерех-лысач 3,747 кг. СКРЫТЫЙ ФРАГМЕНТ Поймана на Амур: Протока бешеная - створы, Vob-3006. ср/м';
    const draft = await parse(raw);

    assert.deepEqual(
      draft.unresolvedFragments.map((fragment) => fragment.text),
      ['. СКРЫТЫЙ ФРАГМЕНТ'],
    );
    assert.ok(draft.issues.some((issue) => issue.severity === 'WARNING'));
    assert.equal(draft.canConfirm, true);
  });

  void it('warns and produces null for invalid optional textual observations', async () => {
    const longPosition = await parse(
      amurLine('Желтощек', '42,861 кг', `Большой живец 3.61 уда ${'х'.repeat(1_000)}`),
    );
    assert.equal(resolvedValue(longPosition.fields.spotPositionRaw), null);
    assert.ok(longPosition.issues.some((issue) => issue.code === 'UNRESOLVED_FRAGMENT'));

    const longComment = await parse(
      amurLine('Жерех-лысач', '3,747 кг', `Vob-3006. ср/м\n${'А'.repeat(1_001)}`),
    );
    assert.ok(longComment.issues.some((issue) => issue.code === 'INVALID_USER_NOTE_RAW'));
    assert.equal(longComment.fields.userNoteRaw.status, 'UNRESOLVED');
    assert.equal(longComment.canConfirm, true);
  });

  void it('preserves a complex BAIT position and conservative alias exactly', async () => {
    const draft = await parse(
      amurLine('Желтощек', '42,861 кг', 'Большой живец 3.61 уда-леска надпись нахлыст.'),
    );

    assert.equal(resolvedValue(draft.fields.holeDepthCm), 361);
    assert.equal(resolvedValue(draft.fields.spotPositionRaw), 'уда-леска надпись нахлыст');
  });

  void it('keeps a resolved BAIT draft confirmable when the game omitted the hole', async () => {
    const draft = await parse(amurLine('Желтощек', '42,861 кг', 'Большой живец.'));

    assert.equal(resolvedValue(draft.fields.weightGrams), 42_861);
    assert.equal(resolvedValue(draft.fields.fishingMethod), 'BAIT_FISHING');
    assert.equal(resolvedValue(draft.fields.holeDepthCm), null);
    assert.equal(draft.fields.holeDepthCm.required, false);
    assert.equal(draft.missingRequiredFields.includes('holeDepthCm'), false);
    assert.equal(draft.canConfirm, true);
  });

  void it('parses the original project BAIT example', async () => {
    const raw =
      'Шамбардия Валберга 40 грамм. Поймана на Озера Танзании: Берег слоновьего бивня, Мотыль. ямка 6,00 удочка';
    const draft = await parse(raw);

    assert.equal(resolvedValue(draft.fields.weightGrams), 40);
    assert.equal(resolvedValue(draft.fields.fishingMethod), 'BAIT_FISHING');
    assert.equal(resolvedValue(draft.fields.holeDepthCm), 600);
    assert.equal(resolvedValue(draft.fields.spotPositionRaw), 'удочка');
    assert.deepEqual(draft.unresolvedFragments, []);
    assert.equal(
      draft.issues.some((issue) => issue.code === 'UNRESOLVED_FRAGMENT'),
      false,
    );
    assert.equal(draft.canConfirm, true);
  });

  void it('returns an incomplete Draft rather than failing for a suffix-only observation', async () => {
    const raw = 'ямка 7,63 вполводы';
    const draft = await parse(raw);

    assert.equal(resolvedValue(draft.fields.holeDepthCm), 763);
    assert.equal(resolvedValue(draft.fields.fishingNote), 'MIDWATER');
    assert.equal(draft.fields.fish.status, 'MISSING');
    assert.equal(draft.fields.bait.status, 'MISSING');
    assert.equal(draft.canConfirm, false);
  });

  void it('keeps resolved entities but blocks a missing Base/Fish membership', async () => {
    const draft = await parse(amurLine('Кижуч', '7,242 кг', 'Vob-3006. ср/м'), {
      withoutMembership: true,
    });

    assert.equal(draft.fields.fishingBase.status, 'RESOLVED');
    assert.equal(draft.fields.fish.status, 'RESOLVED');
    assert.equal(draft.baseFishMembership.status, 'UNRESOLVED');
    assert.ok(draft.issues.some((issue) => issue.code === 'FISH_NOT_IN_BASE'));
    assert.equal(draft.canConfirm, false);
  });

  void it('does not fuzzy-match catalog text and reports the derived method unresolved', async () => {
    const draft = await parse(amurLine('Кижуч', '7,242 кг', 'Vib-rapann. ср/м'));

    assert.equal(draft.fields.bait.status, 'UNRESOLVED');
    assert.equal(draft.fields.fishingMethod.status, 'UNRESOLVED');
    assert.equal(draft.canConfirm, false);
  });

  void it('honestly leaves Bait and method unresolved when the catalog has no Baits', async () => {
    const draft = await parse(amurLine('Кижуч', '7,242 кг', 'Vib-rapan.'), { withoutBaits: true });

    assert.equal(draft.fields.bait.status, 'UNRESOLVED');
    assert.equal(draft.fields.fishingMethod.status, 'UNRESOLVED');
  });

  void it('returns only public catalog values in Draft entities', async () => {
    const draft = await parse(amurLine('Кижуч', '7,242 кг', 'Vob-3006. ср/м'));

    assert.deepEqual(resolvedValue(draft.fields.location), {
      id: 'location-amur',
      number: 1,
      name: 'Протока бешеная - створы',
    });
    assert.deepEqual(resolvedValue(draft.fields.bait), {
      id: 'bait-vob',
      name: 'Vob-3006',
      type: 'LURE',
    });
  });
});
