import {
  normalizeAuditName,
  type FishReconciliationEntry,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';

export type ManualDbRecommendation = 'KEEP_EXTRA' | 'RENAME' | 'REPOINT+DEACTIVATE' | 'MANUAL';

export interface ManualWorkbookDecision {
  rawName: string;
  rows: number;
  cells: Array<{ baseName: string; sourceSheet: string; sourceCell: string }>;
  decision: 'PROPOSED' | 'EXCLUDE_NON_FISH' | 'EXCLUDE_NOISE' | 'DO_NOT_MAP' | 'MANUAL';
  topicId: string | null;
  canonicalName: string | null;
  rationale: string;
}

export interface FishReferenceCounts {
  fishId: string;
  catchReports: number;
  catchReportIds: string[];
  fishingBaseFish: number;
  fishingBases: Array<{ id: string; name: string }>;
}

interface ManualDbReviewRule {
  recommendation: ManualDbRecommendation;
  recommendedIsActive?: boolean;
  proposedCanonicalName: string | null;
  candidateTopicIds: readonly string[];
  workbookRawNames: readonly string[];
  rationale: string;
}

export interface ManualDbReviewEntry {
  fishId: string;
  currentName: string;
  currentIsActive: boolean;
  catchReports: number;
  fishingBaseFish: number;
  fishingBases: Array<{ id: string; name: string }>;
  exactForum69Candidates: Array<{ topicId: string; canonicalName: string }>;
  workbookCells: Array<{
    baseName: string;
    sourceSheet: string;
    sourceCell: string;
    rawName: string;
  }>;
  recommendation: ManualDbRecommendation;
  recommendedIsActive: boolean | null;
  proposedCanonicalName: string | null;
  rationale: string;
}

const EXPLICIT_MANUAL_WORKBOOK_TARGETS = new Map<string, string>([
  ['4-угольный волосатый краб', 'Четырехугольный волосатый краб'],
  ['Apиcтoxpoмиc кpиcти', 'Аристохромис кристи'],
  ['Ёрш-носарь', 'Ёрш носарь'],
  ['Адамуссиус', 'Адамуссиум'],
  ['Акула - Небрия', 'Акула-небрия'],
  ['Акула австрал.головастая (4050)', 'Акула австралийская головастая'],
  ['Акула белая (мигрирует)', 'Акула белая'],
  ['Акула китовая альбинос (1900)', 'Китовая акула - альбинос'],
  ['Акула мозамбикская (480)', 'Акула мозамбикская бычья'],
  ['Акула песчанная (190)', 'Акула песчаная'],
  ['Акула черная (далатия,300)', 'Акула черная'],
  ['Акула-квагга (2700)', 'Акула - квагга'],
  ['Акула-собака', 'Акула - собака'],
  ['Ангел черноплавничний', 'Ангел черноплавничный'],
  ['Антимора клюворылая (1400)', 'Антимора клювокрылая'],
  ['Апистограммова факельная', 'Апистограмма факельная'],
  ['Байкальский осетр', 'Осетр байкальский'],
  ['Бронзовая акула (акула-молот)', 'Бронзовая акула'],
  ['Бычок - трахидерм', 'Бычок-трахидерм'],
  ['В/сибирский хариус', 'Восточносибирский хариус'],
  ['Глубинный судак (мигрирует)', 'Глубинный судак'],
  ['Гримпотевтис тихоокеан. (9000)', 'Гримпотевтис тихоокеанский'],
  ['Дельфин Хамельтона (14000)', 'Дельфин Хамильтона'],
  ['Диннорылый полурыл', 'Длиннорылый полурыл'],
  ['Длиннопалый рак (от 450)', 'Длиннопалый рак'],
  ['Длиннопалый рак (от 450-блесна)', 'Длиннопалый рак'],
  ['Карась Серебрянный', 'Карась серебряный'],
  ['Карась серебрянный', 'Карась серебряный'],
  ['Кит горбатый альбинос (10)', 'Кит горбатый(альбинос)'],
  ['Кит синий альбинос (1900)', 'Кит синий (альбинос)'],
  ['Коралловый группер', 'Красный коралловый группер'],
  ['Красный луциан', 'Красный императорский луциан'],
  ['Кряжевая палия (мигрирует)', 'Кряжевая палия'],
  ['Лабынкирская мальма', 'Лабынкырская мальма'],
  ['Ламна (акула сельдевая)', 'Ламна'],
  ['Лещ в\\сибирский', 'Лещ Восточносибирский'],
  ['Лещ морской', 'Лещ морской обыкновенный'],
  ['Лосось (мигрирует)', 'Лосось'],
  ['Лудожная палия (мигрирует)', 'Лудожная палия'],
  ['М/чешуйчатый краснопер', 'Мелкочешуйчатый краснопер'],
  ['Макрель квинследская', 'Макрель квинслендская'],
  ['Макроронус новозеландский', 'Макруронус новозеландский'],
  ['Мелкочешуйчатый угай', 'Мелкочешуйный угай'],
  ['Мидия (от 105-блесна)', 'Мидия'],
  ['Мидия (от 105-для блесны)', 'Мидия'],
  ['Монгол.Краснопёр', 'Монгольский краснопер'],
  ['Морская очковая свинья (200)', 'Морская свинья очковая'],
  ['Морская свинья обыкн (450)', 'Морская свинья обыкновенная'],
  ['Морской орел', 'Морской орел пятнистый'],
  ['Морской черт (удильщик)', 'Морской черт'],
  ['Мурена - зебра', 'Мурена-зебра'],
  ['Муреная ячеистая', 'Мурена ячеистая'],
  ['Налим с/земноморский', 'Налим средиземноморский'],
  ['Носатая энгидрина', 'Энгидрина носатая'],
  ['Окунь-клювач', 'Окунь - клювач'],
  ['Омар (скампи) голубой (180)', 'Скампи голубой'],
  ['Павлиний окунь королев (290)', 'Павлиний окунь королевский'],
  ['Палия (мигрирует)', 'Палия'],
  ['Панцирник миссисипский', 'Панцирник мисcисипский'],
  ['Перонодия жилковатая', 'Перонидия жилковатая'],
  ['Пескарь-лень', 'Пескарь - лень'],
  ['Пигоплит', 'Пигоплит, Королевский ангел'],
  ['Платакс - нетопырь', 'Платакс-нетопырь'],
  ['Подкамещик пестроногий (2000)', 'Подкаменщик пестроногий'],
  ['Пустая бочка', 'Бочка'],
  ['Пятиугольный волос.краб', 'Пятиугольный волосатый краб'],
  ['Пятнистый рак (от 750-блесна)', 'Пятнистый рак'],
  ['Рапана (от 850-для блесны)', 'Рапана'],
  ['Рыба лира', 'Рыба-лира'],
  ['Рыба-меч', 'Рыба меч'],
  ['Рыба-ремень (сельд.король,1000)', 'Рыба-ремень, сельдяной король'],
  ['Сейвал (кит ивасевый)', 'Сейвал'],
  ['Сиг-хадары', 'Сиг-Xадары'],
  ['Скат-кукушка (130)', 'Скат - кукушка'],
  ['Сомик - кукушка', 'Сомик-кукушка'],
  ['Спинорог позолоченый', 'Спинорог позолоченный'],
  ['Странствующий группер', 'Странствующий групер'],
  ['Травянной краб (от 1,1-блесна)', 'Травяной краб'],
  ['Травяной краб (от 1,1-блесна)', 'Травяной краб'],
  ['Тунец макрелевый (мигрирует)', 'Тунец макрелевый'],
  ['Усач Итальянский', 'Итальянский усач'],
  ['Усач итальянский', 'Итальянский усач'],
  ['Уссур.Касатка', 'Уссурийская косатка'],
  ['Уссур.востробрюшка', 'Уссурийская востробрюшка'],
  ['Устрица (от 130-блесна)', 'Устрица'],
  ['Устрица (от 130-для блесны)', 'Устрица'],
  ['Цетрина австралийская (3250)', 'Центрина австралийская'],
  ['Цихлида - колибри', 'Цихлида-колибри'],
  ['Черепахоголов Сейнеджера (280)', 'Черепахоголов Стейнеджера'],
  ['Черный краппи', 'Краппи черный'],
  ['Чешуеед (350)', 'Чешуеед, Плагиотрем чешуеедный'],
  ['Шпрот таганьикский', 'Шпрот танганьикский'],
]);

const EXCLUDE_NON_FISH_WORKBOOK_VALUES = new Set([
  'Артефакты',
  'Вещи деда Мороза',
  'Греческие кувшины',
  'Золото инков',
  'Ключ',
  'Коллекция фараона',
  'Контейнеры',
  'Кораллы',
  'Маски',
  'Набор индейца',
  'Находка-бивень',
  'Находка-бомба',
  'Находка-будда',
  'Находка-бумеранг',
  'Находка-кандалы',
  'Находка-кокос',
  'Находка-ленин',
  'Находка-робот',
  'Находка-трилобит',
  'Находка-трубка',
  'Находка-череп',
  'Находка-шлем',
  'Обломки',
  'Останки кораблекрушения',
  'Перо',
  'Рванный сапог',
  'Черная банка',
  'Якорь',
]);

const EXCLUDE_NOISE_WORKBOOK_VALUES = new Set([
  'Вес  кувшинов:',
  'гиг-4 лока,уля, 5,09 данные',
  'городская',
  'доспехи',
  'старый форт',
  '№1. 15кг-49кг.',
  '№2. 50кг-149кг.',
  '№3. 150кг-249кг.',
  '№4. 250кг-399кг.',
  '№5. 400кг-599кг.',
  '№6. 600кг-899кг.',
  '№7. 900кг-1.4тн.',
]);

const DO_NOT_MAP_WORKBOOK_VALUES = new Set(['Губка', 'Кит синий', 'Поплак']);

export const FINAL_HUMAN_DB_FISH_NAMES = new Set([
  'Коралловый группер',
  'Красный луциан',
  'Лещ морской',
]);

export const FINAL_HUMAN_WORKBOOK_CANDIDATES = new Map<string, readonly string[]>([
  ['Губка', ['32739']],
  ['Кит синий', ['33073', '33074']],
  ['Коралловый группер', ['318']],
  ['Красный луциан', ['317']],
  ['Лещ морской', ['32766', '32768', '32772']],
  ['Поплак', ['32396']],
]);

const MANUAL_DB_REVIEW_RULES = new Map<string, ManualDbReviewRule>([
  [
    'Акула',
    {
      recommendation: 'KEEP_EXTRA',
      recommendedIsActive: false,
      proposedCanonicalName: null,
      candidateTopicIds: [],
      workbookRawNames: [],
      rationale: 'Approved local extra outside forum69 canonical identities; keep inactive',
    },
  ],
  [
    'Греческий сосуд',
    {
      recommendation: 'KEEP_EXTRA',
      proposedCanonicalName: null,
      candidateTopicIds: [],
      workbookRawNames: [],
      rationale: 'Intentional non-forum extra; no Fish identity or database references were found',
    },
  ],
  [
    'Клюварыл',
    {
      recommendation: 'REPOINT+DEACTIVATE',
      proposedCanonicalName: 'Клюворыл',
      candidateTopicIds: ['32600'],
      workbookRawNames: ['Клюворыл'],
      rationale:
        'Reviewed typo duplicate of the already-existing canonical Fish; repoint requires approval',
    },
  ],
  [
    'Коралловый группер',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Красный коралловый группер',
      candidateTopicIds: ['318'],
      workbookRawNames: ['Коралловый группер'],
      rationale: 'All seven imported reports trace by importKey to forum69 topic 318',
    },
  ],
  [
    'Красный луциан',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Красный императорский луциан',
      candidateTopicIds: ['317'],
      workbookRawNames: ['Красный луциан'],
      rationale: 'All six imported reports trace by importKey to forum69 topic 317',
    },
  ],
  [
    'Лещ морской',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Лещ морской обыкновенный',
      candidateTopicIds: ['32766', '32768', '32772'],
      workbookRawNames: ['Лещ морской'],
      rationale:
        'The imported report traces to topic 32766; workbook neighbors separately identify topics 32768 and 32772',
    },
  ],
  [
    'Мабула серповидная',
    {
      recommendation: 'REPOINT+DEACTIVATE',
      proposedCanonicalName: 'Мобула серповидная',
      candidateTopicIds: ['33510'],
      workbookRawNames: ['Мобула серповидная'],
      rationale:
        'Reviewed typo duplicate of the already-existing canonical Fish; repoint requires approval',
    },
  ],
  [
    'Омар голубой',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Скампи голубой',
      candidateTopicIds: ['32914'],
      workbookRawNames: ['Омар (скампи) голубой (180)'],
      rationale: 'Workbook explicitly supplies “скампи”; one exact forum69 identity exists',
    },
  ],
  [
    'Панцирник миссисипский',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Панцирник мисcисипский',
      candidateTopicIds: ['32927'],
      workbookRawNames: ['Панцирник миссисипский'],
      rationale: 'Exact reviewed source identity; forum69 spelling contains Latin “c”',
    },
  ],
  [
    'Сева',
    {
      recommendation: 'RENAME',
      proposedCanonicalName: 'Кои Сёва',
      candidateTopicIds: ['32201'],
      workbookRawNames: ['Кои Сева'],
      rationale: 'All workbook references use the full koi name; unique safe е/ё forum69 identity',
    },
  ],
  [
    'Скат',
    {
      recommendation: 'KEEP_EXTRA',
      recommendedIsActive: false,
      proposedCanonicalName: null,
      candidateTopicIds: [],
      workbookRawNames: [],
      rationale: 'Approved local extra outside forum69 canonical identities; deactivate on apply',
    },
  ],
  [
    'Учебная рыба A',
    {
      recommendation: 'KEEP_EXTRA',
      proposedCanonicalName: null,
      candidateTopicIds: [],
      workbookRawNames: [],
      rationale: 'Explicit local training fixture with no forum69 identity or database references',
    },
  ],
  [
    'Учебная рыба B',
    {
      recommendation: 'KEEP_EXTRA',
      proposedCanonicalName: null,
      candidateTopicIds: [],
      workbookRawNames: [],
      rationale: 'Explicit local training fixture with no forum69 identity or database references',
    },
  ],
]);

