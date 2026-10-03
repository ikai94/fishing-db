import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from '../prisma/prisma-adapter.js';
import { normalizeCatalogName } from '../catalog/catalog-normalization.js';
import {
  RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN,
  VALID_RAW_SOURCE_TEXT_PATTERN,
} from '../catch-reports/catch-report-raw-note.js';
import {
  ForumLocalStore,
  readJsonFile,
  sha256Hex,
  writeFileAtomic,
  writeJsonAtomic,
} from './cache.js';
import {
  loadCatalogSnapshot,
  fingerprintCatalogSnapshot,
  type CatalogSnapshot,
} from './catalog-source.js';
import {
  assertCandidateIdentityStable,
  buildCandidateIdentityManifest,
  type CandidateIdentityManifest,
} from './candidate-identity-manifest.js';
import type { ParsedForumCandidate, TechnicalForumPost } from './candidate-types.js';
import { parseForumPost } from './forum-post-parser.js';
import { extractTopicPage, getTopicIdFromUrl } from './invision-html.js';
import { readTechnicalPosts } from './scanner.js';
import { readVerifiedForumStagingBundle } from './staging-reader.js';
import type { StagingCandidate } from './staging.js';
import { parseForum83Post } from './forum83/parser.js';
import { extractForum83TopicPage } from './forum83/html.js';
import { readForum83TechnicalPosts } from './forum83/scanner.js';
import { readVerifiedForum83ReviewedAuditBundle } from './forum83/reviewed-audit.js';
import { createForum83Store } from './forum83/store.js';
import { bindingByTopicId, loadForum83TopicMap } from './forum83/topic-map.js';
import {
  COMMENT_RECOVERY_PREFIXES,
  classifyRecoveryMatch,
  currentParserDifferences,
  isHistoricalForumKey,
  recoverySourceLine,
  recoveredCommentDecision,
  snapshotCommentParser,
  type RecoveryRow,
} from './comment-recovery.js';

/** Замороженные источники: не сканируем новые посты и не перезаписываем старые артефакты. */
interface FrozenRecoverySource {
  name: 'forum69' | 'forum83';
  posts: TechnicalForumPost[];
  candidates: StagingCandidate[];
  parsed: ParsedForumCandidate[];
  identities: CandidateIdentityManifest;
  files: Array<{ path: string; sha256: string }>;
  pagesRead: number;
  duplicatePostOccurrences: number;
}

/** Полный локальный план содержит только разрешённую пару id → userNoteRaw и precondition hash. */
interface CommentRecoveryCandidate {
  id: string;
  importKey: string;
  userNoteRaw: string;
  baselineSha256: string;
  source: {
    forum: string;
    topicId: string;
    postId: string;
    candidateOrdinal: number;
    bodySha256: string;
    sourceLineSha256: string;
  };
  parserDisagreements: string[];
}

/** Читает обязательный frozen JSON, отсутствие которого не допускает предположений. */
async function requiredJson<T>(path: string): Promise<T> {
  const value = await readJsonFile<T>(path);
  if (value === null) throw new Error(`Missing frozen artifact: ${path}`);
  return value;
}

/** Отпечаток файла связывает dry-run с исходниками и конкретными frozen артефактами. */
async function fileHash(path: string): Promise<{ path: string; sha256: string }> {
  return { path, sha256: sha256Hex(await readFile(path)) };
}

/**
 * Повторно извлекает авторский текст из оригинального HTTP-кэша через HTML-код импортера.
 * Повторы одинаковых постов считаются отдельно; конфликт тела, автора или контекста останавливает
 * запуск, поскольку одно лишь совпадение ordinal больше не доказывает прежнюю observation.
 */
