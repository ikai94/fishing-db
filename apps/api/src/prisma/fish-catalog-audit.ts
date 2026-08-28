import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

export const QUALIFIER_TOPIC_IDS = new Set(['32381', '33074']);

export const MANUAL_DB_FISH_NAMES = new Set([
  'Акула',
  'Греческий сосуд',
  'Коралловый группер',
  'Красный луциан',
  'Лещ морской',
  'Омар голубой',
  'Панцирник миссисипский',
  'Сева',
  'Скат',
  'Учебная рыба A',
  'Учебная рыба B',
]);

export const EXPLICIT_DB_FISH_RENAMES = new Map<string, string>([
  ['Адамуссиус', 'Адамуссиум'],
  ['Акула песчанная', 'Акула песчаная'],
  ['Акула свинья', 'Акула-свинья'],
  ['Акула-собака', 'Акула - собака'],
  ['Американский угорь', 'Угорь речной американский'],
  ['Апистограммова факельная', 'Апистограмма факельная'],
  ['Байкальский осетр', 'Осетр байкальский'],
  ['Бычок - трахидерм', 'Бычок-трахидерм'],
  ['Голец Дальнеозерный', 'Голец Дальнеозерский'],
  ['Гурами Вейланта', 'Гурами Вайланта'],
  ['Гурами гигантский - альбинос', 'Гурами гигантский-альбинос'],
  ['Кит синий', 'Кит синий (альбинос)'],
  ['Китовая акула', 'Китовая акула - альбинос'],
  ['Клюварыл', 'Клюворыл'],
  ['Комета', 'Комета, Каллоплезиопс'],
  ['Кохаку', 'Кои Кохаку'],
  ['Краб - вампир яванский', 'Краб-вампир яванский'],
  ['Креветка - хоббит', 'Креветка-хоббит'],
  ['Мабула серповидная', 'Мобула серповидная'],
  ['Медуза-пушечное ядро', 'Медуза - пушечное ядро'],
  ['Меланохромис', 'Меланохромис Чипока'],
  ['Мелкочешуйчатый угай', 'Мелкочешуйный угай'],
  ['Морская свянья обыкновенная', 'Морская свинья обыкновенная'],
  ['Морской орел', 'Морской орел пятнистый'],
  ['Носатая энгидрина', 'Энгидрина носатая'],
  ['Окунь-клювач', 'Окунь - клювач'],
  ['Оренжи Огон', 'Кои Оренжи Огон'],
  ['Пигоплит', 'Пигоплит, Королевский ангел'],
  ['Платинум Огон', 'Кои Платинум Огон'],
  ['Пустая бочка', 'Бочка'],
  ['Путассу северный', 'Путассу северная'],
  ['Рыба лира', 'Рыба-лира'],
  ['Рыба луна короткая', 'Рыба-луна короткая'],
  ['Рыба-ремень', 'Рыба-ремень, сельдяной король'],
  ['Свинья аргентинская', 'Морская свинья аргентинская'],
  ['Сиб.голец-усач', 'Сибирский голец-усач'],
  ['Странствующий группер', 'Странствующий групер'],
  ['Усач Итальянский', 'Итальянский усач'],
  ['Уссурийская касатка', 'Уссурийская косатка'],
  ['Цихлида-дельфин', 'Цихлида дельфин'],
  ['Черный краппи', 'Краппи черный'],
  ['Ямабуки Огон', 'Кои Ямабуки Огон'],
]);

export interface ForumPostIdentity {
  topicId: string;
  subforumId: string;
  topicTitle: string;
}

export type ForumFishAliasKind = 'PARENTHETICAL_ALTERNATE' | 'QUALIFIER_PUNCTUATION';

export interface ForumFishAlias {
  kind: ForumFishAliasKind;
  name: string;
  nameNormalized: string;
}

export interface ForumFishIdentity {
  sourceIdentity: string;
  topicId: string;
  subforumId: string;
  sourceTitle: string;
  canonicalName: string;
  canonicalNameNormalized: string;
  aliases: ForumFishAlias[];
  mixedScriptTokens: string[];
}

export interface CatalogFishRow {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
}