export const REVIEWED_DB_FISH_NAMES = new Set(MANUAL_DB_REVIEW_RULES.keys());

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function corpusByCanonicalName(
  corpus: readonly ForumFishIdentity[],
): Map<string, ForumFishIdentity> {
  const result = new Map<string, ForumFishIdentity>();
  for (const fish of corpus) {
    const key = normalizeAuditName(fish.canonicalName);
    if (result.has(key)) throw new Error(`canonical Fish collision in manual review: ${key}`);
    result.set(key, fish);
  }
  return result;
}

export function buildManualWorkbookDecisions(
  workbookRows: readonly WorkbookFishResolution[],
  corpus: readonly ForumFishIdentity[],
): ManualWorkbookDecision[] {
  const canonical = corpusByCanonicalName(corpus);
  const reviewedRawNames = new Set([
    ...EXPLICIT_MANUAL_WORKBOOK_TARGETS.keys(),
    ...EXCLUDE_NON_FISH_WORKBOOK_VALUES,
    ...EXCLUDE_NOISE_WORKBOOK_VALUES,
    ...DO_NOT_MAP_WORKBOOK_VALUES,
  ]);
  const manualRows = workbookRows.filter(
    (row) => row.category === 'MANUAL' || reviewedRawNames.has(row.rawName),
  );
  const rowsByRawName = new Map<string, WorkbookFishResolution[]>();

  for (const row of manualRows) {
    const rows = rowsByRawName.get(row.rawName) ?? [];
    rows.push(row);
    rowsByRawName.set(row.rawName, rows);
  }

  return [...rowsByRawName]
    .sort(([left], [right]) => compareText(left, right))
    .map(([rawName, rows]): ManualWorkbookDecision => {
      const targetName = EXPLICIT_MANUAL_WORKBOOK_TARGETS.get(rawName);
      const target =
        targetName === undefined ? undefined : canonical.get(normalizeAuditName(targetName));
      if (targetName !== undefined && target === undefined) {
        throw new Error(
          `reviewed workbook target is not an exact forum69 canonical name: ${targetName}`,
        );
      }

      const decision =
        target === undefined
          ? EXCLUDE_NON_FISH_WORKBOOK_VALUES.has(rawName)
            ? 'EXCLUDE_NON_FISH'
            : EXCLUDE_NOISE_WORKBOOK_VALUES.has(rawName)
              ? 'EXCLUDE_NOISE'
              : DO_NOT_MAP_WORKBOOK_VALUES.has(rawName)
                ? 'DO_NOT_MAP'
                : 'MANUAL'
          : 'PROPOSED';
      return {
        rawName,
        rows: rows.length,
        cells: rows
          .map((row) => ({
            baseName: row.baseName,
            sourceSheet: row.sourceSheet,
            sourceCell: row.sourceCell,
          }))
          .sort(
            (left, right) =>
              compareText(left.baseName, right.baseName) ||
              compareText(left.sourceCell, right.sourceCell),
          ),
        decision,
        topicId: target?.topicId ?? null,
        canonicalName: target?.canonicalName ?? null,
        rationale:
          target !== undefined
            ? 'Explicit reviewed source-cell alias to an exact full forum69 canonical name'
            : decision === 'EXCLUDE_NON_FISH'
              ? 'Reviewed find/item; forbidden from Fish and BaseFish projection'
              : decision === 'EXCLUDE_NOISE'
                ? 'Reviewed heading/source noise; forbidden from Fish and BaseFish projection'
                : decision === 'DO_NOT_MAP'
                  ? 'Human-reviewed ambiguous fish-like value; preserve as source evidence and create no Fish/BaseFish mapping'
                  : 'No explicit one-to-one forum69 identity was approved; no fuzzy match attempted',
      };
    });
}