async function verifyOriginalPages(
  store: ForumLocalStore,
  urls: string[],
  posts: TechnicalForumPost[],
  forum83: boolean,
): Promise<{ pagesRead: number; duplicatePostOccurrences: number }> {
  const wanted = new Map(posts.map((post) => [post.postId, post]));
  const seen = new Set<string>();
  let duplicatePostOccurrences = 0;
  let pagesRead = 0;
  for (const url of urls) {
    const topicId = getTopicIdFromUrl(new URL(url));
    if (topicId === null) continue;
    const entry = await store.readHttp(url);
    if (entry === null) throw new Error(`Missing or corrupt original HTTP cache: ${url}`);
    let extracted: TechnicalForumPost[];
    if (forum83) {
      extracted = extractForum83TopicPage(entry.body, entry.metadata.finalUrl, topicId).posts;
    } else {
      const page = extractTopicPage(entry.body, entry.metadata.finalUrl, {
        expectedTopicId: topicId,
      });
      extracted = page.posts.map((post) => ({
        subforumId: page.subforumId,
        topicId: page.topicId,
        topicTitle: page.title,
        postId: post.postId,
        memberId: post.memberId,
        bodyText: post.authorText,
      }));
    }
    for (const post of extracted) {
      const expected = wanted.get(post.postId);
      if (expected === undefined) continue;
      if (
        Object.keys(expected).some(
          (key) =>
            post[key as keyof TechnicalForumPost] !== expected[key as keyof TechnicalForumPost],
        )
      ) {
        throw new Error(`Original HTML differs from pinned post ${post.postId}`);
      }
      if (seen.has(post.postId)) duplicatePostOccurrences += 1;
      seen.add(post.postId);
    }
    pagesRead += 1;
    if (pagesRead % 200 === 0)
      console.info(`Re-read ${forum83 ? 'forum83' : 'forum69'}: ${pagesRead} original pages`);
  }
  const missing = posts.filter((post) => !seen.has(post.postId));
  if (missing.length > 0)
    throw new Error(
      `Original HTML lacks ${missing.length} pinned posts: ${missing
        .slice(0, 10)
        .map((post) => post.postId)
        .join(', ')}`,
    );
  return { pagesRead, duplicatePostOccurrences };
}