export type FishReconciliationCategory =
  | 'EXACT_CANONICAL'
  | 'DISPLAY_RENAME'
  | 'SAFE_EYO_RENAME'
  | 'PARENTHETICAL_ALIAS_RENAME'
  | 'EXPLICIT_RENAME'
  | 'LOCAL_EXTRA'
  | 'REPOINT_DEACTIVATE'
  | 'MANUAL'
  | 'MISSING_CREATE';

export interface FishReconciliationEntry {
  category: FishReconciliationCategory;
  currentFishId: string | null;
  currentName: string | null;
  currentIsActive: boolean | null;
  topicId: string | null;
  canonicalName: string | null;
  preservesFishId: boolean;
  decision: 'KEEP' | 'KEEP_EXTRA' | 'RENAME' | 'CREATE' | 'REPOINT+DEACTIVATE' | 'MANUAL';
  targetIsActive?: boolean;
  repointTargetFishId?: string;
  reason: string;
}

export interface WorkbookBaseDefinition {
  name: string;
  sourceSheet: string;
  fishColumn: string;
}

export interface WorkbookFishCell {
  baseName: string;
  sourceSheet: string;
  sourceCell: string;
  rawName: string;
}

export type WorkbookResolutionCategory =
  | 'CANONICAL_EXACT'
  | 'SAFE_EYO'
  | 'EXPLICIT_FORUM_ALIAS'
  | 'EXCLUDE_NON_FISH'
  | 'EXCLUDE_NOISE'
  | 'DO_NOT_MAP'
  | 'MANUAL';

export interface WorkbookFishResolution {
  baseName: string;
  sourceSheet: string;
  sourceCell: string;
  rawName: string;
  lookupName: string;
  annotationStripped: boolean;
  category: WorkbookResolutionCategory;
  topicId: string | null;
  canonicalName: string | null;
}

interface ZipEntry {
  compressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
}

interface CandidateLike {
  fishNameRaw: string | null;
  resolution: {
    fish: { status: string };
    fishingBase: { status: string; id: string | null; name: string | null };
  };
  issues: { code: string; field?: string }[];
}

