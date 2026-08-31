import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveExternalContributorKey } from '../identity.js';
import { parseForum83Post, type Forum83ParserContext } from './parser.js';

const CONTEXT: Forum83ParserContext = {
  baseName: 'Ахтуба',
  locationNames: ['Степной оазис', 'Сазаний куст'],
  fishNames: ['Белый амур', 'Карп зеркальный', 'Сазан', 'Рак', 'Тасманский рак'],
  baitNames: ['Помидоры', 'Кукуруза', 'Макуха', 'Живец', 'Кусочки рыбы', 'Deep-107', 'X-Tail-13'],
};

void describe('forum83 Base-topic post parser', () => {
  void it('emits zero candidates for advice, fish lists, ranges, and sale summaries', () => {
    const candidates = parseForum83Post(
      post(
        [
          'Список рыб обитающих на водоёме: Белый амур, Сазан.',
          'В ямах ловится сазан до 50 кг на макуху.',
          'Самая дорогая рыба: Сазан 49,755 кг - 31280 руб.',
        ].join('\n'),
      ),
      CONTEXT,
    );
    assert.deepEqual(candidates, []);
  });

  void it('extracts multiple generated catch lines with explicit Location context', () => {
    const candidates = parseForum83Post(
      post(
        [
          'Белый амур 14,557 кг. Поймана на Ахтуба: Степной оазис, Помидоры.',
          'Карп зеркальный 32,5 кг. Поймана на Ахтуба: Степной оазис, Кукуруза.',
        ].join('\n'),
      ),
      CONTEXT,
    );
    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.map((candidate) => ({
        ordinal: candidate.candidateOrdinal,
        fish: candidate.fishNameRaw,
        weight: candidate.weightGrams,
        base: candidate.fishingBaseRaw,
        location: candidate.locationRaw,
        bait: candidate.baitRaw,
        context: candidate.forum83.locationContext,
      })),
      [
        {
          ordinal: 1,
          fish: 'Белый амур',
          weight: 14_557,
          base: 'Ахтуба',
          location: 'Степной оазис',
          bait: 'Помидоры',
          context: 'EXPLICIT',
        },
        {
          ordinal: 2,
          fish: 'Карп зеркальный',
          weight: 32_500,
          base: 'Ахтуба',
          location: 'Степной оазис',
          bait: 'Кукуруза',
          context: 'EXPLICIT',
        },
      ],
    );
    assert.equal(candidates[0]?.contributorKey, deriveExternalContributorKey('42'));
    assert.match(
      candidates[0]?.importKey ?? '',
      /^external:rus-fishsoft:forum83:observation:v1:[0-9a-f]{64}$/u,
    );
  });

  void it('inherits only an exact Location header from the same paragraph', () => {
    const [candidate] = parseForum83Post(
      post(['Локация: Степной оазис', 'Белый амур 14,557 кг. Поймана на Помидоры.'].join('\n')),
      CONTEXT,
    );
    assert.equal(candidate?.locationRaw, 'Степной оазис');
    assert.equal(candidate?.baitRaw, 'Помидоры');
    assert.equal(candidate?.forum83.locationContext, 'INHERITED');

    assert.deepEqual(
      parseForum83Post(
        post(['Локация: степной-оазис', 'Белый амур 14,557 кг. Поймана на Помидоры.'].join('\n')),
        CONTEXT,
      ),
      [],
    );
  });

  void it('prefers the longest exact Fish name when canonical names overlap', () => {
    const [candidate] = parseForum83Post(
      post('Тасманский рак 4,193 кг. Поймана на Ахтуба: Степной оазис, Живец.'),
      CONTEXT,
    );
    assert.equal(candidate?.fishNameRaw, 'Тасманский рак');
  });

  void it('extracts an exact Fish suffix concatenated to preceding prose', () => {
    const [candidate] = parseForum83Post(
      post(
        'это самый крупняк на одной локеБелый амур 14,557 кг. Поймана на Ахтуба: Степной оазис, Помидоры.',
      ),
      CONTEXT,
    );
    assert.equal(candidate?.fishNameRaw, 'Белый амур');
    assert.equal(candidate?.technical.sourceText.startsWith('Белый амур'), true);
  });

  void it('splits only exact Bait prefixes from recognized observations', () => {
    const [depth, spinning, note, secondNote, unknown] = parseForum83Post(
      post(
        [
          'Сазан 49,755 кг. Поймана на Ахтуба: Сазаний куст, Кусочки рыбы, 29.59 снасти.',
          'Сазан 48,755 кг. Поймана на Ахтуба: Сазаний куст, Deep-107 Большая.',
          'Сазан 47,755 кг. Поймана на Ахтуба: Сазаний куст, X-Tail-13.(с 4-5 утра)',
          'Сазан 47,255 кг. Поймана на Ахтуба: Сазаний куст, X-Tail-13.(2 часа ночи)',
          'Сазан 46,755 кг. Поймана на Ахтуба: Сазаний куст, Pilk-1.',
        ].join('\n'),
      ),
      CONTEXT,
    );
    assert.deepEqual(
      {
        bait: depth?.baitRaw,
        depth: depth?.holeDepthCm,
        spot: depth?.spotPositionRaw,
      },
      { bait: 'Кусочки рыбы', depth: 2_959, spot: 'снасти' },
    );
    assert.deepEqual(
      { bait: spinning?.baitRaw, size: spinning?.spinningSize },
      { bait: 'Deep-107', size: 'LARGE' },
    );
    assert.deepEqual(
      { bait: note?.baitRaw, note: note?.userNoteRaw },
      { bait: 'X-Tail-13', note: '(с 4-5 утра)' },
    );
    assert.deepEqual(
      { bait: secondNote?.baitRaw, note: secondNote?.userNoteRaw },
      { bait: 'X-Tail-13', note: '(2 часа ночи)' },
    );
    assert.equal(unknown?.baitRaw, 'Pilk-1');
  });

  void it('keeps topic Base authoritative and blocks a conflicting embedded Base', () => {
    const [candidate] = parseForum83Post(
      post('Сазан 49,755 кг. Поймана на Волга: Сазаний куст, Макуха.'),
      CONTEXT,
    );
    assert.equal(candidate?.fishingBaseRaw, 'Ахтуба');
    assert.deepEqual(candidate?.issues, [
      { code: 'AMBIGUOUS_CANDIDATE_FIELD', field: 'fishingBaseRaw' },
    ]);
  });

  void it('applies only bounded exact-prefix cleanup to noisy Bait source text', () => {
    const context = {
      ...CONTEXT,
      baitNames: [...CONTEXT.baitNames, 'Circl-5000', 'Опарыш'],
    };
    const [lure, prefixedLocation] = parseForum83Post(
      post(
        [
          'Сазан 49,755 кг. Поймана на Ахтуба: Сазаний куст, Circl-5000м-м.',
          'Сазан 48,755 кг. Поймана на Ахтуба: Сазаний куст, 3 лока Опарыш.',
        ].join('\n'),
      ),
      context,
    );
    assert.equal(lure?.baitRaw, 'Circl-5000');
    assert.equal(prefixedLocation?.baitRaw, 'Опарыш');
  });

  void it('leaves reviewed and rejected Bait raw values intact for explicit resolution', () => {
    const [reviewed, rejected] = parseForum83Post(
      post(
        [
          'Сазан 49,755 кг. Поймана на Ахтуба: Сазаний куст, живец перехват.',
          'Сазан 48,755 кг. Поймана на Ахтуба: Сазаний куст, Геркулес, мотыль опарыш.',
        ].join('\n'),
      ),
      CONTEXT,
    );
    assert.equal(reviewed?.baitRaw, 'живец перехват');
    assert.equal(rejected?.baitRaw, 'Геркулес, мотыль опарыш');
  });

  void it('accepts the bounded numbered Location form only when its name is exact', () => {
    const context = { ...CONTEXT, locationNames: [...CONTEXT.locationNames, 'Остров людоеда'] };
    const [exact, unknown] = parseForum83Post(
      post(
        [
          'Сазан 49,755 кг. Поймана на Ахтуба: локация № 8 Остров людоеда, Макуха.',
          'Сазан 48,755 кг. Поймана на Ахтуба: локация № 9 Неизвестная, Макуха.',
        ].join('\n'),
      ),
      context,
    );
    assert.equal(exact?.locationRaw, 'Остров людоеда');
    assert.equal(unknown?.locationRaw, 'локация № 9 Неизвестная');
  });

  void it('accepts only the reviewed embedded Base spelling equivalence', () => {
    const [candidate] = parseForum83Post(
      post('Сазан 49,755 кг. Поймана на Хопер: Сазаний куст, Макуха.'),
      { ...CONTEXT, baseName: 'Хопёр' },
    );
    assert.deepEqual(candidate?.issues, []);
    assert.equal(candidate?.fishingBaseRaw, 'Хопёр');
  });
});

function post(bodyText: string) {
  return {
    subforumId: '83',
    topicId: '357',
    postId: '510',
    memberId: '42',
    topicTitle: 'Ахтуба',
    bodyText,
  };
}