/** Загружает оба frozen import набора и доказывает неизменность post/candidate identity. */
async function readFrozenSources(root69: string, root83: string): Promise<FrozenRecoverySource[]> {
  const result: FrozenRecoverySource[] = [];
  for (const name of ['forum69', 'forum83'] as const) {
    const is83 = name === 'forum83';
    const store = is83 ? createForum83Store(root83) : new ForumLocalStore(root69);
    const scope = is83 ? 'forum83-all-forum-83' : 'all-parent-69';
    const output = store.outputDirectory(scope);
    const scanPath = join(output, 'technical/scan.json');
    const scan = await requiredJson<{
      scopeKey: string;
      complete: boolean;
      truncated: boolean;
      sourceChangedPostIds: string[];
      postIds: string[];
      completedPageUrls?: string[];
      completedTopicPageUrls?: string[];
    }>(scanPath);
    if (
      scan.scopeKey !== scope ||
      !scan.complete ||
      scan.truncated ||
      scan.sourceChangedPostIds.length > 0 ||
      new Set(scan.postIds).size !== scan.postIds.length
    ) {
      throw new Error(`Incomplete or changed frozen scan: ${scope}`);
    }
    const posts = is83
      ? await readForum83TechnicalPosts(store, scan.postIds)
      : await readTechnicalPosts(store, scan.postIds);
    const identitiesPath = join(output, 'technical/candidate-identities.json');
    const identityArtifact = await requiredJson<
      CandidateIdentityManifest | { candidateIdentities: CandidateIdentityManifest }
    >(identitiesPath);
    const identities =
      'candidateIdentities' in identityArtifact
        ? identityArtifact.candidateIdentities
        : identityArtifact;
    const parsed: ParsedForumCandidate[] = [];
    if (is83) {
      // Старые границы forum83 зависели от словарей: используем его frozen каталог и topic map.
      const catalog = await requiredJson<CatalogSnapshot>(
        join(output, 'technical/catalog-snapshot.json'),
      );
      const { fingerprint, ...data } = catalog;
      if (fingerprintCatalogSnapshot(data) !== fingerprint)
        throw new Error('Frozen forum83 catalog checksum mismatch');
      const bindings = bindingByTopicId(loadForum83TopicMap().map);
      for (const post of posts) {
        const binding = bindings.get(post.topicId);
        const base = catalog.fishingBases.filter(
          (item) =>
            item.nameNormalized === normalizeCatalogName(binding?.baseName ?? '').nameNormalized,
        );
        if (
          binding === undefined ||
          post.topicTitle !== binding.topicTitle ||
          base.length !== 1 ||
          base[0] === undefined
        )
          throw new Error(`Invalid frozen forum83 context: ${post.postId}`);
        parsed.push(
          ...parseForum83Post(post, {
            baseName: binding.baseName,
            locationNames: catalog.locations
              .filter((item) => item.fishingBaseId === base[0]?.id)
              .map((item) => item.name),
            fishNames: catalog.fish.map((item) => item.name),
            baitNames: catalog.baits.map((item) => item.name),
          }),
        );
      }
    } else {
      for (const post of posts) parsed.push(...parseForumPost(post));
    }
    const currentIdentities = buildCandidateIdentityManifest(scope, posts, parsed);
    assertCandidateIdentityStable(identities, currentIdentities);
    // Recovery не принимает даже append: population должна оставаться именно замороженной.
    if (JSON.stringify(identities) !== JSON.stringify(currentIdentities))
      throw new Error(`Frozen population changed: ${scope}`);
    const staging = is83 ? join(output, 'staging') : join(output, 'recovery/fish-catalog/staging');
    const bundle = is83
      ? (await readVerifiedForum83ReviewedAuditBundle(output)).bundle
      : await readVerifiedForumStagingBundle(staging);
    const parsedByKey = new Map(parsed.map((candidate) => [candidate.importKey, candidate]));
    if (
      parsedByKey.size !== parsed.length ||
      bundle.candidates.length !== parsed.length ||
      bundle.candidates.some(
        (candidate) =>
          parsedByKey.get(candidate.importKey)?.contributorKey !== candidate.contributorKey,
      )
    ) {
      throw new Error(`Frozen candidate identity/contributor population mismatch: ${scope}`);
    }
    const pages = await verifyOriginalPages(
      store,
      scan.completedTopicPageUrls ?? scan.completedPageUrls ?? [],
      posts,
      is83,
    );
    const paths = [
      scanPath,
      identitiesPath,
      join(staging, 'manifest.json'),
      join(staging, 'candidates.jsonl'),
    ];
    if (is83)
      paths.push(
        join(output, 'technical/catalog-snapshot.json'),
        join(output, 'technical/topic-map.json'),
      );
    result.push({
      name,
      posts,
      parsed,
      identities,
      candidates: bundle.candidates,
      files: await Promise.all(paths.map(fileHash)),
      ...pages,
    });
    console.info(`Verified ${name}: ${posts.length} posts, ${parsed.length} frozen observations`);
  }
  return result;
}