export interface ForumRecoveryAudit {
  candidates: {
    total: number;
    currentFishResolved: number;
    currentFishBlocked: number;
  };
  proposedFishResolution: Record<string, number>;
  currentFishBlockedRecovery: {
    fishResolved: number;
    fishResolutionCategories: Record<string, number>;
    membershipResolved: number;
    membershipMissing: number;
    membershipDependencyUnresolved: number;
    usableAfterProjectedMembership: number;
    stillFishUnresolved: number;
  };
  allCandidatesAfterProjection: {
    usableComplete: number;
    usablePartial: number;
    unresolved: number;
    membershipResolved: number;
    membershipMissing: number;
    membershipDependencyUnresolved: number;
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonicalIds(left: string, right: string): number {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function normalizeAuditName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function foldEyo(value: string): string {
  return normalizeAuditName(value).replace(/ё/gu, 'е');
}

function normalizedDisplayName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function mixedScriptTokens(value: string): string[] {
  return value
    .split(/[^\p{L}]+/gu)
    .filter((token) => /[A-Za-z]/u.test(token) && /[А-Яа-яЁё]/u.test(token))
    .sort(compareText);
}

function uniqueIndex<T>(
  items: readonly T[],
  key: (item: T) => string,
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  const collisions = new Set<string>();

  for (const item of items) {
    const identity = key(item);
    if (result.has(identity)) collisions.add(identity);
    else result.set(identity, item);
  }

  if (collisions.size > 0) {
    throw new Error(`${label} collisions: ${[...collisions].sort(compareText).join(', ')}`);
  }

  return result;
}

export function buildForumFishCorpus(posts: readonly ForumPostIdentity[]): ForumFishIdentity[] {
  const topics = new Map<string, ForumPostIdentity>();

  for (const post of posts) {
    const existing = topics.get(post.topicId);
    if (
      existing !== undefined &&
      (existing.topicTitle !== post.topicTitle || existing.subforumId !== post.subforumId)
    ) {
      throw new Error(`forum69 topic ${post.topicId} has conflicting source identity`);
    }
    topics.set(post.topicId, post);
  }

  const corpus = [...topics.values()]
    .sort((left, right) => compareCanonicalIds(left.topicId, right.topicId))
    .map((topic): ForumFishIdentity => {
      const sourceTitle = normalizedDisplayName(topic.topicTitle);
      const parenthetical = sourceTitle.match(/^(.+?)\s*\(([^()]*)\)\s*$/u);
      const isQualifier = QUALIFIER_TOPIC_IDS.has(topic.topicId);
      const canonicalName =
        parenthetical === null || isQualifier
          ? sourceTitle
          : normalizedDisplayName(parenthetical[1] ?? sourceTitle);
      const aliases: ForumFishAlias[] = [];

      if (parenthetical !== null && !isQualifier) {
        const alias = normalizedDisplayName(parenthetical[2] ?? '');
        aliases.push({
          kind: 'PARENTHETICAL_ALTERNATE',
          name: alias,
          nameNormalized: normalizeAuditName(alias),
        });
      }

      if (parenthetical !== null && isQualifier) {
        const qualifierAlias = normalizedDisplayName(
          sourceTitle.replace(/\s*\(([^()]*)\)\s*$/u, ' $1'),
        );
        aliases.push({
          kind: 'QUALIFIER_PUNCTUATION',
          name: qualifierAlias,
          nameNormalized: normalizeAuditName(qualifierAlias),
        });
      }

      return {
        sourceIdentity: `rus-fishsoft:forum69:topic:${topic.topicId}`,
        topicId: topic.topicId,
        subforumId: topic.subforumId,
        sourceTitle,
        canonicalName,
        canonicalNameNormalized: normalizeAuditName(canonicalName),
        aliases,
        mixedScriptTokens: mixedScriptTokens(canonicalName),
      };
    });

  uniqueIndex(corpus, (fish) => fish.canonicalNameNormalized, 'canonical normalized Fish');
  uniqueIndex(corpus, (fish) => foldEyo(fish.canonicalName), 'canonical е/ё-folded Fish');
  return corpus;
}

function corpusIndexes(corpus: readonly ForumFishIdentity[]) {
  const exact = uniqueIndex(
    corpus,
    (fish) => fish.canonicalNameNormalized,
    'canonical normalized Fish',
  );
  const eyo = uniqueIndex(corpus, (fish) => foldEyo(fish.canonicalName), 'canonical е/ё Fish');
  const aliases = new Map<string, ForumFishIdentity[]>();

  for (const fish of corpus) {
    for (const alias of fish.aliases) {
      const matches = aliases.get(alias.nameNormalized) ?? [];
      matches.push(fish);
      aliases.set(alias.nameNormalized, matches);
    }
  }

  return { exact, eyo, aliases };
}

function uniqueAliasMatch(
  aliases: Map<string, ForumFishIdentity[]>,
  value: string,
): ForumFishIdentity | undefined {
  const matches = aliases.get(normalizeAuditName(value));
  return matches?.length === 1 ? matches[0] : undefined;
}

export function buildFishReconciliation(
  currentFish: readonly CatalogFishRow[],
  corpus: readonly ForumFishIdentity[],
): FishReconciliationEntry[] {
  const { exact, eyo, aliases } = corpusIndexes(corpus);
  const entries: FishReconciliationEntry[] = [];

  for (const current of [...currentFish].sort((left, right) => compareText(left.id, right.id))) {
    const exactMatch = exact.get(normalizeAuditName(current.name));
    let category: FishReconciliationCategory;
    let target: ForumFishIdentity | undefined;
    let reason: string;

    if (exactMatch !== undefined) {
      target = exactMatch;
      category = current.name === target.canonicalName ? 'EXACT_CANONICAL' : 'DISPLAY_RENAME';
      reason =
        category === 'EXACT_CANONICAL'
          ? 'Current display name equals the reviewed forum69 primary name'
          : 'Normalized identity matches; display spelling/capitalization must follow forum69';
    } else {
      const eyoMatch = eyo.get(foldEyo(current.name));
      const aliasMatch = uniqueAliasMatch(aliases, current.name);
      const explicitName = EXPLICIT_DB_FISH_RENAMES.get(current.name);
      const explicitMatch =
        explicitName === undefined ? undefined : exact.get(normalizeAuditName(explicitName));

      if (eyoMatch !== undefined) {
        target = eyoMatch;
        category = 'SAFE_EYO_RENAME';
        reason = 'Unique collision-free е/ё fold to the reviewed forum69 primary name';
      } else if (aliasMatch !== undefined) {
        target = aliasMatch;
        category = 'PARENTHETICAL_ALIAS_RENAME';
        reason = 'Current name is an exact reviewed forum69 parenthetical alias';
      } else if (explicitMatch !== undefined) {
        target = explicitMatch;
        category = 'EXPLICIT_RENAME';
        reason = 'Explicit reviewed one-to-one correction; no fuzzy matching used';
      } else {
        if (!MANUAL_DB_FISH_NAMES.has(current.name)) {
          throw new Error(`unclassified current Fish: ${current.id} ${current.name}`);
        }
        category = 'MANUAL';
        reason = 'No authoritative one-to-one forum69 identity decision has been approved';
      }
    }

    entries.push({
      category,
      currentFishId: current.id,
      currentName: current.name,
      currentIsActive: current.isActive,
      topicId: target?.topicId ?? null,
      canonicalName: target?.canonicalName ?? null,
      preservesFishId: true,
      decision:
        category === 'MANUAL' ? 'MANUAL' : category === 'EXACT_CANONICAL' ? 'KEEP' : 'RENAME',
      reason,
    });
  }

  const entriesByTopicId = new Map<string, FishReconciliationEntry[]>();
  for (const entry of entries) {
    if (entry.topicId === null) continue;
    const matches = entriesByTopicId.get(entry.topicId) ?? [];
    matches.push(entry);
    entriesByTopicId.set(entry.topicId, matches);
  }

  for (const [topicId, matches] of entriesByTopicId) {
    if (matches.length < 2) continue;
    const exact = matches.filter((entry) => entry.category === 'EXACT_CANONICAL');
    const keeper = exact.length === 1 ? exact[0] : undefined;
    for (const entry of matches) {
      if (entry === keeper) continue;
      entry.category = 'MANUAL';
      entry.decision = 'MANUAL';
      entry.reason = `Proposed target forum69 topic ${topicId} is already represented by current Fish ${
        keeper?.currentFishId ?? 'without a unique exact keeper'
      }; merge/repoint is not auto-decided`;
    }
  }

  const mappedTopicIds = new Set(
    entries
      .filter((entry) => entry.topicId !== null && entry.category !== 'MANUAL')
      .map((entry) => entry.topicId as string),
  );

  for (const fish of corpus) {
    if (!mappedTopicIds.has(fish.topicId)) {
      entries.push({
        category: 'MISSING_CREATE',
        currentFishId: null,
        currentName: null,
        currentIsActive: null,
        topicId: fish.topicId,
        canonicalName: fish.canonicalName,
        preservesFishId: false,
        decision: 'CREATE',
        reason: 'Canonical forum69 identity has no high-confidence current Fish mapping',
      });
    }
  }

  return entries.sort(
    (left, right) =>
      compareText(left.currentFishId ?? '', right.currentFishId ?? '') ||
      compareCanonicalIds(left.topicId ?? '0', right.topicId ?? '0'),
  );
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('XLSX ZIP end-of-central-directory record is missing');
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('XLSX ZIP central directory is malformed');
    }
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { compressedSize, compressionMethod, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipText(buffer: Buffer, entries: Map<string, ZipEntry>, name: string): string {
  const entry = entries.get(name);
  if (entry === undefined) throw new Error(`XLSX ZIP entry is missing: ${name}`);
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`XLSX ZIP local header is malformed: ${name}`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const bodyOffset = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(bodyOffset, bodyOffset + entry.compressedSize);
  const body =
    entry.compressionMethod === 8
      ? inflateRawSync(compressed)
      : entry.compressionMethod === 0
        ? compressed
        : undefined;
  if (body === undefined) throw new Error(`Unsupported XLSX compression method for ${name}`);
  return body.toString('utf8');
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (_match, entity: string) =>
      String.fromCodePoint(
        entity.toLowerCase().startsWith('x')
          ? Number.parseInt(entity.slice(1), 16)
          : Number.parseInt(entity, 10),
      ),
    )
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, '&');
}

function attribute(value: string, name: string): string | undefined {
  return value.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u'))?.[1];
}

function xmlText(value: string): string {
  return decodeXml(
    [...value.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gu)].map((match) => match[1] ?? '').join(''),
  );
}

export function readWorkbookFishCells(
  workbook: Buffer,
  bases: readonly WorkbookBaseDefinition[],
): WorkbookFishCell[] {
  const entries = readZipEntries(workbook);
  const workbookXml = readZipText(workbook, entries, 'xl/workbook.xml');
  const relationshipsXml = readZipText(workbook, entries, 'xl/_rels/workbook.xml.rels');
  const sharedStringsXml = readZipText(workbook, entries, 'xl/sharedStrings.xml');
  const relationships = new Map<string, string>();

  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]+)\/>/gu)) {
    const id = attribute(match[1] ?? '', 'Id');
    const target = attribute(match[1] ?? '', 'Target');
    if (id !== undefined && target !== undefined) relationships.set(id, target);
  }

  const sheets = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b([^>]+)\/>/gu)) {
    const name = attribute(match[1] ?? '', 'name');
    const relationshipId = attribute(match[1] ?? '', 'r:id');
    const target = relationshipId === undefined ? undefined : relationships.get(relationshipId);
    if (name !== undefined && target !== undefined) sheets.set(decodeXml(name), target);
  }

  const sharedStrings = [...sharedStringsXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gu)].map(
    (match) => xmlText(match[1] ?? ''),
  );
  const cells: WorkbookFishCell[] = [];

  for (const base of bases) {
    const target = sheets.get(base.sourceSheet);
    if (target === undefined) throw new Error(`Workbook sheet is missing: ${base.sourceSheet}`);
    const path = `xl/${target.replace(/^\/?xl\//u, '')}`;
    const worksheet = readZipText(workbook, entries, path);

    cells.push(...readWorksheetFishCells(worksheet, sharedStrings, base));
  }

  return cells.sort(
    (left, right) =>
      compareText(left.baseName, right.baseName) ||
      compareText(left.sourceSheet, right.sourceSheet) ||
      compareText(left.sourceCell.padStart(12, '0'), right.sourceCell.padStart(12, '0')),
  );
}