export function assertManualWorkbookReviewComplete(
  decisions: readonly ManualWorkbookDecision[],
): void {
  const observed = new Set(decisions.map((decision) => decision.rawName));
  for (const rawName of EXPLICIT_MANUAL_WORKBOOK_TARGETS.keys()) {
    if (!observed.has(rawName))
      throw new Error(`reviewed workbook raw value is absent: ${rawName}`);
  }
  for (const rawName of [
    ...EXCLUDE_NON_FISH_WORKBOOK_VALUES,
    ...EXCLUDE_NOISE_WORKBOOK_VALUES,
    ...DO_NOT_MAP_WORKBOOK_VALUES,
  ]) {
    if (!observed.has(rawName))
      throw new Error(`reviewed workbook exclusion is absent: ${rawName}`);
  }
}

export function projectManualWorkbookDecisions(
  workbookRows: readonly WorkbookFishResolution[],
  decisions: readonly ManualWorkbookDecision[],
): WorkbookFishResolution[] {
  const byRawName = new Map(decisions.map((decision) => [decision.rawName, decision] as const));
  return workbookRows.map((row): WorkbookFishResolution => {
    const decision = byRawName.get(row.rawName);
    if (decision === undefined) return { ...row };
    if (decision.decision !== 'PROPOSED') {
      const category =
        decision.decision === 'EXCLUDE_NON_FISH'
          ? 'EXCLUDE_NON_FISH'
          : decision.decision === 'EXCLUDE_NOISE'
            ? 'EXCLUDE_NOISE'
            : decision.decision === 'DO_NOT_MAP'
              ? 'DO_NOT_MAP'
              : 'MANUAL';
      return {
        ...row,
        lookupName: row.rawName,
        annotationStripped: false,
        category,
        topicId: null,
        canonicalName: null,
      };
    }
    if (decision.topicId === null || decision.canonicalName === null) {
      throw new Error(`proposed workbook decision has no forum69 target: ${row.rawName}`);
    }
    return {
      ...row,
      lookupName: row.rawName,
      annotationStripped: false,
      category: 'EXPLICIT_FORUM_ALIAS',
      topicId: decision.topicId,
      canonicalName: decision.canonicalName,
    };
  });
}