/** PostgreSQL сам запрещает data writes; обработка HTML/парсинг идут уже после короткого снимка. */
async function readDatabaseSnapshot(databaseUrl: string) {
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    return await prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        const catalog = await loadCatalogSnapshot(transaction);
        const anchors = await transaction.screenAnchor.findMany({
          where: { isActive: true },
          select: { name: true, nameNormalized: true },
          orderBy: { nameNormalized: 'asc' },
        });
        const rows = await transaction.catchReport.findMany({
          where: {
            OR: COMMENT_RECOVERY_PREFIXES.map((prefix) => ({ importKey: { startsWith: prefix } })),
          },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            userId: true,
            contributorKey: true,
            importKey: true,
            fishId: true,
            baitId: true,
            locationId: true,
            weightGrams: true,
            fishingMethod: true,
            holeDepthCm: true,
            spotPositionRaw: true,
            fishingNote: true,
            spinningSize: true,
            spinningSpeed: true,
            userNoteRaw: true,
            rawSourceText: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        if (rows.some((row) => !isHistoricalForumKey(row.importKey)))
          throw new Error('Unexpected historical importKey suffix');
        return { catalog, anchors, rows };
      },
      { isolationLevel: 'RepeatableRead', timeout: 30_000 },
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** Выполняет исключительно dry-run и сохраняет локальные проверяемые результаты. */
export async function runCommentRecoveryDryRun(args: readonly string[]): Promise<void> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      !['--output', '--forum69-root', '--forum83-root'].includes(flag) ||
      options.has(flag)
    )
      throw new Error(
        'Only --output, --forum69-root and --forum83-root are supported; this command has no write mode',
      );
    options.set(flag, resolve(value));
  }
  const root69 = options.get('--forum69-root') ?? new ForumLocalStore().rootPath;
  const root83 = options.get('--forum83-root') ?? createForum83Store().rootPath;
  const output = options.get('--output') ?? join(root69, 'comment-recovery/dry-run');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const sources = await readFrozenSources(root69, root83);
  const { catalog, anchors, rows } = await readDatabaseSnapshot(databaseUrl);
  const targetRows = rows.filter((row) => row.rawSourceText === null);
  const byKey = new Map<string, StagingCandidate[]>();
  const technicalByKey = new Map<
    string,
    {
      source: FrozenRecoverySource;
      post: TechnicalForumPost;
      boundary: CandidateIdentityManifest['posts'][number]['candidates'][number];
      boundaries: CandidateIdentityManifest['posts'][number]['candidates'];
    }
  >();
  for (const source of sources) {
    for (const candidate of source.candidates)
      byKey.set(candidate.importKey, [...(byKey.get(candidate.importKey) ?? []), candidate]);
    const posts = new Map(source.posts.map((post) => [post.postId, post]));
    for (const identity of source.identities.posts) {
      const post = posts.get(identity.postId);
      if (post === undefined || sha256Hex(post.bodyText) !== identity.bodySha256)
        throw new Error(`Missing or changed frozen body: ${identity.postId}`);
      for (const boundary of identity.candidates)
        technicalByKey.set(boundary.importKey, {
          source,
          post,
          boundary,
          boundaries: identity.candidates,
        });
    }
  }
  const counts = {
    totalHistoricalForumCatchReports: rows.length,
    missingRawSourceText: targetRows.length,
    sourceObservationsRediscovered: sources.reduce(
      (total, source) => total + source.parsed.length,
      0,
    ),
    exactUniqueMatches: 0,
    ambiguousMatches: 0,
    missingMatches: 0,
    frozenStructuredMismatches: 0,
    duplicateSourceImportKeys: [...byKey.values()].filter((items) => items.length > 1).length,
    nullToCommentCandidates: 0,
    existingCommentsPreserved: targetRows.filter((row) => row.userNoteRaw !== null).length,
    currentParserDisagreements: 0,
    candidatesWithParserDisagreements: 0,
    commentsHeldForCoreMismatch: 0,
    noComment: 0,
  };
  const repeatedTexts = new Map<string, number>();
  for (const source of sources) {
    for (const post of source.identities.posts) {
      for (const boundary of post.candidates) {
        const key = `${source.name}:${post.postId}:${boundary.sourceTextSha256}`;
        repeatedTexts.set(key, (repeatedTexts.get(key) ?? 0) + 1);
      }
    }
  }
  const cases: Array<Record<string, unknown>> = [];
  const reasons: Record<string, number> = {};
  const eligible: CommentRecoveryCandidate[] = [];
  const parseItems: Array<{
    row: RecoveryRow;
    sourceLine: string;
    technical: NonNullable<ReturnType<typeof technicalByKey.get>>;
  }> = [];
  for (const row of targetRows) {
    const key = row.importKey;
    if (key === null) throw new Error('Target lost importKey');
    const match = classifyRecoveryMatch(row, byKey.get(key) ?? []);
    if (match.status !== 'EXACT') {
      if (match.status === 'MISSING') counts.missingMatches += 1;
      else if (match.status === 'AMBIGUOUS') counts.ambiguousMatches += 1;
      else counts.frozenStructuredMismatches += 1;
      cases.push({ id: row.id, importKey: key, status: match.status, fields: match.fields });
      continue;
    }
    counts.exactUniqueMatches += 1;
    const technical = technicalByKey.get(key);
    if (technical === undefined) throw new Error('Matched key lacks frozen source boundary');
    const line = recoverySourceLine(
      technical.post.bodyText,
      technical.boundary,
      technical.boundaries,
      technical.source.name === 'forum83',
    );
    if (line.source === null) {
      const reason = line.reason ?? 'UNKNOWN_SOURCE_FAILURE';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      cases.push({ id: row.id, postId: technical.post.postId, status: reason });
      continue;
    }
    if (
      !RAW_SOURCE_TEXT_MAX_LENGTH_PATTERN.test(line.source) ||
      !VALID_RAW_SOURCE_TEXT_PATTERN.test(line.source)
    ) {
      reasons.INVALID_PARSER_SOURCE = (reasons.INVALID_PARSER_SOURCE ?? 0) + 1;
      cases.push({ id: row.id, postId: technical.post.postId, status: 'INVALID_PARSER_SOURCE' });
      continue;
    }
    parseItems.push({ row, sourceLine: line.source, technical });
  }
  const parser = snapshotCommentParser(catalog, anchors);
  for (let offset = 0; offset < parseItems.length; offset += 250) {
    const batch = parseItems.slice(offset, offset + 250);
    const parsed = await parser.parseBatch(batch.map((item) => item.sourceLine).join('\n'));
    if (parsed.rows.length !== batch.length)
      throw new Error('Current parser changed source row population');
    for (const [index, item] of batch.entries()) {
      const draft = parsed.rows[index]?.draft;
      if (draft === undefined) throw new Error('Current parser omitted a source line');
      const disagreements = currentParserDifferences(item.row, draft);
      if (disagreements.length > 0) {
        counts.currentParserDisagreements += 1;
        cases.push({
          id: item.row.id,
          postId: item.technical.post.postId,
          status: 'CURRENT_PARSER_DISAGREEMENT',
          fields: disagreements,
          stored: Object.fromEntries(
            disagreements.map((field) => [field, item.row[field as keyof RecoveryRow]]),
          ),
          parsed: draft.fields,
        });
      }
      const decision = recoveredCommentDecision(item.row, draft);
      if (decision.status === 'PRESERVED') continue;
      if (decision.status === 'HELD') {
        if (decision.reason === 'CORE_MISMATCH') {
          counts.commentsHeldForCoreMismatch += 1;
          continue;
        }
        const reason = decision.reason ?? 'UNKNOWN_COMMENT_FAILURE';
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        cases.push({ id: item.row.id, postId: item.technical.post.postId, status: reason });
        continue;
      }
      if (decision.status === 'NO_COMMENT') {
        counts.noComment += 1;
        continue;
      }
      if (decision.note === null) throw new Error('Recovery candidate lacks a comment');
      if (disagreements.length > 0) counts.candidatesWithParserDisagreements += 1;
      eligible.push({
        id: item.row.id,
        importKey: item.row.importKey ?? '',
        userNoteRaw: decision.note,
        baselineSha256: sha256Hex(JSON.stringify(item.row)),
        source: {
          forum: item.technical.source.name,
          topicId: item.technical.post.topicId,
          postId: item.technical.post.postId,
          candidateOrdinal: item.technical.boundary.candidateOrdinal,
          bodySha256: sha256Hex(item.technical.post.bodyText),
          sourceLineSha256: sha256Hex(item.sourceLine),
        },
        parserDisagreements: disagreements,
      });
    }
    if (offset % 5_000 === 0)
      console.info(
        `Current parser: ${Math.min(offset + batch.length, parseItems.length)}/${parseItems.length}`,
      );
  }
  eligible.sort((left, right) => left.id.localeCompare(right.id));
  counts.nullToCommentCandidates = eligible.length;
  const dbKeys = new Set(rows.map((row) => row.importKey));
  const sourceWithoutReports = sources.flatMap((source) =>
    source.candidates
      .filter((candidate) => !dbKeys.has(candidate.importKey))
      .map((candidate) => ({
        forum: source.name,
        importKey: candidate.importKey,
        frozenStatus: candidate.status,
      })),
  );
  const planJsonl = eligible.map((candidate) => `${JSON.stringify(candidate)}\n`).join('');
  const codePaths = [
    'comment-recovery.ts',
    'recover-comments-dry-run.ts',
    'forum-post-parser.ts',
    'forum83/parser.ts',
    '../catch-reports/parser/catch-report-parser.service.ts',
    '../catch-reports/parser/game-line-parser.ts',
    '../catch-reports/parser/observation-parser.ts',
    '../catch-reports/parser/numeric-parsers.ts',
    '../catch-reports/parser/catch-report-batch-splitter.ts',
    '../catch-reports/catch-report-raw-note.ts',
    '../catalog/catalog-lookup.ts',
    '../catalog/catalog-normalization.ts',
    '../catch-reports/catch-reports.constants.ts',
    'identity.ts',
    'forum83/identity.ts',
    'forum83/constants.ts',
    'invision-html.ts',
    'forum83/html.ts',
    'forum83/reviewed-decisions.ts',
  ];
  const codeHashes = await Promise.all(
    codePaths.map((path) => fileHash(new URL(path, import.meta.url).pathname)),
  );
  const report = {
    version: 1,
    mode: 'DRY_RUN_ONLY',
    writesPerformed: 0,
    counts,
    repeatedIdenticalSourceTextWithinPost: {
      groups: [...repeatedTexts.values()].filter((count) => count > 1).length,
      observations: [...repeatedTexts.values()]
        .filter((count) => count > 1)
        .reduce((total, count) => total + count, 0),
      treatment: 'DISTINCT_POST_ORDINAL_IDENTITIES; NEVER_CONTENT_MATCHED_OR_DEDUPLICATED',
    },
    sources: sources.map((source) => ({
      forum: source.name,
      posts: source.posts.length,
      observations: source.parsed.length,
      pagesRead: source.pagesRead,
      duplicatePostOccurrences: source.duplicatePostOccurrences,
      files: source.files,
    })),
    sourceWithoutReports: {
      total: sourceWithoutReports.length,
      frozenComplete: sourceWithoutReports.filter((item) => item.frozenStatus === 'USABLE_COMPLETE')
        .length,
      excluded: sourceWithoutReports.filter((item) => item.frozenStatus !== 'USABLE_COMPLETE')
        .length,
    },
    interpretationExclusions: reasons,
    examples: [
      ...sources.flatMap((source) =>
        eligible.filter((item) => item.source.forum === source.name).slice(0, 5),
      ),
      ...eligible.filter((item) => item.parserDisagreements.length > 0).slice(0, 5),
    ],
    issueExamples: cases
      .filter((item) => item.status !== 'CURRENT_PARSER_DISAGREEMENT')
      .slice(0, 10),
    parserDisagreementExamples: cases
      .filter((item) => item.status === 'CURRENT_PARSER_DISAGREEMENT')
      .slice(0, 5),
    catalogFingerprint: catalog.fingerprint,
    codeHashes,
    databaseSnapshotSha256: sha256Hex(JSON.stringify(rows)),
    planSha256: sha256Hex(planJsonl),
    planRows: eligible.length,
    readyForWrite:
      counts.totalHistoricalForumCatchReports === 69_403 &&
      counts.missingRawSourceText === 69_403 &&
      counts.missingMatches === 0 &&
      counts.ambiguousMatches === 0 &&
      counts.frozenStructuredMismatches === 0 &&
      counts.duplicateSourceImportKeys === 0,
  };
  await writeFileAtomic(join(output, 'candidates.jsonl'), planJsonl);
  await writeFileAtomic(
    join(output, 'cases.jsonl'),
    cases.map((item) => `${JSON.stringify(item)}\n`).join(''),
  );
  await writeFileAtomic(
    join(output, 'source-without-reports.jsonl'),
    sourceWithoutReports.map((item) => `${JSON.stringify(item)}\n`).join(''),
  );
  await writeJsonAtomic(join(output, 'report.json'), report);
  console.info(
    JSON.stringify(
      {
        counts,
        sourceWithoutReports: report.sourceWithoutReports,
        interpretationExclusions: reasons,
        examples: report.examples,
        readyForWrite: report.readyForWrite,
        output,
      },
      null,
      2,
    ),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runCommentRecoveryDryRun(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Forum comment dry-run failed');
    process.exitCode = 1;
  });
}