export function readWorksheetFishCells(
  worksheet: string,
  sharedStrings: readonly string[],
  base: WorkbookBaseDefinition,
): WorkbookFishCell[] {
  const cells: WorkbookFishCell[] = [];
  for (const match of worksheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
    const attributes = match[1] ?? '';
    const reference = attribute(attributes, 'r');
    const referenceMatch = reference?.match(/^([A-Z]+)(\d+)$/u);
    if (referenceMatch?.[1] !== base.fishColumn) continue;
    const body = match[2];
    if (body === undefined) continue;
    const type = attribute(attributes, 't') ?? 'n';
    const rawValue = body.match(/<v>([\s\S]*?)<\/v>/u)?.[1];
    let value: string | undefined;
    if (type === 's' && rawValue !== undefined) value = sharedStrings[Number(rawValue)];
    else if (type === 'inlineStr') value = xmlText(body);
    else if (rawValue !== undefined) value = decodeXml(rawValue);
    const rawName = value?.trim();
    if (rawName === undefined || rawName.length === 0) continue;
    cells.push({
      baseName: base.name,
      sourceSheet: base.sourceSheet,
      sourceCell: reference ?? '',
      rawName,
    });
  }
  return cells;
}

function workbookLookupNames(rawName: string): { name: string; annotationStripped: boolean }[] {
  const exact = normalizedDisplayName(rawName);
  const stripped = normalizedDisplayName(exact.replace(/\s*\([0-9]+\)\s*$/u, ''));
  return stripped === exact
    ? [{ name: exact, annotationStripped: false }]
    : [
        { name: exact, annotationStripped: false },
        { name: stripped, annotationStripped: true },
      ];
}