export function buildManualDbReview(
  manualEntries: readonly FishReconciliationEntry[],
  references: readonly FishReferenceCounts[],
  corpus: readonly ForumFishIdentity[],
  workbookRows: readonly WorkbookFishResolution[],
): ManualDbReviewEntry[] {
  const corpusByTopic = new Map(corpus.map((fish) => [fish.topicId, fish] as const));
  const referencesByFishId = new Map(references.map((entry) => [entry.fishId, entry] as const));

  return [...manualEntries]
    .sort((left, right) => compareText(left.currentName ?? '', right.currentName ?? ''))
    .map((entry): ManualDbReviewEntry => {
      if (
        entry.currentFishId === null ||
        entry.currentName === null ||
        entry.currentIsActive === null
      ) {
        throw new Error('manual DB review received a non-current Fish entry');
      }
      const rule = MANUAL_DB_REVIEW_RULES.get(entry.currentName);
      if (rule === undefined)
        throw new Error(`manual DB Fish has no reviewed rule: ${entry.currentName}`);
      const reference = referencesByFishId.get(entry.currentFishId);
      if (reference === undefined)
        throw new Error(`manual DB Fish has no reference audit: ${entry.currentFishId}`);
      const candidates = rule.candidateTopicIds.map((topicId) => {
        const fish = corpusByTopic.get(topicId);
        if (fish === undefined) throw new Error(`manual DB candidate topic is absent: ${topicId}`);
        return { topicId, canonicalName: fish.canonicalName };
      });
      if (
        rule.proposedCanonicalName !== null &&
        !candidates.some((candidate) => candidate.canonicalName === rule.proposedCanonicalName)
      ) {
        throw new Error(
          `manual DB proposal is not one of its exact candidates: ${entry.currentName}`,
        );
      }
      const workbookRawNames = new Set(rule.workbookRawNames);

      return {
        fishId: entry.currentFishId,
        currentName: entry.currentName,
        currentIsActive: entry.currentIsActive,
        catchReports: reference.catchReports,
        fishingBaseFish: reference.fishingBaseFish,
        fishingBases: [...reference.fishingBases].sort((left, right) =>
          compareText(left.name, right.name),
        ),
        exactForum69Candidates: candidates,
        workbookCells: workbookRows
          .filter((row) => workbookRawNames.has(row.rawName))
          .map((row) => ({
            baseName: row.baseName,
            sourceSheet: row.sourceSheet,
            sourceCell: row.sourceCell,
            rawName: row.rawName,
          }))
          .sort(
            (left, right) =>
              compareText(left.baseName, right.baseName) ||
              compareText(left.sourceCell, right.sourceCell),
          ),
        recommendation: rule.recommendation,
        recommendedIsActive: rule.recommendedIsActive ?? null,
        proposedCanonicalName: rule.proposedCanonicalName,
        rationale: rule.rationale,
      };
    });
}

