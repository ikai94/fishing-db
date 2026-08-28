import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { normalizeAuditName, stableJson, type ForumFishIdentity } from './fish-catalog-audit.js';

export const FISH_IMAGE_STATUSES = ['EXACT', 'MAPPED', 'MANUAL', 'MISSING'] as const;
export type FishImageStatus = (typeof FISH_IMAGE_STATUSES)[number];

export type FishImageMatchRule =
  | 'CANONICAL_EXACT'
  | 'FORUM_ALIAS_EXACT'
  | 'EXPLICIT_TOPIC_MAPPING'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'NO_IMAGE_MAPPING'
  | 'NO_OFFICIAL_CANDIDATE';

export interface OfficialFishListEntry {
  listTitle: string;
  detailPath: string;
  middleImagePath: string;
  imageKey: number;
}

export interface OfficialFishEvidence extends OfficialFishListEntry {
  detailTitle: string;
  bigImagePath: string;
}

export interface FishImageManifestEntry {
  forumTopicId: string;
  canonicalName: string;
  status: FishImageStatus;
  matchRule: FishImageMatchRule;
  matchedName: string | null;
  official: OfficialFishEvidence | null;
  candidates: OfficialFishEvidence[];
}

export interface ExplicitFishImageMapping {
  officialTitle: string;
  detailPath: string;
  imageKey: number;
  rationale: string;
}

export interface FishImageMetadataManifest {
  schemaVersion: 1;
  mode: 'AUDIT_MANIFEST_ONLY';
  source: {
    origin: 'https://rus-fishsoft.ru';
    listPage: 'https://rus-fishsoft.ru/list-fish.html';
    dataEndpoint: 'https://rus-fishsoft.ru/ajaxcontent.html';
    requestShape: {
      method: 'POST';
      form: {
        'vars[to]': 'data';
        'vars[sc]': 'fish_list';
        'vars[sort]': '<advertised-letter>';
      };
    };
    capturedAt: string;
    officialEntries: number;
    normalizedSnapshotSha256: string;
  };
  policy: {
    forum69CanonicalNameIsAuthoritative: true;
    listAndDetailTitlesAreSupplementalOnly: true;
    fuzzyMatching: false;
    eyoFolding: false;
    punctuationFolding: false;
    slugInference: false;
    imageBinariesDownloaded: false;
    imageHotlinkingEnabled: false;
  };
  counts: Record<FishImageStatus, number>;
  explicitMappings: Record<string, ExplicitFishImageMapping>;
  entries: FishImageManifestEntry[];
}

export interface FishImageManualReviewAudit {
  schemaVersion: 1;
  mode: 'MANUAL_REVIEW_ONLY';
  sourceSnapshotSha256: string;
  counts: { MANUAL: number };
  entries: Array<{
    forumTopicId: string;
    canonicalName: string;
    reason: string;
    plausibleOfficialCandidates: Array<
      OfficialFishEvidence & {
        exactEvidence: {
          canonicalNameNormalized: string;
          listTitleNormalized: string;
          detailTitleNormalized: string;
          listAndDetailTitlesAgree: true;
          middleAndBigImageKeysAgree: true;
          automaticIdentityMatch: false;
        };
      }
    >;
  }>;
}

export interface FishImageMappingRules {
  explicitMappings: Readonly<Record<string, ExplicitFishImageMapping>>;
  manualCandidateTitles: Readonly<Record<string, readonly string[]>>;
  noImageMappingCandidateTitles: Readonly<Record<string, readonly string[]>>;
  missingTopicIds: ReadonlySet<string>;
  expectedCounts: Readonly<Record<FishImageStatus, number>>;
}