export function reconcileWorkbookFishCells(
  cells: readonly WorkbookFishCell[],
  corpus: readonly ForumFishIdentity[],
): WorkbookFishResolution[] {
  const { exact, eyo } = corpusIndexes(corpus);
  const sourceTitles = uniqueIndex(
    corpus,
    (fish) => normalizeAuditName(fish.sourceTitle),
    'forum source titles',
  );
  const aliases = new Map<string, ForumFishIdentity[]>();
  for (const fish of corpus) {
    for (const alias of fish.aliases) {
      if (alias.kind !== 'PARENTHETICAL_ALTERNATE') continue;
      const matches = aliases.get(alias.nameNormalized) ?? [];
      matches.push(fish);
      aliases.set(alias.nameNormalized, matches);
    }
  }

  return cells.map((cell): WorkbookFishResolution => {
    const lookups = workbookLookupNames(cell.rawName);

    const sourceTitleMatch = sourceTitles.get(normalizeAuditName(cell.rawName));
    if (sourceTitleMatch !== undefined) {
      return {
        ...cell,
        lookupName: cell.rawName,
        annotationStripped: false,
        category: 'CANONICAL_EXACT',
        topicId: sourceTitleMatch.topicId,
        canonicalName: sourceTitleMatch.canonicalName,
      };
    }

    for (const lookup of lookups) {
      const match = exact.get(normalizeAuditName(lookup.name));
      if (match !== undefined) {
        return {
          ...cell,
          lookupName: lookup.name,
          annotationStripped: lookup.annotationStripped,
          category: 'CANONICAL_EXACT',
          topicId: match.topicId,
          canonicalName: match.canonicalName,
        };
      }
    }

    for (const lookup of lookups) {
      const match = eyo.get(foldEyo(lookup.name));
      if (match !== undefined) {
        return {
          ...cell,
          lookupName: lookup.name,
          annotationStripped: lookup.annotationStripped,
          category: 'SAFE_EYO',
          topicId: match.topicId,
          canonicalName: match.canonicalName,
        };
      }
    }

    for (const lookup of lookups) {
      const match = uniqueAliasMatch(aliases, lookup.name);
      if (match !== undefined) {
        return {
          ...cell,
          lookupName: lookup.name,
          annotationStripped: lookup.annotationStripped,
          category: 'EXPLICIT_FORUM_ALIAS',
          topicId: match.topicId,
          canonicalName: match.canonicalName,
        };
      }
    }

    return {
      ...cell,
      lookupName: lookups.at(-1)?.name ?? cell.rawName,
      annotationStripped: lookups.at(-1)?.annotationStripped ?? false,
      category: 'MANUAL',
      topicId: null,
      canonicalName: null,
    };
  });
}

