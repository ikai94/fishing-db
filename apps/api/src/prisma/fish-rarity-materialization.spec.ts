import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  buildFishRarityMaterializationPlan,
  validateFishRarityManifest,
  type LiveFishRarityRow,
} from './fish-rarity-materialization.js';
import { parseFishRarityMaterializationCommand } from './materialize-fish-rarity.js';

const manifest = validateFishRarityManifest(
  JSON.parse(
    readFileSync(
      new URL('../../prisma/catalog-data/fish-rarity-20260910.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
);

const reviewedMappings = [
  ['Рыба-ремень', 'Рыба-ремень, сельдяной король'],
  ['Чешуеед', 'Чешуеед, Плагиотрем чешуеедный'],
  ['Морская свинья обыкн', 'Морская свинья обыкновенная'],
  ['Акула китовая альбинос', 'Китовая акула - альбинос'],
  ['Акула-квагга', 'Акула - квагга'],
  ['Кит бискайский', 'Кит Бискайский'],
  ['Шипощек длинноперый', 'Шипощёк длинноперый'],
  ['Черепахоголов Сейнеджера', 'Черепахоголов Стейнеджера'],
  ['Змееголов золотая кобра', 'Змееголов Золотая кобра'],
  ['Группер малабарский', 'Группер Малабарский'],
  ['Морская свинья беспёрая', 'Морская свинья бесперая'],
  ['Цетрина австралийская', 'Центрина австралийская'],
  ['Акула австрал.головастая', 'Акула австралийская головастая'],
  ['Подкамещик пестроногий', 'Подкаменщик пестроногий'],
] as const;

const approvedExtensionMappings = [
  ['Антимора клюворылая', 'Антимора клювокрылая'],
  ['Асаги', 'Кои Асаги'],
  ['Голец дальнеозерский', 'Голец Дальнеозерский'],
  ['Голец узонский', 'Голец Узонский'],
  ['Кит горбатый альбинос', 'Кит горбатый(альбинос)'],
  ['Кит синий альбинос', 'Кит синий (альбинос)'],
  ['Морская очковая свинья', 'Морская свинья очковая'],
  ['Сельдяной король', 'Рыба-ремень, сельдяной король'],
  ['Скат-кукушка', 'Скат - кукушка'],
  ['Утсури', 'Кои Утсури'],
] as const;

const exactExtension = [
  'Акула-домовой',
  'Акула исландская',
  'Акула копьезубая',
  'Акула коромандельская',
  'Акула мозамбикская бычья',
  'Акула Мицукури',
  'Амия',
  'Багре хигучи',
  'Белокровка Ричардсона',
  'Белокровка большеглазая',
  'Галаксия чилийская',
  'Гигантская тридакна',
  'Группер индоокеанский малоглазый',
  'Кайман широкомордый',
  'Катран вануатский',
  'Кашалот-альбинос',
  'Кижуч озерный',
  'Кит гренландский',
  'Конус березовый',
  'Конус мраморный',
  'Костерь',
  'Кракен',
  'Лазианциструс',
  'Мерценария Стимпсона',
  'Морской монах',
  'Мурена европейская',
  'Омуль баргузинский',
  'Осетр белый',
  'Осетр тихоокеанский',
  'Павлиний окунь королевский',
  'Пиранья крапчатая',
  'Плавун южный',
  'Ремнезуб командорский',
  'Ремнезуб перуанский',
  'Рыба-капля',
  'Скат гладкий',
  'Сферомия пятнистая',
  'Тигровая рыба обыкновенная',
  'Тифобия',
  'Утконос',
  'Форель апачей',
  'Форель остроголовая',
  'Хендфиш',
  'Целакант',
  'Эферия эллиптическая',
  'Японский краб-стригун',
] as const;

function currentCatalog(isMaterialized: boolean): LiveFishRarityRow[] {
  const targets = manifest.fish.map((name, index) => ({
    id: `target-${String(index)}`,
    name,
    isRarest: isMaterialized,
  }));
  const other = Array.from({ length: 1_176 }, (_, index) => ({
    id: `other-${String(index)}`,
    name: `Обычный вид ${String(index).padStart(4, '0')}`,
    isRarest: false,
  }));
  return [...targets, ...other];
}

void describe('Fish rarity materialization', () => {
  void it('keeps exactly the approved 295 canonical names in versioned catalog data', () => {
    assert.equal(manifest.fish.length, 295);
    assert.equal(new Set(manifest.fish).size, 295);
    assert.equal(manifest.expectedFishCount, 1_471);
    assert.equal(exactExtension.length + approvedExtensionMappings.length, 56);
    for (const [input, canonical] of [...reviewedMappings, ...approvedExtensionMappings]) {
      assert.equal(
        manifest.fish.includes(canonical),
        true,
        `missing reviewed target: ${canonical}`,
      );
      assert.equal(manifest.fish.includes(input), false, `retained non-canonical input: ${input}`);
    }
    for (const name of exactExtension) {
      assert.equal(manifest.fish.includes(name), true, `missing exact extension: ${name}`);
    }
  });

  void it('plans exactly 295 rarest and 1176 non-rarest Fish, then becomes idempotent', () => {
    const first = buildFishRarityMaterializationPlan({
      manifest,
      manifestSha256: 'a'.repeat(64),
      liveFish: currentCatalog(false),
    });
    assert.deepEqual(first.blockers, []);
    assert.deepEqual(first.counts, {
      fish: 1_471,
      rareBefore: 0,
      rareAfter: 295,
      notRareAfter: 1_176,
      writes: 295,
    });
    assert.equal(
      first.changes.every((change) => change.desiredIsRarest),
      true,
    );

    const second = buildFishRarityMaterializationPlan({
      manifest,
      manifestSha256: 'a'.repeat(64),
      liveFish: currentCatalog(true),
    });
    assert.deepEqual(second.blockers, []);
    assert.equal(second.counts.writes, 0);
  });

  void it('blocks an incomplete or drifted live catalog', () => {
    const liveFish = currentCatalog(false).slice(1);
    const plan = buildFishRarityMaterializationPlan({
      manifest,
      manifestSha256: 'a'.repeat(64),
      liveFish,
    });
    assert.equal(
      plan.blockers.some((issue) => issue.startsWith('Fish count is ')),
      true,
    );
    assert.equal(
      plan.blockers.some((issue) => issue.startsWith('manifest Fish is missing: ')),
      true,
    );
  });

  void it('requires an explicit guarded apply fingerprint', () => {
    assert.deepEqual(parseFishRarityMaterializationCommand(['--dry-run']), { mode: 'DRY_RUN' });
    assert.deepEqual(
      parseFishRarityMaterializationCommand([
        '--apply',
        `--expected-plan-fingerprint=${'b'.repeat(64)}`,
      ]),
      { mode: 'APPLY', expectedPlanFingerprint: 'b'.repeat(64) },
    );
    assert.throws(() => parseFishRarityMaterializationCommand(['--apply']), /usage/u);
  });
});