const EXPLICIT_MAPPINGS = {
  '93': {
    officialTitle: 'Валек',
    detailPath: '/valek.html',
    imageKey: 1006,
    rationale: 'SAFE_OVERRIDE: topic-specific е/ё spelling variant',
  },
  '94': {
    officialTitle: 'Ерш-носарь',
    detailPath: '/ersh-nosar.html',
    imageKey: 1019,
    rationale: 'SAFE_OVERRIDE: topic-specific е/ё spelling and hyphenation variant',
  },
  '95': {
    officialTitle: 'Тунец желтопёрый',
    detailPath: '/zheltopyoryij-tunecz.html',
    imageKey: 3047,
    rationale: 'SAFE_OVERRIDE: forum source documents the reversed-word-order alternate',
  },
  '193': {
    officialTitle: 'Рыба-меч',
    detailPath: '/ryiba-mech.html',
    imageKey: 3051,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphenation variant',
  },
  '267': {
    officialTitle: 'Скат гитарный',
    detailPath: '/gitarnyij-skat.html',
    imageKey: 3037,
    rationale: 'SAFE_OVERRIDE: forum source documents the reversed-word-order alternate',
  },
  '286': {
    officialTitle: 'Ерш',
    detailPath: '/ersh.html',
    imageKey: 1018,
    rationale: 'SAFE_OVERRIDE: topic-specific е/ё spelling variant',
  },
  '318': {
    officialTitle: 'Группер корраловый красный',
    detailPath: '/grupper-korralovyij-krasnyij.html',
    imageKey: 3009,
    rationale: 'SAFE_OVERRIDE: forum source documents the word-order alternate; spelling differs',
  },
  '332': {
    officialTitle: 'Лещ восточно-сибирский',
    detailPath: '/leshh-vostochnosibirskij.html',
    imageKey: 1033,
    rationale: 'SAFE_OVERRIDE: topic-specific capitalization and hyphenation variant',
  },
  '351': {
    officialTitle: 'Краснопёр монгольский',
    detailPath: '/mongolskij-krasnopyor.html',
    imageKey: 2019,
    rationale: 'SAFE_OVERRIDE: forum source documents the reversed-word-order alternate',
  },
  '353': {
    officialTitle: 'Осетр сибирский',
    detailPath: '/osetr-sibirskij.html',
    imageKey: 1044,
    rationale: 'SAFE_OVERRIDE: forum source explicitly documents Осётр сибирский as an alternate',
  },
  '702': {
    officialTitle: 'Жерех - лысач',
    detailPath: '/zherex-lyisach.html',
    imageKey: 2057,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '31639': {
    officialTitle: 'Сиг хадары',
    detailPath: '/sig-xadaryi.html',
    imageKey: 2129,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen and Latin/Cyrillic Х spelling variant',
  },
  '32147': {
    officialTitle: 'Антимора  клюворылая',
    detailPath: '/antimora-klyuvoryilaya.html',
    imageKey: 2271,
    rationale: 'SAFE_OVERRIDE: the same forum69 topic body and catch posts use Антимора клюворылая',
  },
  '32153': {
    officialTitle: 'Акула черная (Далатия)',
    detailPath: '/akula-chernaya-(dalatiya).html',
    imageKey: 2268,
    rationale: 'SAFE_OVERRIDE: forum source title explicitly documents Далатия as an alternate',
  },
  '32223': {
    officialTitle: 'Сейвал или кит ивасевый',
    detailPath: '/sejval-ili-kit-ivasevyij.html',
    imageKey: 2317,
    rationale: 'SAFE_OVERRIDE: forum and official titles explicitly document the synonym',
  },
  '32243': {
    officialTitle: 'Младица или Лосось дунайский',
    detailPath: '/mladicza-ili-losos-dunajskij.html',
    imageKey: 2304,
    rationale: 'SAFE_OVERRIDE: forum and official titles explicitly document the synonym',
  },
  '32246': {
    officialTitle: 'Морской черт или удильщик европейский',
    detailPath: '/morskoj-chert-ili-udilshhik-evropejskij.html',
    imageKey: 2302,
    rationale: 'SAFE_OVERRIDE: forum and official titles explicitly document the synonym',
  },
  '32250': {
    officialTitle: 'Ламна или Акула сельдевая атлантическая',
    detailPath: '/lamna-ili-akula-seldevaya-atlanticheskaya.html',
    imageKey: 2298,
    rationale: 'SAFE_OVERRIDE: forum and official titles explicitly document the synonym',
  },
  '32424': {
    officialTitle: 'Трахира Хоплиас, Малабарский хоплиас',
    detailPath: '/traxira-xoplias,-malabarskij-xoplias.html',
    imageKey: 2364,
    rationale:
      'SAFE_OVERRIDE: forum source explicitly documents Малабарский хоплиас as an alternate',
  },
  '32724': {
    officialTitle: 'Перуанский ансчоус',
    detailPath: '/peruanskij-anschous.html',
    imageKey: 4053,
    rationale: 'SAFE_OVERRIDE: topic-specific spelling variant',
  },
  '32773': {
    officialTitle: 'Голец - кристивомер',
    detailPath: '/golecz-kristivomer.html',
    imageKey: 4074,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '32927': {
    officialTitle: 'Панцирник мисиссипский',
    detailPath: '/panczirnik-misissipskij.html',
    imageKey: 6037,
    rationale: 'SAFE_OVERRIDE: topic-specific mixed-script spelling variant',
  },
  '32977': {
    officialTitle: 'Байкальский осетр',
    detailPath: '/bajkalskij-osetr.html',
    imageKey: 7000,
    rationale: 'SAFE_OVERRIDE: topic-specific word-order variant',
  },
  '33053': {
    officialTitle: 'Австралийский пилонос',
    detailPath: '/pilonos-avstarijskij.html',
    imageKey: 7084,
    rationale: 'SAFE_OVERRIDE: topic-specific word-order variant',
  },
  '33057': {
    officialTitle: 'Акула - свинья',
    detailPath: '/akula-svinya.html',
    imageKey: 7065,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33070': {
    officialTitle: 'Рыба луна короткая',
    detailPath: '/ryiba-luna-korotkaya.html',
    imageKey: 7087,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphenation variant',
  },
  '33144': {
    officialTitle: 'Луциан - Бохар',
    detailPath: '/luczian-boxar.html',
    imageKey: 7221,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphenation and capitalization variant',
  },
  '33230': {
    officialTitle: 'Акула - небрия',
    detailPath: '/akula-nebriya.html',
    imageKey: 7600,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33250': {
    officialTitle: 'Мурена - зебра',
    detailPath: '/murena-zebra.html',
    imageKey: 7624,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33251': {
    officialTitle: 'Спинорог позолоченый',
    detailPath: '/spinorog-pozolochenyij.html',
    imageKey: 7644,
    rationale: 'SAFE_OVERRIDE: topic-specific spelling variant',
  },
  '33257': {
    officialTitle: 'Цихлида - колибри',
    detailPath: '/czixlida-kollibri.html',
    imageKey: 7550,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33275': {
    officialTitle: 'Цихлида-дельфин',
    detailPath: '/czixlida-delfin.html',
    imageKey: 7552,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphenation variant',
  },
  '33297': {
    officialTitle: 'Сомик - кукушка',
    detailPath: '/somik-kukushka.html',
    imageKey: 7543,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33299': {
    officialTitle: 'Аристохромис Кpucmu',
    detailPath: '/akula-shelkovaya1.html',
    imageKey: 7500,
    rationale: 'SAFE_OVERRIDE: topic-specific Latin-homoglyph spelling of the same binomial',
  },
  '33319': {
    officialTitle: 'Шпрот таганьикский',
    detailPath: '/shprot-taganikskij.html',
    imageKey: 7555,
    rationale: 'SAFE_OVERRIDE: topic-specific spelling variant',
  },
  '33357': {
    officialTitle: 'Платакс - нетопырь',
    detailPath: '/plataks-netopyir.html',
    imageKey: 7629,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33370': {
    officialTitle: 'Акула - пилохвост',
    detailPath: '/akula-piloxvost.html',
    imageKey: 7701,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33420': {
    officialTitle: 'Акула - нянька усатая',
    detailPath: '/akula-nyanka-usataya.html',
    imageKey: 7804,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33560': {
    officialTitle: 'Креветка - хоббит',
    detailPath: '/krevetka-xobbit.html',
    imageKey: 8053,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33575': {
    officialTitle: 'Усач - гаечный ключ',
    detailPath: '/usach-gaechnyij-klyuch.html',
    imageKey: 8043,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '33700': {
    officialTitle: 'Бычок - трахидерм',
    detailPath: '/byichok-traxiderm.html',
    imageKey: 8202,
    rationale: 'SAFE_OVERRIDE: topic-specific hyphen spacing variant',
  },
  '32381': {
    officialTitle: 'Кит горбатый-альбинос',
    detailPath: '/kit-gorbatyij(albinos).html',
    imageKey: 2426,
    rationale:
      'Existing reviewed topic-specific qualifier mapping; official punctuation remains supplemental',
  },
} as const satisfies Record<string, ExplicitFishImageMapping>;

const MANUAL_CANDIDATE_TITLES = {} as const satisfies Record<string, readonly string[]>;

const NO_IMAGE_MAPPING_CANDIDATE_TITLES = {
  '304': ['Карп чешуйчатый'],
} as const satisfies Record<string, readonly string[]>;

const MISSING_TOPIC_IDS = new Set([
  '127',
  '181',
  '202',
  '735',
  '22706',
  '22722',
  '31414',
  '31415',
  '31658',
  '31659',
  '32068',
  '32069',
  '32070',
  '32472',
  '32782',
]);

export const FULL_FISH_IMAGE_MAPPING_RULES: FishImageMappingRules = {
  explicitMappings: EXPLICIT_MAPPINGS,
  manualCandidateTitles: MANUAL_CANDIDATE_TITLES,
  noImageMappingCandidateTitles: NO_IMAGE_MAPPING_CANDIDATE_TITLES,
  missingTopicIds: MISSING_TOPIC_IDS,
  expectedCounts: { EXACT: 1285, MAPPED: 178, MANUAL: 0, MISSING: 16 },
};

export class FishImageMetadataValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Fish image metadata is invalid:\n- ${issues.join('\n- ')}`);
    this.name = 'FishImageMetadataValidationError';
  }
}

function compareCanonicalIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function canonicalPath(value: string, expectedOrigin = 'https://rus-fishsoft.ru'): string {
  const url = new URL(value, `${expectedOrigin}/`);
  if (url.origin !== expectedOrigin || url.search !== '' || url.hash !== '') {
    throw new FishImageMetadataValidationError([`path must stay on ${expectedOrigin}: ${value}`]);
  }
  return url.pathname;
}

function positiveImageKey(value: string, source: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new FishImageMetadataValidationError([
      `image key is not positive numeric data: ${source}`,
    ]);
  }
  const imageKey = Number(value);
  if (!Number.isSafeInteger(imageKey)) {
    throw new FishImageMetadataValidationError([
      `image key exceeds the safe integer range: ${source}`,
    ]);
  }
  return imageKey;
}

function requiredText(value: string, source: string): string {
  const text = value.trim();
  if (text.length === 0) {
    throw new FishImageMetadataValidationError([`missing text: ${source}`]);
  }
  return text;
}

export function parseOfficialFishListHtml(html: string): OfficialFishListEntry[] {
  const $ = load(html);
  const entries: OfficialFishListEntry[] = [];

  $('.fishItem').each((index, element) => {
    const link = $(element).find('a.ajax_link').first();
    const image = link.find('img').first();
    const listTitle = requiredText(link.find('.title').first().text(), `list card ${index} title`);
    const detailPath = canonicalPath(link.attr('href') ?? '');
    if (!detailPath.endsWith('.html')) {
      throw new FishImageMetadataValidationError([
        `list card ${index} has an invalid detail path: ${detailPath}`,
      ]);
    }
    const middleImagePath = canonicalPath(image.attr('src') ?? '');
    const match = middleImagePath.match(/^\/assets\/images\/fish\/middle\/([1-9]\d*)\.png$/u);
    if (match === null) {
      throw new FishImageMetadataValidationError([
        `list card ${index} has an invalid middle image path: ${middleImagePath}`,
      ]);
    }
    entries.push({
      listTitle,
      detailPath,
      middleImagePath,
      imageKey: positiveImageKey(match[1] ?? '', middleImagePath),
    });
  });

  if (entries.length === 0) {
    throw new FishImageMetadataValidationError(['official list response contains no Fish cards']);
  }
  return entries;
}

export function parseOfficialFishDetailHtml(
  listEntry: OfficialFishListEntry,
  html: string,
): OfficialFishEvidence {
  const $ = load(html);
  const documentTitle = requiredText($('title').first().text(), `${listEntry.detailPath} title`);
  const prefix = 'Русская Рыбалка 3:';
  if (!documentTitle.startsWith(prefix)) {
    throw new FishImageMetadataValidationError([
      `detail title has an unexpected prefix: ${listEntry.detailPath}`,
    ]);
  }
  const detailTitle = requiredText(
    documentTitle.slice(prefix.length),
    `${listEntry.detailPath} Fish title`,
  );
  const bigImagePath = canonicalPath($('#preview_full_image').first().attr('src') ?? '');
  const match = bigImagePath.match(/^\/assets\/images\/fish\/big\/([1-9]\d*)\.png$/u);
  if (match === null) {
    throw new FishImageMetadataValidationError([
      `detail page has an invalid big image path: ${listEntry.detailPath}`,
    ]);
  }
  const bigImageKey = positiveImageKey(match[1] ?? '', bigImagePath);
  const issues = [
    ...(normalizeAuditName(listEntry.listTitle) === normalizeAuditName(detailTitle)
      ? []
      : [`list/detail title mismatch: ${listEntry.listTitle} / ${detailTitle}`]),
    ...(listEntry.imageKey === bigImageKey
      ? []
      : [`middle/big image key mismatch: ${listEntry.imageKey} / ${bigImageKey}`]),
  ];
  if (issues.length > 0) throw new FishImageMetadataValidationError(issues);
  return { ...listEntry, detailTitle, bigImagePath };
}

function groupUnique<T>(
  rows: readonly T[],
  key: (row: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const value = key(row);
    if (result.has(value)) duplicates.push(value);
    else result.set(value, row);
  }
  if (duplicates.length > 0) {
    throw new FishImageMetadataValidationError([
      `duplicate ${label}: ${[...new Set(duplicates)].sort().join(', ')}`,
    ]);
  }
  return result;
}

function validateOfficialEvidence(rows: readonly OfficialFishEvidence[]): void {
  for (const row of rows) {
    if (normalizeAuditName(row.listTitle) !== normalizeAuditName(row.detailTitle)) {
      throw new FishImageMetadataValidationError([
        `list/detail title mismatch: ${row.listTitle} / ${row.detailTitle}`,
      ]);
    }
    const expectedMiddle = `/assets/images/fish/middle/${String(row.imageKey)}.png`;
    const expectedBig = `/assets/images/fish/big/${String(row.imageKey)}.png`;
    if (row.middleImagePath !== expectedMiddle || row.bigImagePath !== expectedBig) {
      throw new FishImageMetadataValidationError([
        `image paths do not agree with numeric key ${String(row.imageKey)}: ${row.listTitle}`,
      ]);
    }
    if (canonicalPath(row.detailPath) !== row.detailPath) {
      throw new FishImageMetadataValidationError([
        `detail path is not canonical: ${row.detailPath}`,
      ]);
    }
    if (!row.detailPath.endsWith('.html')) {
      throw new FishImageMetadataValidationError([
        `detail path is not an HTML page: ${row.detailPath}`,
      ]);
    }
  }
  groupUnique(rows, (row) => normalizeAuditName(row.listTitle), 'official title');
  groupUnique(rows, (row) => row.detailPath, 'official detail path');
  groupUnique(rows, (row) => String(row.imageKey), 'official image key');
}

function countStatuses(
  entries: readonly FishImageManifestEntry[],
): Record<FishImageStatus, number> {
  const counts: Record<FishImageStatus, number> = { EXACT: 0, MAPPED: 0, MANUAL: 0, MISSING: 0 };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

function assertExpectedCounts(
  actual: Readonly<Record<FishImageStatus, number>>,
  expected: Readonly<Record<FishImageStatus, number>>,
): void {
  const issues = FISH_IMAGE_STATUSES.flatMap((status) =>
    actual[status] === expected[status]
      ? []
      : [`${status} count is ${String(actual[status])}, expected ${String(expected[status])}`],
  );
  if (issues.length > 0) throw new FishImageMetadataValidationError(issues);
}

function normalizedSnapshotSha256(rows: readonly OfficialFishEvidence[]): string {
  const sorted = [...rows].sort((left, right) => {
    const leftTitle = normalizeAuditName(left.listTitle);
    const rightTitle = normalizeAuditName(right.listTitle);
    return leftTitle < rightTitle
      ? -1
      : leftTitle > rightTitle
        ? 1
        : left.detailPath < right.detailPath
          ? -1
          : left.detailPath > right.detailPath
            ? 1
            : 0;
  });
  return createHash('sha256').update(stableJson(sorted)).digest('hex');
}

export function buildFishImageMetadataManifest(
  forumFish: readonly ForumFishIdentity[],
  officialEvidence: readonly OfficialFishEvidence[],
  capturedAt: string,
  rules: FishImageMappingRules = FULL_FISH_IMAGE_MAPPING_RULES,
): FishImageMetadataManifest {
  validateOfficialEvidence(officialEvidence);
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new FishImageMetadataValidationError([
      `capturedAt is not an ISO timestamp: ${capturedAt}`,
    ]);
  }
  const forumByTopic = groupUnique(forumFish, (fish) => fish.topicId, 'forumTopicId');
  groupUnique(forumFish, (fish) => fish.canonicalNameNormalized, 'canonical forum Fish name');
  const officialByTitle = groupUnique(
    officialEvidence,
    (entry) => normalizeAuditName(entry.listTitle),
    'official title',
  );
  const claimedPaths = new Set<string>();
  const entries: FishImageManifestEntry[] = [];

  for (const fish of [...forumFish].sort((left, right) =>
    compareCanonicalIds(left.topicId, right.topicId),
  )) {
    const exact = officialByTitle.get(fish.canonicalNameNormalized);
    const aliasCandidates = fish.aliases
      .map((alias) => ({ alias, official: officialByTitle.get(alias.nameNormalized) }))
      .filter(
        (
          candidate,
        ): candidate is {
          alias: ForumFishIdentity['aliases'][number];
          official: OfficialFishEvidence;
        } => candidate.official !== undefined,
      );
    const explicit = rules.explicitMappings[fish.topicId];
    const manualTitles = rules.manualCandidateTitles[fish.topicId];
    const noImageMappingTitles = rules.noImageMappingCandidateTitles[fish.topicId];

    if (exact !== undefined) {
      if (
        aliasCandidates.length > 0 ||
        explicit !== undefined ||
        manualTitles !== undefined ||
        noImageMappingTitles !== undefined
      ) {
        throw new FishImageMetadataValidationError([
          `topic ${fish.topicId} has an exact official title plus another mapping rule`,
        ]);
      }
      if (claimedPaths.has(exact.detailPath)) {
        throw new FishImageMetadataValidationError([
          `official page is claimed twice: ${exact.detailPath}`,
        ]);
      }
      claimedPaths.add(exact.detailPath);
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'EXACT',
        matchRule: 'CANONICAL_EXACT',
        matchedName: fish.canonicalName,
        official: exact,
        candidates: [],
      });
      continue;
    }

    if (aliasCandidates.length > 1) {
      throw new FishImageMetadataValidationError([
        `topic ${fish.topicId} has multiple exact reviewed-alias candidates`,
      ]);
    }
    if (aliasCandidates.length === 1) {
      if (
        explicit !== undefined ||
        manualTitles !== undefined ||
        noImageMappingTitles !== undefined
      ) {
        throw new FishImageMetadataValidationError([
          `topic ${fish.topicId} has a reviewed-alias match plus another mapping rule`,
        ]);
      }
      const candidate = aliasCandidates[0];
      if (candidate === undefined) throw new Error('unreachable alias candidate');
      if (claimedPaths.has(candidate.official.detailPath)) {
        throw new FishImageMetadataValidationError([
          `official page is claimed twice: ${candidate.official.detailPath}`,
        ]);
      }
      claimedPaths.add(candidate.official.detailPath);
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'MAPPED',
        matchRule: 'FORUM_ALIAS_EXACT',
        matchedName: candidate.alias.name,
        official: candidate.official,
        candidates: [],
      });
      continue;
    }

    if (explicit !== undefined) {
      if (manualTitles !== undefined || noImageMappingTitles !== undefined) {
        throw new FishImageMetadataValidationError([
          `topic ${fish.topicId} has an explicit mapping plus a non-mapping decision`,
        ]);
      }
      const official = officialByTitle.get(normalizeAuditName(explicit.officialTitle));
      if (
        official === undefined ||
        official.detailPath !== explicit.detailPath ||
        official.imageKey !== explicit.imageKey
      ) {
        throw new FishImageMetadataValidationError([
          `explicit mapping evidence changed for topic ${fish.topicId}`,
        ]);
      }
      if (claimedPaths.has(official.detailPath)) {
        throw new FishImageMetadataValidationError([
          `official page is claimed twice: ${official.detailPath}`,
        ]);
      }
      claimedPaths.add(official.detailPath);
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'MAPPED',
        matchRule: 'EXPLICIT_TOPIC_MAPPING',
        matchedName: explicit.officialTitle,
        official,
        candidates: [],
      });
      continue;
    }

    if (manualTitles !== undefined) {
      if (noImageMappingTitles !== undefined) {
        throw new FishImageMetadataValidationError([
          `topic ${fish.topicId} is both manual and explicitly rejected`,
        ]);
      }
      const candidates = manualTitles.map((title) => {
        const candidate = officialByTitle.get(normalizeAuditName(title));
        if (candidate === undefined) {
          throw new FishImageMetadataValidationError([
            `manual candidate is absent for topic ${fish.topicId}: ${title}`,
          ]);
        }
        if (claimedPaths.has(candidate.detailPath)) {
          throw new FishImageMetadataValidationError([
            `manual candidate page is already claimed: ${candidate.detailPath}`,
          ]);
        }
        claimedPaths.add(candidate.detailPath);
        return candidate;
      });
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'MANUAL',
        matchRule: 'MANUAL_REVIEW_REQUIRED',
        matchedName: null,
        official: null,
        candidates,
      });
      continue;
    }

    if (noImageMappingTitles !== undefined) {
      const candidates = noImageMappingTitles.map((title) => {
        const candidate = officialByTitle.get(normalizeAuditName(title));
        if (candidate === undefined) {
          throw new FishImageMetadataValidationError([
            `rejected image candidate is absent for topic ${fish.topicId}: ${title}`,
          ]);
        }
        if (claimedPaths.has(candidate.detailPath)) {
          throw new FishImageMetadataValidationError([
            `rejected image candidate page is already claimed: ${candidate.detailPath}`,
          ]);
        }
        claimedPaths.add(candidate.detailPath);
        return candidate;
      });
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'MISSING',
        matchRule: 'NO_IMAGE_MAPPING',
        matchedName: null,
        official: null,
        candidates,
      });
      continue;
    }

    if (rules.missingTopicIds.has(fish.topicId)) {
      entries.push({
        forumTopicId: fish.topicId,
        canonicalName: fish.canonicalName,
        status: 'MISSING',
        matchRule: 'NO_OFFICIAL_CANDIDATE',
        matchedName: null,
        official: null,
        candidates: [],
      });
      continue;
    }

    throw new FishImageMetadataValidationError([
      `topic ${fish.topicId} has no exact, reviewed alias, explicit, manual, or missing decision`,
    ]);
  }

  for (const topicId of [
    ...Object.keys(rules.explicitMappings),
    ...Object.keys(rules.manualCandidateTitles),
    ...Object.keys(rules.noImageMappingCandidateTitles),
    ...rules.missingTopicIds,
  ]) {
    if (!forumByTopic.has(topicId)) {
      throw new FishImageMetadataValidationError([
        `mapping rule references unknown topic ${topicId}`,
      ]);
    }
  }
  const unclaimed = officialEvidence.filter((entry) => !claimedPaths.has(entry.detailPath));
  if (unclaimed.length > 0) {
    throw new FishImageMetadataValidationError([
      `unclaimed official pages: ${unclaimed.map((entry) => entry.listTitle).join(', ')}`,
    ]);
  }
  const counts = countStatuses(entries);
  assertExpectedCounts(counts, rules.expectedCounts);

  return {
    schemaVersion: 1,
    mode: 'AUDIT_MANIFEST_ONLY',
    source: {
      origin: 'https://rus-fishsoft.ru',
      listPage: 'https://rus-fishsoft.ru/list-fish.html',
      dataEndpoint: 'https://rus-fishsoft.ru/ajaxcontent.html',
      requestShape: {
        method: 'POST',
        form: {
          'vars[to]': 'data',
          'vars[sc]': 'fish_list',
          'vars[sort]': '<advertised-letter>',
        },
      },
      capturedAt,
      officialEntries: officialEvidence.length,
      normalizedSnapshotSha256: normalizedSnapshotSha256(officialEvidence),
    },
    policy: {
      forum69CanonicalNameIsAuthoritative: true,
      listAndDetailTitlesAreSupplementalOnly: true,
      fuzzyMatching: false,
      eyoFolding: false,
      punctuationFolding: false,
      slugInference: false,
      imageBinariesDownloaded: false,
      imageHotlinkingEnabled: false,
    },
    counts,
    explicitMappings: Object.fromEntries(
      Object.entries(rules.explicitMappings).sort(([left], [right]) =>
        compareCanonicalIds(left, right),
      ),
    ),
    entries,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeManifestShape(value: unknown): FishImageMetadataManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || value.mode !== 'AUDIT_MANIFEST_ONLY') {
    throw new FishImageMetadataValidationError(['manifest header is invalid']);
  }
  if (!isObject(value.source) || !Array.isArray(value.entries) || !isObject(value.counts)) {
    throw new FishImageMetadataValidationError(['manifest source, counts, or entries are invalid']);
  }
  for (const [index, entry] of value.entries.entries()) {
    if (
      !isObject(entry) ||
      typeof entry.forumTopicId !== 'string' ||
      typeof entry.canonicalName !== 'string' ||
      !FISH_IMAGE_STATUSES.includes(entry.status as FishImageStatus) ||
      !Array.isArray(entry.candidates)
    ) {
      throw new FishImageMetadataValidationError([`manifest entry ${index} has an invalid shape`]);
    }
  }
  return value as unknown as FishImageMetadataManifest;
}

export function validateFishImageMetadataManifest(
  value: unknown,
  forumFish: readonly ForumFishIdentity[],
  rules: FishImageMappingRules = FULL_FISH_IMAGE_MAPPING_RULES,
): FishImageMetadataManifest {
  const manifest = decodeManifestShape(value);
  const evidence = manifest.entries.flatMap((entry) =>
    entry.official === null ? entry.candidates : [entry.official],
  );
  const rebuilt = buildFishImageMetadataManifest(
    forumFish,
    evidence,
    manifest.source.capturedAt,
    rules,
  );
  if (stableJson(manifest) !== stableJson(rebuilt)) {
    throw new FishImageMetadataValidationError([
      'manifest does not equal the deterministic rebuild from its tracked evidence',
    ]);
  }
  return manifest;
}

export function buildFishImageManualReviewAudit(
  manifest: FishImageMetadataManifest,
): FishImageManualReviewAudit {
  const entries = manifest.entries
    .filter((entry) => entry.status === 'MANUAL')
    .map((entry) => ({
      forumTopicId: entry.forumTopicId,
      canonicalName: entry.canonicalName,
      reason:
        'No exact canonical name, exact reviewed forum alias, or approved topic-specific mapping; no fuzzy or normalization expansion was used',
      plausibleOfficialCandidates: entry.candidates.map((candidate) => ({
        ...candidate,
        exactEvidence: {
          canonicalNameNormalized: normalizeAuditName(entry.canonicalName),
          listTitleNormalized: normalizeAuditName(candidate.listTitle),
          detailTitleNormalized: normalizeAuditName(candidate.detailTitle),
          listAndDetailTitlesAgree: true as const,
          middleAndBigImageKeysAgree: true as const,
          automaticIdentityMatch: false as const,
        },
      })),
    }));
  return {
    schemaVersion: 1,
    mode: 'MANUAL_REVIEW_ONLY',
    sourceSnapshotSha256: manifest.source.normalizedSnapshotSha256,
    counts: { MANUAL: entries.length },
    entries,
  };
}

export function fishImageManifestSha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