function resolveForumFish(
  rawName: string | null,
  indexes: ReturnType<typeof corpusIndexes>,
): { category: 'EXACT' | 'SAFE_EYO' | 'EXPLICIT_ALIAS' | 'UNRESOLVED'; fish?: ForumFishIdentity } {
  if (rawName === null) return { category: 'UNRESOLVED' };
  const { exact, eyo, aliases } = indexes;
  const exactMatch = exact.get(normalizeAuditName(rawName));
  if (exactMatch !== undefined) return { category: 'EXACT', fish: exactMatch };
  const eyoMatch = eyo.get(foldEyo(rawName));
  if (eyoMatch !== undefined) return { category: 'SAFE_EYO', fish: eyoMatch };
  const aliasMatch = uniqueAliasMatch(aliases, rawName);
  return aliasMatch === undefined
    ? { category: 'UNRESOLVED' }
    : { category: 'EXPLICIT_ALIAS', fish: aliasMatch };
}

function issueIsBlocking(issue: { field?: string }): boolean {
  return !new Set([
    'holeDepthCm',
    'spotPositionRaw',
    'fishingNote',
    'spinningSize',
    'spinningSpeed',
    'userNoteRaw',
  ]).has(issue.field ?? '');
}

export function buildForumRecoveryAudit(
  candidates: readonly CandidateLike[],
  corpus: readonly ForumFishIdentity[],
  workbookResolutions: readonly WorkbookFishResolution[],
  fishingBaseNamesById: ReadonlyMap<string, string>,
): ForumRecoveryAudit {
  const projectedMemberships = new Set(
    workbookResolutions
      .filter((row) => row.topicId !== null)
      .map((row) => `${normalizeAuditName(row.baseName)}\0${row.topicId}`),
  );
  const indexes = corpusIndexes(corpus);
  const result: ForumRecoveryAudit = {
    candidates: { total: candidates.length, currentFishResolved: 0, currentFishBlocked: 0 },
    proposedFishResolution: { EXACT: 0, SAFE_EYO: 0, EXPLICIT_ALIAS: 0, UNRESOLVED: 0 },
    currentFishBlockedRecovery: {
      fishResolved: 0,
      fishResolutionCategories: { EXACT: 0, SAFE_EYO: 0, EXPLICIT_ALIAS: 0 },
      membershipResolved: 0,
      membershipMissing: 0,
      membershipDependencyUnresolved: 0,
      usableAfterProjectedMembership: 0,
      stillFishUnresolved: 0,
    },
    allCandidatesAfterProjection: {
      usableComplete: 0,
      usablePartial: 0,
      unresolved: 0,
      membershipResolved: 0,
      membershipMissing: 0,
      membershipDependencyUnresolved: 0,
    },
  };

  for (const candidate of candidates) {
    const wasFishBlocked = candidate.resolution.fish.status !== 'RESOLVED';
    if (wasFishBlocked) result.candidates.currentFishBlocked += 1;
    else result.candidates.currentFishResolved += 1;
    const fish = resolveForumFish(candidate.fishNameRaw, indexes);
    result.proposedFishResolution[fish.category] =
      (result.proposedFishResolution[fish.category] ?? 0) + 1;

    let membership: 'RESOLVED' | 'MISSING' | 'DEPENDENCY_UNRESOLVED';
    const baseResolution = candidate.resolution.fishingBase;
    const baseName =
      baseResolution.name ??
      (baseResolution.id === null ? undefined : fishingBaseNamesById.get(baseResolution.id));
    if (fish.fish === undefined || baseResolution.status !== 'RESOLVED' || baseName === undefined) {
      membership = 'DEPENDENCY_UNRESOLVED';
    } else if (projectedMemberships.has(`${normalizeAuditName(baseName)}\0${fish.fish.topicId}`)) {
      membership = 'RESOLVED';
    } else {
      membership = 'MISSING';
    }
    result.allCandidatesAfterProjection[
      membership === 'RESOLVED'
        ? 'membershipResolved'
        : membership === 'MISSING'
          ? 'membershipMissing'
          : 'membershipDependencyUnresolved'
    ] += 1;

    if (wasFishBlocked) {
      if (fish.fish === undefined) result.currentFishBlockedRecovery.stillFishUnresolved += 1;
      else {
        result.currentFishBlockedRecovery.fishResolved += 1;
        result.currentFishBlockedRecovery.fishResolutionCategories[fish.category] =
          (result.currentFishBlockedRecovery.fishResolutionCategories[fish.category] ?? 0) + 1;
        result.currentFishBlockedRecovery[
          membership === 'RESOLVED'
            ? 'membershipResolved'
            : membership === 'MISSING'
              ? 'membershipMissing'
              : 'membershipDependencyUnresolved'
        ] += 1;
      }
    }

    const remainingIssues = candidate.issues.filter(
      (issue) => issue.field !== 'fish' && issue.field !== 'fishingBaseFish',
    );
    if (fish.fish === undefined) remainingIssues.push({ code: 'UNRESOLVED_FISH', field: 'fish' });
    if (membership === 'MISSING') {
      remainingIssues.push({
        code: 'MISSING_FISHING_BASE_FISH_MEMBERSHIP',
        field: 'fishingBaseFish',
      });
    }
    const blocking = remainingIssues.some(issueIsBlocking);
    if (blocking) result.allCandidatesAfterProjection.unresolved += 1;
    else if (remainingIssues.length > 0) result.allCandidatesAfterProjection.usablePartial += 1;
    else result.allCandidatesAfterProjection.usableComplete += 1;
    if (wasFishBlocked && !blocking && membership === 'RESOLVED') {
      result.currentFishBlockedRecovery.usableAfterProjectedMembership += 1;
    }
  }

  return result;
}

export function countByCategory<T extends { category: string }>(
  rows: readonly T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.category] = (counts[row.category] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => compareText(left, right)),
  );
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2).replace(
    /\[\n\s+("(?:[^"\\]|\\.)*")\n\s+\]/gu,
    '[$1]',
  );
  return `${json}\n`;
}

export function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
