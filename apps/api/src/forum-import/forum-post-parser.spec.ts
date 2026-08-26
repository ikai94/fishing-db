import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TechnicalForumPost } from './candidate-types.js';
import { parseForumPost } from './forum-post-parser.js';

function post(bodyText: string, overrides: Partial<TechnicalForumPost> = {}): TechnicalForumPost {
  return {
    subforumId: '70',
    topicId: '701',
    postId: '9001',
    memberId: '42',
    topicTitle: 'Белорыбица',
    bodyText,
    ...overrides,
  };
}

function generated(observation: string): string {
  return `Белорыбица 7,242 кг. Поймана на Амур: Протока, Мотыль. ${observation}`;
}

void describe('rus-fishsoft forum post parser', () => {
  void it('extracts a generated catch and leaves fishingMethod for exact Bait resolution', () => {
    const [candidate] = parseForumPost(post(generated('12,22 лев.край снастей вполводы')));

    assert.ok(candidate);
    assert.equal(candidate.fishNameRaw, 'Белорыбица');
    assert.equal(candidate.weightGrams, 7_242);
    assert.equal(candidate.fishingBaseRaw, 'Амур');
    assert.equal(candidate.locationRaw, 'Протока');
    assert.equal(candidate.baitRaw, 'Мотыль');
    assert.equal(candidate.fishingMethod, null);
    assert.equal(candidate.holeDepthCm, 1_222);
    assert.equal(candidate.spotPositionRaw, 'лев.край снастей');
    assert.equal(candidate.fishingNote, 'MIDWATER');
    assert.deepEqual(candidate.issues, []);
  });

  void it('supplements only the approved adjacent-line generated catch layout', () => {
    const [candidate] = parseForumPost(
      post('Белорыбица 7,242 кг.\nПоймана на Амур: Протока, Мотыль.'),
    );

    assert.ok(candidate);
    assert.equal(candidate.fishNameRaw, 'Белорыбица');
    assert.equal(candidate.weightGrams, 7_242);
    assert.equal(candidate.fishingBaseRaw, 'Амур');
    assert.equal(candidate.locationRaw, 'Протока');
    assert.equal(candidate.baitRaw, 'Мотыль');
    assert.equal(candidate.holeDepthCm, null);
    assert.equal(candidate.spinningSize, null);
    assert.equal(candidate.spinningSpeed, null);

    assert.deepEqual(
      parseForumPost(post('Белорыбица 7,242 кг.\n\nПоймана на Амур: Протока, Мотыль.')),
      [],
    );
    assert.deepEqual(parseForumPost(post('Белорыбица 7,242 кг.\nПоймана на Мотыль.')), []);
    assert.deepEqual(
      parseForumPost(
        post(
          'Белорыбица 700 г - 1000 руб.\nБелорыбица 800 г - 1200 руб.\nПойманы на Амур: Протока, Мотыль.',
        ),
      ),
      [],
    );
  });

  void it('appends supplemental ordinals after every legacy candidate without shifting identity', () => {
    const supplemental = 'Белорыбица 7,242 кг.\nПоймана на Амур: Протока, Мотыль.';
    const legacy = generated('12,22 уда');
    const candidates = parseForumPost(post(`${supplemental}\n\n${legacy}`));

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.candidateOrdinal, 1);
    assert.equal(candidates[0]?.technical.sourceText, legacy);
    assert.equal(candidates[1]?.candidateOrdinal, 2);
    assert.equal(candidates[1]?.technical.sourceText, supplemental);
  });

  void it('parses approved bare comma/dot depths exactly without a hole word', () => {
    const cases = [
      ['12,22', 1_222, 'уда'],
      ['22.33', 2_233, 'ката'],
      ['1.22', 122, 'блокнот'],
      ['60.06', 6_006, 'алк-снасти'],
    ] as const;

    for (const [raw, expected, spot] of cases) {
      const [candidate] = parseForumPost(post(generated(`${raw} ${spot}`)));
      assert.equal(candidate?.holeDepthCm, expected, raw);
      assert.equal(candidate?.spotPositionRaw, spot, raw);
    }
  });

  void it('parses compact explicit depths with exact last-two-digit centimetres', () => {
    for (const [raw, expected, spot] of [
      ['831', 831, 'катушка'],
      ['3883', 3_883, 'события'],
      ['3363', 3_363, 'еда-алк'],
    ] as const) {
      const [candidate] = parseForumPost(post(generated(`ямка ${raw} ${spot}`)));
      assert.equal(candidate?.holeDepthCm, expected, raw);
      assert.equal(candidate?.spotPositionRaw, spot, raw);
      assert.deepEqual(candidate?.issues, [], raw);
    }
  });

  void it('does not backtrack a no-space decimal depth into whole metres', () => {
    const [candidate] = parseForumPost(post(generated('ямка 6.73над удочкой')));

    assert.equal(candidate?.holeDepthCm, 673);
    assert.equal(candidate?.spotPositionRaw, 'над удочкой');
  });

  void it('accepts compact tokens only at an isolated observation start, unlike one/two digits', () => {
    for (const raw of ['8', '31', '75']) {
      const [candidate] = parseForumPost(post(generated(`${raw} уда`)));
      assert.equal(candidate?.holeDepthCm, null, raw);
    }

    for (const [raw, expected] of [
      ['831', 831],
      ['3883', 3_883],
    ] as const) {
      const [candidate] = parseForumPost(post(generated(`${raw} уда`)));
      assert.equal(candidate?.holeDepthCm, expected, raw);
      assert.equal(candidate?.spotPositionRaw, 'уда', raw);
    }

    const [explicit] = parseForumPost(post(generated('ямка 8 уда')));
    assert.equal(explicit?.holeDepthCm, 800);

    const [hyphenSeparator] = parseForumPost(post(generated('ямка-3883 события')));
    assert.equal(hyphenSeparator?.holeDepthCm, 3_883);
    assert.equal(hyphenSeparator?.spotPositionRaw, 'события');
  });

  void it('consumes an explicit meter unit without consuming the start of an open position', () => {
    const [withUnit] = parseForumPost(post(generated('12,22 м лев.край снастей')));
    const [withoutUnit] = parseForumPost(post(generated('12,22 между чатом и игроками')));

    assert.equal(withUnit?.holeDepthCm, 1_222);
    assert.equal(withUnit?.spotPositionRaw, 'лев.край снастей');
    assert.equal(withoutUnit?.spotPositionRaw, 'между чатом и игроками');
  });

  void it('preserves open position phrases without a closed anchor enum', () => {
    const positions = [
      'уда',
      'удочка',
      'ката',
      'катушка',
      'алк',
      'снасти',
      'блокнот',
      'леска',
      'чат',
      'игроки',
      'ящик',
      'леска-чат',
      'блокн-удочка',
      'чат-игроки',
      'алк-снасти',
      'алк/снасти',
      'алк\\снасти',
      'над алкоголем',
      'между чатом и игроками',
      'левый край рюкзака',
      'лев.край снастей',
    ];

    for (const position of positions) {
      const [candidate] = parseForumPost(post(generated(`6,00 ${position}`)));
      assert.equal(candidate?.spotPositionRaw, position, position);
    }
  });

  void it('extracts each approved supplementary observation as userNoteRaw, not depth or issue', () => {
    for (const note of [
      'заброс с бугорка 6.76',
      'протяжка до горки 0,00',
      'дальний заброс',
      'нахлыст',
    ]) {
      const [candidate] = parseForumPost(post(generated(`12,22 уда. ${note}`)));
      assert.equal(candidate?.holeDepthCm, 1_222, note);
      assert.equal(candidate?.spotPositionRaw, 'уда', note);
      assert.equal(candidate?.userNoteRaw, note, note);
      assert.deepEqual(candidate?.issues, [], note);
      assert.equal(candidate?.technical.supplementarySourceRanges.length, 1, note);
    }
  });

  void it('keeps every separated supplementary observation in userNoteRaw', () => {
    const [candidate] = parseForumPost(post(generated('12,22 уда. дальний заброс; нахлыст')));

    assert.equal(candidate?.userNoteRaw, 'дальний заброс; нахлыст');
    assert.equal(candidate?.technical.supplementarySourceRanges.length, 2);
    assert.deepEqual(candidate?.issues, []);

    const [multiline] = parseForumPost(post(generated('12,22 уда. дальний заброс\nнахлыст')));
    assert.equal(multiline?.userNoteRaw, 'дальний заброс; нахлыст');
    assert.deepEqual(multiline?.issues, []);
  });

  void it('excludes weight, time, server, lure, and supplementary numbers before depth selection', () => {
    const [candidate] = parseForumPost(
      post(
        generated('в 14:30, сервер 2, приманка №17, вес 1,25 кг; 12,22 чат; заброс с бугорка 6.76'),
      ),
    );

    assert.equal(candidate?.holeDepthCm, 1_222);
    assert.equal(candidate?.spotPositionRaw, 'чат');
    assert.equal(candidate?.userNoteRaw, 'заброс с бугорка 6.76');
    assert.deepEqual(candidate?.issues, []);

    const [compactMetadata] = parseForumPost(
      post(generated('в 8:31, сервер 831, приманка №3883, вес 3363 г; 12,22 чат')),
    );
    assert.equal(compactMetadata?.holeDepthCm, 1_222);
    assert.equal(compactMetadata?.spotPositionRaw, 'чат');
  });

  void it('does not choose between multiple depth tokens', () => {
    const [candidate] = parseForumPost(post(generated('12,22 уда; 13,33 чат')));

    assert.equal(candidate?.holeDepthCm, null);
    assert.equal(candidate?.spotPositionRaw, null);
    assert.deepEqual(candidate?.issues, [{ code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' }]);

    const [commaSeparated] = parseForumPost(post(generated('5.30 рюкзак, 3,25 ката утро-вечер')));
    assert.equal(commaSeparated?.holeDepthCm, null);
    assert.equal(commaSeparated?.spotPositionRaw, null);
    assert.deepEqual(commaSeparated?.issues, [
      { code: 'AMBIGUOUS_HOLE_DEPTH', field: 'holeDepthCm' },
    ]);
  });

  void it('keeps malformed explicit depths unresolved instead of salvaging a prefix', () => {
    for (const raw of ['ямка -6,00 чат', 'яма 6,001 уда']) {
      const [candidate] = parseForumPost(post(generated(raw)));
      assert.equal(candidate?.holeDepthCm, null, raw);
      assert.deepEqual(
        candidate?.issues,
        [{ code: 'INVALID_HOLE_DEPTH', field: 'holeDepthCm' }],
        raw,
      );
    }
  });

  void it('keeps a generated candidate with an invalid unit-bearing weight for review', () => {
    const body = 'Белорыбица 7,2420 кг. Поймана на Амур: Протока, Мотыль. 12,22 уда';
    const [candidate] = parseForumPost(post(body));

    assert.equal(candidate?.fishNameRaw, 'Белорыбица');
    assert.equal(candidate?.weightGrams, null);
    assert.equal(candidate?.holeDepthCm, 1_222);
    assert.deepEqual(candidate?.issues, [{ code: 'INVALID_WEIGHT', field: 'weightGrams' }]);
  });

  void it('parses labeled partial candidates using the topic title and spinning settings', () => {
    const body = [
      'Вес: 850 г',
      'База: Амур',
      'Лока: Протока',
      'Приманка: Vib-rapan',
      'Глубина: 3363 между чатом и игроками',
      'Спиннинг: ср/м',
      'Условие: со дна',
    ].join('\n');
    const [candidate] = parseForumPost(post(body, { topicTitle: 'Белорыбица (северная форма)' }));

    assert.equal(candidate?.fishNameRaw, 'Белорыбица');
    assert.equal(candidate?.weightGrams, 850);
    assert.equal(candidate?.holeDepthCm, 3_363);
    assert.equal(candidate?.spotPositionRaw, 'между чатом и игроками');
    assert.equal(candidate?.spinningSize, 'MEDIUM');
    assert.equal(candidate?.spinningSpeed, 'SLOW');
    assert.equal(candidate?.fishingNote, 'FROM_BOTTOM');
    assert.equal(candidate?.fishingMethod, null);
  });

  void it('isolates one exact topic-fish generated core without moving the outer candidate', () => {
    const body = [
      'Вступление про чужой рекорд 517 г и другие числа. Белорыбица 850 грамм. Поймана на Амур: Протока, Мотыль. Ямки: 40.45',
      'Позже обсуждали другую ямку 40.75.',
    ].join('\n');
    const [candidate] = parseForumPost(post(body, { topicTitle: 'Белорыбица (северная форма)' }));

    assert.equal(candidate?.fishNameRaw, 'Белорыбица');
    assert.equal(candidate?.weightGrams, 850);
    assert.equal(candidate?.baitRaw, 'Мотыль');
    assert.equal(candidate?.holeDepthCm, 4_045);
    assert.equal(candidate?.technical.sourceRange.startOffset, 0);
    assert.equal(candidate?.technical.sourceRange.endOffset, body.length);
  });

  void it('inherits pre-core depth only when the exact generated location matches', () => {
    const catchLine = 'Белорыбица 191 грамм. Поймана на Амур: Протока, Мотыль.';
    const [matching] = parseForumPost(
      post(`На локации Протока яма 26,26 клюнула рыба. ${catchLine}`),
    );
    const [differentLocation] = parseForumPost(
      post(`На локации Заводь яма 26,26 клюнула рыба. ${catchLine}`),
    );
    const [targetNamedAfterUnrelatedDepth] = parseForumPost(
      post(`На локации Заводь яма 7,87. Затем приехал на Протока. ${catchLine}`),
    );

    assert.equal(matching?.holeDepthCm, 2_626);
    assert.equal(differentLocation?.holeDepthCm, null);
    assert.equal(targetNamedAfterUnrelatedDepth?.holeDepthCm, null);
  });

  void it('prefers an exact generated core over a whole-line catch-log label', () => {
    const [candidate] = parseForumPost(post(`Улов: ${generated('11,00 уда')}`));

    assert.equal(candidate?.fishNameRaw, 'Белорыбица');
    assert.equal(candidate?.weightGrams, 7_242);
    assert.equal(candidate?.holeDepthCm, 1_100);
  });

  void it('ends generated bait at the first sentence boundary without borrowing later prose', () => {
    const body = [
      'Белорыбица 850 грамм. Поймана на Амур: Протока, Мотыль.',
      'Затем обсуждали другое место, ямка 14,75.',
    ].join('\n');
    const [candidate] = parseForumPost(post(body));

    assert.equal(candidate?.baitRaw, 'Мотыль');
    assert.equal(candidate?.holeDepthCm, null);
    assert.equal(candidate?.spotPositionRaw, null);
  });

  void it('parses only evidenced embedded observation forms and preserves secondary text', () => {
    const [gear] = parseForumPost(
      post(
        'Белорыбица 850 грамм. Поймана на Амур: Протока, Мотыль, донка, ямка 18 в правой части экрана.',
      ),
    );
    assert.equal(gear?.baitRaw, 'Мотыль');
    assert.equal(gear?.holeDepthCm, 1_800);
    assert.equal(gear?.spotPositionRaw, 'в правой части экрана');
    assert.equal(gear?.userNoteRaw, 'донка');

    const [shelf] = parseForumPost(post(generated('полочка 7.63 над блокнотом')));
    assert.equal(shelf?.holeDepthCm, 763);
    assert.equal(shelf?.spotPositionRaw, 'над блокнотом');
    assert.equal(shelf?.userNoteRaw, 'полочка');

    const [bottom] = parseForumPost(post(generated('дно. 26,26.')));
    assert.equal(bottom?.holeDepthCm, 2_626);
    assert.equal(bottom?.fishingNote, 'FROM_BOTTOM');
    assert.equal(bottom?.spotPositionRaw, null);
  });

  void it('bounds a parenthesized immediate observation to its closing parenthesis', () => {
    const body =
      'Белорыбица 850 грамм. Поймана на Амур: Протока, Мотыль. (Ямка 649 над алкоголем) посторонний текст.';
    const [candidate] = parseForumPost(post(body));

    assert.equal(candidate?.holeDepthCm, 649);
    assert.equal(candidate?.spotPositionRaw, 'над алкоголем');
  });

  void it('splits repeated inline spinning settings from the exact bait', () => {
    const cases = [
      ['Tvis-101 средняя, медленно', 'Tvis-101', 'MEDIUM', 'SLOW'],
      ['Deep-109 маленький, проводка медленная', 'Deep-109', 'SMALL', 'SLOW'],
      ['Pilk-100 бол/мед.', 'Pilk-100', 'LARGE', 'SLOW'],
      ['Vib-oyster, ср/быстро', 'Vib-oyster', 'MEDIUM', 'FAST'],
      ['Tvis-101 средний,средняя', 'Tvis-101', 'MEDIUM', 'MEDIUM'],
      ['Pilk-107 с\\м', 'Pilk-107', 'MEDIUM', 'SLOW'],
      ['Pilk-109.м.м', 'Pilk-109', 'SMALL', 'SLOW'],
      ['Waterplane-3. Маленький. Медленно', 'Waterplane-3', 'SMALL', 'SLOW'],
      ['Pilk-115. б. ср', 'Pilk-115', 'LARGE', 'MEDIUM'],
      ['PopperPlug-5. б-м', 'PopperPlug-5', 'LARGE', 'SLOW'],
      ['Vob-3014.-маленький, проводка медленная', 'Vob-3014', 'SMALL', 'SLOW'],
      ['Deep-102.б.проводка быстрая', 'Deep-102', 'LARGE', 'FAST'],
    ] as const;

    for (const [baitAndSettings, bait, size, speed] of cases) {
      const body = `Белорыбица 850 грамм. Поймана на Амур: Протока, ${baitAndSettings}`;
      const [candidate] = parseForumPost(post(body));
      assert.equal(candidate?.baitRaw, bait, baitAndSettings);
      assert.equal(candidate?.spinningSize, size, baitAndSettings);
      assert.equal(candidate?.spinningSpeed, speed, baitAndSettings);
    }
  });

  void it('does not split incomplete or unsupported spinning suffixes from the bait', () => {
    for (const [baitAndSuffix, expectedBait] of [
      ['Pilk-111,м', 'Pilk-111,м'],
      ['Pilk-100. б. с', 'Pilk-100'],
    ] as const) {
      const [candidate] = parseForumPost(
        post(`Белорыбица 850 грамм. Поймана на Амур: Протока, ${baitAndSuffix}`),
      );
      assert.equal(candidate?.baitRaw, expectedBait, baitAndSuffix);
      assert.equal(candidate?.spinningSize, null, baitAndSuffix);
      assert.equal(candidate?.spinningSpeed, null, baitAndSuffix);
    }
  });

  void it('preserves one immediate anchored depth after structural spinning settings', () => {
    const cases = [
      ['PopperPlug-5 м-б, 8,18 над книгой', 'SMALL', 'FAST', 818, 'над книгой'],
      ['Creatures-10 м-м. 91.56 точка заброса', 'SMALL', 'SLOW', 9_156, 'точка заброса'],
    ] as const;

    for (const [baitAndObservation, size, speed, depth, spot] of cases) {
      const [candidate] = parseForumPost(
        post(`Белорыбица 850 грамм. Поймана на Амур: Протока, ${baitAndObservation}`),
      );
      assert.equal(candidate?.spinningSize, size, baitAndObservation);
      assert.equal(candidate?.spinningSpeed, speed, baitAndObservation);
      assert.equal(candidate?.holeDepthCm, depth, baitAndObservation);
      assert.equal(candidate?.spotPositionRaw, spot, baitAndObservation);
    }

    const [timeOnly] = parseForumPost(
      post('Белорыбица 850 грамм. Поймана на Амур: Протока, Pilk-100. б.м. 3.42 ночью'),
    );
    assert.equal(timeOnly?.holeDepthCm, null);
    assert.equal(timeOnly?.spotPositionRaw, null);
  });

  void it('parses one immediate anchored depth behind repeated structural punctuation', () => {
    const cases = [
      ['Мидия.6.55(леска)', 'Мидия', 655, '(леска)'],
      ['Живец. 2,88(рюкзак)', 'Живец', 288, '(рюкзак)'],
      ['Икра.33.36м(леска)', 'Икра', 3_336, '(леска)'],
      ['Морской червь., ямка 55,71 леска/чат', 'Морской червь', 5_571, 'леска/чат'],
      ['Мясо кальмара.. Ямка 8,14 удочка', 'Мясо кальмара', 814, 'удочка'],
    ] as const;

    for (const [baitAndObservation, bait, depth, spot] of cases) {
      const [candidate] = parseForumPost(
        post(`Белорыбица 850 грамм. Поймана на Амур: Протока, ${baitAndObservation}`),
      );
      assert.equal(candidate?.baitRaw, bait, baitAndObservation);
      assert.equal(candidate?.holeDepthCm, depth, baitAndObservation);
      assert.equal(candidate?.spotPositionRaw, spot, baitAndObservation);
    }
  });

  void it('does not promote unanchored or multiple immediate decimals to a hole', () => {
    for (const baitAndSuffix of ['Мотыль.05.30.', 'Мотыль. 8,84 и 8,09 леска']) {
      const [candidate] = parseForumPost(
        post(`Белорыбица 850 грамм. Поймана на Амур: Протока, ${baitAndSuffix}`),
      );
      assert.equal(candidate?.holeDepthCm, null, baitAndSuffix);
      assert.equal(candidate?.spotPositionRaw, null, baitAndSuffix);
    }
  });

  void it('does not pull sentence-separated depth or prose back into an exact bait', () => {
    const [observation] = parseForumPost(
      post('Белорыбица 850 грамм. Поймана на Амур: Протока, Vib-mussel.7.38 рюкзак б\\б'),
    );
    assert.equal(observation?.baitRaw, 'Vib-mussel');
    assert.equal(observation?.holeDepthCm, 738);
    assert.equal(observation?.spotPositionRaw, 'рюкзак');
    assert.equal(observation?.spinningSize, 'LARGE');
    assert.equal(observation?.spinningSpeed, 'FAST');

    const [prose] = parseForumPost(
      post(
        'Белорыбица 850 грамм. Поймана на Амур: Протока, Deep-103. Затем другая рыба, маленькая медленно.',
      ),
    );
    assert.equal(prose?.baitRaw, 'Deep-103');
    assert.equal(prose?.spinningSize, null);
    assert.equal(prose?.spinningSpeed, null);
  });

  void it('does not read structural spinning pairs later inside a depth and spot observation', () => {
    const [candidate] = parseForumPost(post(generated('6.55 леска, м.м на другую снасть')));

    assert.equal(candidate?.holeDepthCm, 655);
    assert.equal(candidate?.spinningSize, null);
    assert.equal(candidate?.spinningSpeed, null);
  });

  void it('drops only sentence punctuation before an open raw spot', () => {
    const [candidate] = parseForumPost(post(generated('дно. 7,63. книга.')));

    assert.equal(candidate?.holeDepthCm, 763);
    assert.equal(candidate?.spotPositionRaw, 'книга');
  });

  void it('keeps an observation time out of the raw spot and preserves it as a note', () => {
    const [candidate] = parseForumPost(post(generated('21.78 ката в 16.40.')));

    assert.equal(candidate?.holeDepthCm, 2_178);
    assert.equal(candidate?.spotPositionRaw, 'ката');
    assert.equal(candidate?.userNoteRaw, 'в 16.40');
  });

  void it('keeps later sentence prose out of depth and spot fields', () => {
    const [candidate] = parseForumPost(
      post(generated('Ямка 8.10-блокнот.Поймал по времени около 02.00.')),
    );

    assert.equal(candidate?.holeDepthCm, 810);
    assert.equal(candidate?.spotPositionRaw, 'блокнот');
    assert.deepEqual(candidate?.issues, []);

    const [lowercaseMetadata] = parseForumPost(
      post(generated('6.88 над блокнотом.рекорд водоема (не ожидал)')),
    );
    assert.equal(lowercaseMetadata?.holeDepthCm, 688);
    assert.equal(lowercaseMetadata?.spotPositionRaw, 'над блокнотом');
  });

  void it('does not interpret clock or experience metadata as another depth', () => {
    for (const [observation, spot] of [
      ['59.83 удочка игровремя 22.00-23.00', 'удочка'],
      ['8,15 события время 5,30 утра', 'события'],
      ['5.82 ящик\\рюкзак 48.94 млн.опыта', 'ящик\\рюкзак'],
      ['36,36 над алкоголем опыта под коня 2,5 ляма', 'над алкоголем'],
    ] as const) {
      const [candidate] = parseForumPost(post(generated(observation)));
      assert.notEqual(candidate?.holeDepthCm, null, observation);
      assert.equal(candidate?.spotPositionRaw, spot, observation);
      assert.equal(
        candidate?.issues.some((issue) => issue.code === 'AMBIGUOUS_HOLE_DEPTH'),
        false,
        observation,
      );
    }
  });

  void it('keeps repeated time and prose suffixes out of open spot text', () => {
    for (const [observation, spot] of [
      ['33,97 За игродень попалось четыре рыбы', null],
      ['59.83 удочка днем под отвар', 'удочка'],
      ['55.45 чат 19:00 1 сервер', 'чат'],
      ['9.85 (чат-игроки), вечер', '(чат-игроки)'],
      ['11.17 леска-чат..в 22 часа по игре', 'леска-чат'],
      ['7.55,опыта на сухую 50 тысяч', null],
      ['яма 8.63(чат), 03:20', '(чат)'],
      ['32.25 на вторую ночь', null],
      ['19.20 ящик (до желтой части уды не доводить)', 'ящик'],
      ['9.22 между рюкзаком и блокнотом.поплавок', 'между рюкзаком и блокнотом'],
      ['7.63 рюкзак удачи с уважением', 'рюкзак'],
      ['55.71 леска/чат, поклевка около 13 часов', 'леска/чат'],
      ['39.61 леска чат на специальную уду без клюва', 'леска чат'],
      ['59.99 рюкзак/блокнот 2 сер', 'рюкзак/блокнот'],
      ['3.08 над удой, в 23-30', 'над удой'],
      ['20.43 катушка.с уважением', 'катушка'],
      ['3.26 события. не зачет', 'события'],
      ['1.57 ката. день. не зачет', 'ката'],
      ['13.89 алкоголь, 1 серв., 5.50 утра', 'алкоголь'],
      ['44.79 уда с кряком. на сухую', 'уда'],
      ['48.16 ката, без отваров, 3 серв', 'ката'],
    ] as const) {
      const [candidate] = parseForumPost(post(generated(observation)));
      assert.equal(candidate?.spotPositionRaw, spot, observation);
    }
  });

  void it('parses a conservative alternate catch statement without inventing catalog aliases', () => {
    const [candidate] = parseForumPost(
      post('Белорыбица, 548 гр поймана на Протоке в ямке 32,25 на мотыля, пока самая крупная.'),
    );

    assert.equal(candidate?.fishNameRaw, 'Белорыбица');
    assert.equal(candidate?.weightGrams, 548);
    assert.equal(candidate?.fishingBaseRaw, null);
    assert.equal(candidate?.locationRaw, 'Протоке');
    assert.equal(candidate?.baitRaw, 'мотыля');
    assert.equal(candidate?.holeDepthCm, 3_225);
  });

  void it('inherits a colon-terminated shared depth only across exact consecutive catch lines', () => {
    const body = [
      'На локации Протока нашла ямку 38,83:',
      'Белорыбица 216 грамм. Поймана на Амур: Протока, Мотыль.',
      'Белорыбица 517 грамм. Поймана на Амур: Протока, Мотыль.',
    ].join('\n');
    const candidates = parseForumPost(post(body));
    assert.deepEqual(
      candidates.map((candidate) => candidate.holeDepthCm),
      [3_883, 3_883],
    );

    const separated = parseForumPost(post(body.replace('\nБелорыбица 216', '\n\nБелорыбица 216')));
    assert.deepEqual(
      separated.map((candidate) => candidate.holeDepthCm),
      [null, null],
    );
  });

  void it('splits adjacent exact generated cores into independent observations', () => {
    const body = `Удача ${generated('')}${generated('')}`;
    const candidates = parseForumPost(post(body));

    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.map((candidate) => candidate.weightGrams),
      [7_242, 7_242],
    );
    assert.ok(
      (candidates[0]?.technical.sourceRange.endOffset ?? -1) <=
        (candidates[1]?.technical.sourceRange.startOffset ?? -1),
    );
  });

  void it('splits concatenated full generated catches even without a character boundary', () => {
    const body = `улов ${generated('донка')}${generated('')}`;
    const candidates = parseForumPost(post(body));

    assert.equal(candidates.length, 2);
    assert.deepEqual(
      candidates.map((candidate) => candidate.weightGrams),
      [7_242, 7_242],
    );
    assert.equal(candidates[0]?.technical.sourceRange.startOffset, 0);
    assert.equal(candidates[1]?.technical.sourceRange.startOffset, body.lastIndexOf('Белорыбица'));
  });

  void it('splits repeated exact topic fish only when every catch has its own unit weight', () => {
    const candidates = parseForumPost(
      post('Поймал двух подряд: Белорыбица 279 гр и Белорыбица 116 гр.'),
    );

    assert.deepEqual(
      candidates.map((candidate) => [candidate.fishNameRaw, candidate.weightGrams]),
      [
        ['Белорыбица', 279],
        ['Белорыбица', 116],
      ],
    );

    const [ambiguous] = parseForumPost(post('Поймал Белорыбицу 145 и 536 грамм.'));
    assert.equal(ambiguous?.weightGrams, 536);
    assert.equal(parseForumPost(post('Поймал Белорыбицу 145 и 536 грамм.')).length, 1);
  });

  void it('inherits one exact prior context only through an explicit same-hole-and-bait linker', () => {
    const body = [
      'Белорыбица 336 грамм. Поймана на Амур: Протока, Мотыль, ямка 18 уда.',
      'Далее результат: Белорыбица 181 грамм, Белорыбица 370 грамм. Ямка и наживка те же.',
    ].join(' ');
    const candidates = parseForumPost(post(body));

    assert.equal(candidates.length, 3);
    assert.deepEqual(
      candidates.map((candidate) => candidate.weightGrams),
      [336, 181, 370],
    );
    for (const candidate of candidates) {
      assert.equal(candidate.fishingBaseRaw, 'Амур');
      assert.equal(candidate.locationRaw, 'Протока');
      assert.equal(candidate.baitRaw, 'Мотыль');
      assert.equal(candidate.holeDepthCm, 1_800);
      assert.equal(candidate.spotPositionRaw, 'уда');
    }

    const separated = parseForumPost(
      post(body.replace('Далее результат', '\n\nДалее поймал, результат')),
    );
    assert.deepEqual(
      separated.map((candidate) => candidate.holeDepthCm),
      [1_800, null, null],
    );
  });

  void it('does not create catches from sales, aggregates, or unitless record prose', () => {
    for (const body of [
      'Белорыбица 548 гр — 12 000 руб.',
      'За ночь рыба от 100 до 500 гр, всего 12 штук.',
      'Мой рекорд по белорыбице 523 на другой рыбе.',
    ]) {
      assert.deepEqual(parseForumPost(post(body)), [], body);
    }
  });

  void it('drops sale-only rows split out of a catch log without losing later catches', () => {
    const first = generated('12,22 уда');
    const second = generated('22,33 чат');
    const body = `${first}\nБелорыбица 7,242 кг - 123 456 руб.\n${second}`;
    const candidates = parseForumPost(post(body));

    assert.deepEqual(
      candidates.map((candidate) => [candidate.candidateOrdinal, candidate.holeDepthCm]),
      [
        [1, 1_222],
        [2, 2_233],
      ],
    );

    const [reportedCatch] = parseForumPost(
      post('Поймал Белорыбицу 548 гр и продал её — 12 000 руб.'),
    );
    assert.equal(reportedCatch?.weightGrams, 548);
  });

  void it('does not infer spinning settings from equipment or mixed fishing contexts', () => {
    assert.deepEqual(parseForumPost(post('Спины и блесна обсуждаются как снасти, а не улов.')), []);

    const [mixed] = parseForumPost(
      post(
        'На троллинг ловил на спин и закинул на живца: дно, ямка 44,02, поймал другую рыбу, а на 20,45 клюнула Белорыбица на 504 гр.',
      ),
    );
    assert.equal(mixed?.fishingMethod, null);
    assert.equal(mixed?.spinningSize, null);
    assert.equal(mixed?.spinningSpeed, null);
  });

  void it('emits 0..N candidates in source order and preserves identical catches', () => {
    assert.deepEqual(parseForumPost(post('Тут хорошо клюёт, всем удачи!')), []);

    const one = generated('12,22 уда');
    const candidates = parseForumPost(post(`${one}\n${one}`));

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.candidateOrdinal, 1);
    assert.equal(candidates[1]?.candidateOrdinal, 2);
    assert.equal(candidates[0]?.holeDepthCm, candidates[1]?.holeDepthCm);
    assert.equal(candidates[0]?.spotPositionRaw, candidates[1]?.spotPositionRaw);
    assert.notEqual(candidates[0]?.importKey, candidates[1]?.importKey);
    assert.ok(
      (candidates[0]?.technical.sourceRange.startOffset ?? -1) <
        (candidates[1]?.technical.sourceRange.startOffset ?? -1),
    );
  });

  void it('does not derive contributor identity from topic text when member ID is absent', () => {
    const [candidate] = parseForumPost(
      post(generated('12,22 уда'), { memberId: null, topicTitle: 'Чужой nickname' }),
    );

    assert.equal(candidate?.contributorKey, null);
    assert.deepEqual(candidate?.issues, [
      { code: 'MISSING_EXTERNAL_MEMBER_ID', field: 'contributorKey' },
    ]);
  });

  void it('canonicalizes technical IDs and reports exact source offsets and lines', () => {
    const prefix = 'Вступление\n\n';
    const bodyText = `${prefix}${generated('12,22 уда')}`;
    const [candidate] = parseForumPost(
      post(bodyText, { subforumId: '070', topicId: '0701', postId: '09001' }),
    );

    assert.equal(candidate?.technical.subforumId, '70');
    assert.equal(candidate?.technical.topicId, '701');
    assert.equal(candidate?.technical.postId, '9001');
    assert.equal(candidate?.technical.sourceRange.startOffset, prefix.length);
    assert.equal(candidate?.technical.sourceRange.startLine, 3);
    assert.equal(
      bodyText.slice(
        candidate?.technical.sourceRange.startOffset,
        candidate?.technical.sourceRange.endOffset,
      ),
      candidate?.technical.sourceText,
    );
  });

  void it('keeps identity stable across content edits when post identity and ordinal do not move', () => {
    const [before] = parseForumPost(post(generated('12,22 уда')));
    const [after] = parseForumPost(post(generated('22,33 чат')));

    assert.equal(before?.contributorKey, after?.contributorKey);
    assert.equal(before?.importKey, after?.importKey);
  });
});