export const MANUAL_REVIEW_COLLISIONS = [
  {
    topicId: '32600',
    canonicalName: 'Клюворыл',
    legacyFishId: '9e3c612f-048c-41bc-a268-5a0d35bef4a4',
    canonicalFishId: '4a3821cf-861b-4302-bf0c-e34b88ca25b1',
  },
  {
    topicId: '33510',
    canonicalName: 'Мобула серповидная',
    legacyFishId: '69aa1e19-4224-42a9-8f83-8fb9909a40ff',
    canonicalFishId: 'b664473d-26e1-40ae-a8e9-aedf7e02d41c',
  },
] as const;

export function finalizeFishReconciliation(
  entries: readonly FishReconciliationEntry[],
  review: readonly ManualDbReviewEntry[],
  corpus: readonly ForumFishIdentity[],
): FishReconciliationEntry[] {
  const reviewByFishId = new Map(review.map((entry) => [entry.fishId, entry] as const));
  const corpusByName = new Map(corpus.map((entry) => [entry.canonicalName, entry] as const));
  const collisionByLegacyId = new Map<string, (typeof MANUAL_REVIEW_COLLISIONS)[number]>(
    MANUAL_REVIEW_COLLISIONS.map((entry) => [entry.legacyFishId, entry] as const),
  );
  const finalized = entries.map((entry): FishReconciliationEntry => {
    if (entry.currentFishId === null) return { ...entry };
    const decision = reviewByFishId.get(entry.currentFishId);
    if (decision === undefined) return { ...entry };

    if (decision.recommendation === 'MANUAL') {
      throw new Error(`reviewed DB Fish remains MANUAL: ${decision.currentName}`);
    }
    if (decision.recommendation === 'KEEP_EXTRA') {
      return {
        ...entry,
        category: 'LOCAL_EXTRA',
        topicId: null,
        canonicalName: null,
        preservesFishId: true,
        decision: 'KEEP_EXTRA',
        targetIsActive: decision.recommendedIsActive ?? decision.currentIsActive,
        reason: decision.rationale,
      };
    }

    const canonical = corpusByName.get(decision.proposedCanonicalName ?? '');
    if (canonical === undefined) {
      throw new Error(`reviewed DB target is not canonical: ${decision.currentName}`);
    }
    if (decision.recommendation === 'RENAME') {
      return {
        ...entry,
        category: 'EXPLICIT_RENAME',
        topicId: canonical.topicId,
        canonicalName: canonical.canonicalName,
        preservesFishId: true,
        decision: 'RENAME',
        targetIsActive: decision.currentIsActive,
        reason: decision.rationale,
      };
    }

    const collision = collisionByLegacyId.get(entry.currentFishId);
    if (
      collision === undefined ||
      collision.topicId !== canonical.topicId ||
      collision.canonicalName !== canonical.canonicalName
    ) {
      throw new Error(`reviewed repoint target is not explicit: ${decision.currentName}`);
    }
    return {
      ...entry,
      category: 'REPOINT_DEACTIVATE',
      topicId: canonical.topicId,
      canonicalName: canonical.canonicalName,
      preservesFishId: true,
      decision: 'REPOINT+DEACTIVATE',
      targetIsActive: false,
      repointTargetFishId: collision.canonicalFishId,
      reason: decision.rationale,
    };
  });

  const representedTopicIds = new Set(
    finalized
      .filter(
        (entry) =>
          entry.topicId !== null &&
          entry.category !== 'MISSING_CREATE' &&
          entry.category !== 'REPOINT_DEACTIVATE',
      )
      .map((entry) => entry.topicId as string),
  );
  const deduplicated = finalized.filter(
    (entry) =>
      entry.category !== 'MISSING_CREATE' ||
      entry.topicId === null ||
      !representedTopicIds.has(entry.topicId),
  );

  if (deduplicated.some((entry) => entry.category === 'MANUAL' || entry.decision === 'MANUAL')) {
    throw new Error('final Fish reconciliation contains MANUAL decisions');
  }
  const ownersByTopic = new Map<string, FishReconciliationEntry[]>();
  for (const entry of deduplicated) {
    if (entry.topicId === null || entry.category === 'REPOINT_DEACTIVATE') continue;
    const owners = ownersByTopic.get(entry.topicId) ?? [];
    owners.push(entry);
    ownersByTopic.set(entry.topicId, owners);
  }
  const ownershipIssues = corpus
    .filter((fish) => ownersByTopic.get(fish.topicId)?.length !== 1)
    .map((fish) => `${fish.topicId}:${ownersByTopic.get(fish.topicId)?.length ?? 0}`);
  if (ownershipIssues.length > 0) {
    throw new Error(`final forum69 ownership is not one-to-one: ${ownershipIssues.join(', ')}`);
  }
  for (const collision of MANUAL_REVIEW_COLLISIONS) {
    const source = deduplicated.find((entry) => entry.currentFishId === collision.legacyFishId);
    const target = deduplicated.find((entry) => entry.currentFishId === collision.canonicalFishId);
    if (
      source === undefined &&
      target === undefined &&
      !corpusByName.has(collision.canonicalName)
    ) {
      continue;
    }
    if (
      source?.decision !== 'REPOINT+DEACTIVATE' ||
      source.repointTargetFishId !== collision.canonicalFishId ||
      target?.topicId !== collision.topicId ||
      target.category === 'REPOINT_DEACTIVATE'
    ) {
      throw new Error(`final collision plan is incomplete: ${collision.topicId}`);
    }
  }

  return deduplicated.sort((left, right) => {
    const currentIdOrder = compareText(left.currentFishId ?? '', right.currentFishId ?? '');
    if (currentIdOrder !== 0) return currentIdOrder;
    const leftTopicId = BigInt(left.topicId ?? '0');
    const rightTopicId = BigInt(right.topicId ?? '0');
    return leftTopicId < rightTopicId ? -1 : leftTopicId > rightTopicId ? 1 : 0;
  });
}
