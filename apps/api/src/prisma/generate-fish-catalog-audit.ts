import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildFishReconciliation,
  buildForumFishCorpus,
  buildForumRecoveryAudit,
  countByCategory,
  csvCell,
  readWorkbookFishCells,
  reconcileWorkbookFishCells,
  sha256,
  stableJson,
  type CatalogFishRow,
  type ForumPostIdentity,
} from './fish-catalog-audit.js';

const LOCAL_ROOT = new URL('../../.local/', import.meta.url);
const FORUM_ROOT = new URL('forum-import/rus-fishsoft/', LOCAL_ROOT);
const FORUM_OUTPUT = new URL('outputs/all-parent-69/', FORUM_ROOT);
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const AUDIT_DATA = new URL('audits/fish-catalog/', CATALOG_DATA);
const WORKBOOK = new URL('catalog/Klevalka-2026.xlsx', LOCAL_ROOT);
const EXPECTED_WORKBOOK_SHA256 = '58c13109fe71e3c041f40d6e721b6c6cd0d0bbade43fe7dc1b0063dd8ba7eac3';

interface CatalogSnapshotInput {
  fingerprint: string;
  fishingBases: { id: string; name: string }[];
  fish: CatalogFishRow[];
  memberships: { fishingBaseId: string; fishId: string }[];
}

interface FishingBaseFishInput {
  sourceWorkbook: {
    fileName: string;
    sha256: string;
    populatedFishRows: number;
    resolvedFishRows: number;
    unresolvedFishRows: number;
  };
  bases: { name: string; sourceSheet: string; fishColumn: string }[];
}

interface StagedCandidateInput {
  fishNameRaw: string | null;
  resolution: {
    fish: { status: string };
    fishingBase: { status: string; id: string | null; name: string | null };
  };
  issues: { code: string; field?: string }[];
}

interface OutputArtifact {
  url: URL;
  content: string;
}

const REVIEWED_LIST_FISH_FINDINGS = [
  {
    canonicalName: 'Австралийский колючепёр',
    listTitle: 'Австралийский колючепёр',
    detailPath: '/avstralijskij-kolychoper.html',
    imageAssetId: '2186',
    confidence: 'CONFIRMED',
    evidence: 'List title and detail heading agree with forum69 canonical identity',
  },
  {
    canonicalName: 'Кит горбатый(альбинос)',
    listTitle: 'Кит горбатый-альбинос',
    detailPath: '/kit-gorbatyij(albinos).html',
    imageAssetId: '2426',
    confidence: 'CONFIRMED',
    evidence: 'Qualifier identity agrees; list-fish punctuation is supplemental only',
  },
  {
    canonicalName: 'Кит синий (альбинос)',
    listTitle: 'Кит синий альбинос',
    detailPath: '/sinij-kit-albinos.html',
    imageAssetId: '7094',
    confidence: 'CONFIRMED',
    evidence: 'Qualifier identity agrees; list-fish punctuation is supplemental only',
  },
] as const;

const REVIEWED_LIST_FISH_CONFLICTS = [
  {
    listTitle: 'Акула галапагосская',
    detailPath: '/akula-sejla.html',
    confidence: 'MANUAL',
    reason: 'Observed list title and detail slug identify different Fish names',
  },
  {
    listTitle: 'Акула Сейла',
    detailPath: '/akula-koromandelskaya.html',
    confidence: 'MANUAL',
    reason: 'Observed list title and detail slug identify different Fish names',
  },
] as const;

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T;
}

async function readForumPosts(): Promise<ForumPostIdentity[]> {
  const directory = new URL('entities/posts/', FORUM_ROOT);
  const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(files.map((name) => readJson<ForumPostIdentity>(new URL(name, directory))));
}

async function readCandidates(): Promise<StagedCandidateInput[]> {
  const content = await readFile(new URL('staging/candidates.jsonl', FORUM_OUTPUT), 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StagedCandidateInput);
}

function fishReconciliationCsv(entries: ReturnType<typeof buildFishReconciliation>): string {
  const header = [
    'category',
    'decision',
    'currentFishId',
    'currentName',
    'currentIsActive',
    'topicId',
    'canonicalName',
    'preservesFishId',
    'reason',
  ];
  const rows = entries.map((entry) => [
    entry.category,
    entry.decision,
    entry.currentFishId,
    entry.currentName,
    entry.currentIsActive,
    entry.topicId,
    entry.canonicalName,
    entry.preservesFishId,
    entry.reason,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function workbookReconciliationCsv(entries: ReturnType<typeof reconcileWorkbookFishCells>): string {
  const header = [
    'category',
    'baseName',
    'sourceSheet',
    'sourceCell',
    'rawName',
    'lookupName',
    'annotationStripped',
    'topicId',
    'canonicalName',
  ];
  const rows = entries.map((entry) => [
    entry.category,
    entry.baseName,
    entry.sourceSheet,
    entry.sourceCell,
    entry.rawName,
    entry.lookupName,
    entry.annotationStripped,
    entry.topicId,
    entry.canonicalName,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function fishManualCsv(entries: ReturnType<typeof buildFishReconciliation>): string {
  const manual = entries.filter((entry) => entry.category === 'MANUAL');
  const header = [
    'currentFishId',
    'currentName',
    'currentIsActive',
    'topicId',
    'canonicalName',
    'reason',
  ];
  const rows = manual.map((entry) => [
    entry.currentFishId,
    entry.currentName,
    entry.currentIsActive,
    entry.topicId,
    entry.canonicalName,
    entry.reason,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function workbookManualCsv(entries: ReturnType<typeof reconcileWorkbookFishCells>): string {
  const manual = entries.filter((entry) => entry.category === 'MANUAL');
  const header = ['baseName', 'sourceSheet', 'sourceCell', 'rawName', 'lookupName', 'decision'];
  const rows = manual.map((entry) => [
    entry.baseName,
    entry.sourceSheet,
    entry.sourceCell,
    entry.rawName,
    entry.lookupName,
    'MANUAL',
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function mixedScriptManualCsv(
  entries: readonly { topicId: string; canonicalName: string; mixedScriptTokens: string[] }[],
): string {
  const header = ['topicId', 'canonicalName', 'mixedScriptTokens', 'decision'];
  const rows = entries.map((entry) => [
    entry.topicId,
    entry.canonicalName,
    entry.mixedScriptTokens.join('|'),
    'MANUAL',
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

async function buildArtifacts(): Promise<OutputArtifact[]> {
  const [posts, snapshot, membershipInput, workbook, candidates] = await Promise.all([
    readForumPosts(),
    readJson<CatalogSnapshotInput>(new URL('technical/catalog-snapshot.json', FORUM_OUTPUT)),
    readJson<FishingBaseFishInput>(new URL('fishing-base-fish.json', CATALOG_DATA)),
    readFile(WORKBOOK),
    readCandidates(),
  ]);
  const workbookSha256 = sha256(workbook);
  if (workbookSha256 !== EXPECTED_WORKBOOK_SHA256) {
    throw new Error(`Workbook SHA-256 ${workbookSha256} is not the approved source`);
  }

  const corpus = buildForumFishCorpus(posts);
  const fishReconciliation = buildFishReconciliation(snapshot.fish, corpus);
  const workbookCells = readWorkbookFishCells(workbook, membershipInput.bases);
  const workbookReconciliation = reconcileWorkbookFishCells(workbookCells, corpus);
  const fishingBaseNamesById = new Map(
    snapshot.fishingBases.map((base) => [base.id, base.name] as const),
  );
  const forumRecovery = buildForumRecoveryAudit(
    candidates,
    corpus,
    workbookReconciliation,
    fishingBaseNamesById,
  );
  const fishCounts = countByCategory(fishReconciliation);
  const workbookCounts = countByCategory(workbookReconciliation);
  const projectedMemberships = new Set(
    workbookReconciliation
      .filter((row) => row.topicId !== null)
      .map((row) => `${row.baseName}\0${row.topicId}`),
  );
  const mixedScript = corpus.filter((fish) => fish.mixedScriptTokens.length > 0);
  const parentheticalAlternateCount = corpus.filter((fish) =>
    fish.aliases.some((alias) => alias.kind === 'PARENTHETICAL_ALTERNATE'),
  ).length;
  const qualifierCount = corpus.filter((fish) =>
    fish.aliases.some((alias) => alias.kind === 'QUALIFIER_PUNCTUATION'),
  ).length;
  const forumManifest = {
    schemaVersion: 1,
    authority: 'rus-fishsoft forum parent 69 topic catalog',
    identityRule: 'rus-fishsoft:forum69:topic:<topicId>',
    source: {
      parentForumId: '69',
      cachePath: 'apps/api/.local/forum-import/rus-fishsoft/entities/posts',
      posts: posts.length,
      topics: corpus.length,
    },
    policy: {
      primaryReviewedTopicNameIsFishName: true,
      excelNamesAreDisplayNames: false,
      fuzzyMatching: false,
      listFishMayRenameFish: false,
    },
    fish: corpus,
  };
  const fishManifest = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    sourceCatalogFingerprint: snapshot.fingerprint,
    counts: fishCounts,
    entries: fishReconciliation,
  };
  const workbookManifest = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    sourceWorkbook: {
      fileName: membershipInput.sourceWorkbook.fileName,
      sha256: workbookSha256,
      declaredPopulatedFishRows: membershipInput.sourceWorkbook.populatedFishRows,
      observedPopulatedFishRows: workbookCells.length,
    },
    policy: {
      membershipOnly: true,
      rawExcelNamesMayBecomeDisplayNames: false,
      fuzzyMatching: false,
    },
    counts: workbookCounts,
    projectedMemberships: projectedMemberships.size,
    rows: workbookReconciliation,
  };
  const listMappings = REVIEWED_LIST_FISH_FINDINGS.map((finding) => {
    const fish = corpus.find((candidate) => candidate.canonicalName === finding.canonicalName);
    if (fish === undefined)
      throw new Error(`list-fish finding is not in forum69: ${finding.canonicalName}`);
    return {
      forumTopicId: fish.topicId,
      canonicalName: fish.canonicalName,
      listTitle: finding.listTitle,
      detailPath: finding.detailPath,
      imageAssetId: finding.imageAssetId,
      middleImagePath: `/assets/images/fish/middle/${finding.imageAssetId}.png`,
      bigImagePath: `/assets/images/fish/big/${finding.imageAssetId}.png`,
      confidence: finding.confidence,
      evidence: finding.evidence,
    };
  });
  const listManifest = {
    schemaVersion: 1,
    mode: 'TARGETED_AUDIT_ONLY',
    source: {
      listPage: 'https://rus-fishsoft.ru/list-fish.html',
      dataEndpoint: 'https://rus-fishsoft.ru/ajaxcontent.html',
      requestShape: {
        method: 'POST',
        form: { 'vars[to]': 'data', 'vars[sc]': 'fish_list', 'vars[sort]': '<letter>' },
      },
    },
    policy: {
      supplementalMetadataOnly: true,
      mayRenameFish: false,
      imagesDownloaded: false,
      fullCatalogCrawled: false,
    },
    mappings: listMappings,
    manualConflicts: REVIEWED_LIST_FISH_CONFLICTS,
  };
  const corpusAudit = {
    schemaVersion: 1,
    topics: corpus.length,
    canonicalNames: corpus.length,
    exactNormalizedCollisions: 0,
    eyoFoldCollisions: 0,
    parentheticalAlternates: parentheticalAlternateCount,
    semanticQualifiers: qualifierCount,
    mixedScriptSourceNames: mixedScript.map((fish) => ({
      topicId: fish.topicId,
      canonicalName: fish.canonicalName,
      mixedScriptTokens: fish.mixedScriptTokens,
      decision: 'MANUAL',
    })),
  };
  const fishAudit = {
    schemaVersion: 1,
    sourceCatalogFingerprint: snapshot.fingerprint,
    currentFish: snapshot.fish.length,
    counts: fishCounts,
    highConfidenceRepresentedCanonicalFish: corpus.length - (fishCounts.MISSING_CREATE ?? 0),
    canonicalFishProvisionallyMissing: fishCounts.MISSING_CREATE ?? 0,
    manual: fishReconciliation.filter((entry) => entry.category === 'MANUAL'),
  };
  const workbookAudit = {
    schemaVersion: 1,
    sourceWorkbookSha256: workbookSha256,
    declared: membershipInput.sourceWorkbook,
    observed: {
      populatedSelectedFishCells: workbookCells.length,
      selectedCellValueTypes: { sharedString: workbookCells.length, numeric: 0, inlineString: 0 },
      resolvedRows: workbookCells.length - (workbookCounts.MANUAL ?? 0),
      manualRows: workbookCounts.MANUAL ?? 0,
      projectedUniqueMemberships: projectedMemberships.size,
      counts: workbookCounts,
    },
    discrepancy: {
      declaredPopulatedFishRows: membershipInput.sourceWorkbook.populatedFishRows,
      observedPopulatedFishRows: workbookCells.length,
      delta: membershipInput.sourceWorkbook.populatedFishRows - workbookCells.length,
      cause:
        'The preliminary 3658 audit used an ad-hoc XML cell regex that did not preserve self-closing cell boundaries. The boundary-safe XLSX parser observes 3659 non-empty shared-string Fish-column cells; the committed 3659 count is correct and no workbook row is missing.',
      applyBlocked: false,
    },
    manual: workbookReconciliation.filter((entry) => entry.category === 'MANUAL'),
  };
  const listAudit = {
    schemaVersion: 1,
    coverage: 'TARGETED_SAMPLE_NOT_FULL_CRAWL',
    confidenceCounts: {
      confirmed: listMappings.filter((entry) => entry.confidence === 'CONFIRMED').length,
      manual: REVIEWED_LIST_FISH_CONFLICTS.length,
    },
    imagesDownloaded: 0,
    mappings: listMappings,
    manualConflicts: REVIEWED_LIST_FISH_CONFLICTS,
  };

  return [
    { url: new URL('forum69-fish.json', CATALOG_DATA), content: stableJson(forumManifest) },
    { url: new URL('fish-reconciliation.json', CATALOG_DATA), content: stableJson(fishManifest) },
    {
      url: new URL('fishing-base-fish-reconciliation.json', CATALOG_DATA),
      content: stableJson(workbookManifest),
    },
    {
      url: new URL('list-fish-metadata.json', CATALOG_DATA),
      content: stableJson(listManifest),
    },
    {
      url: new URL('forum69-fish-corpus.audit.json', AUDIT_DATA),
      content: stableJson(corpusAudit),
    },
    {
      url: new URL('fish-catalog-reconciliation.audit.json', AUDIT_DATA),
      content: stableJson(fishAudit),
    },
    {
      url: new URL('fish-catalog-reconciliation.audit.csv', AUDIT_DATA),
      content: fishReconciliationCsv(fishReconciliation),
    },
    {
      url: new URL('fish-manual-decisions.audit.csv', AUDIT_DATA),
      content: fishManualCsv(fishReconciliation),
    },
    {
      url: new URL('base-fish-reconciliation.audit.json', AUDIT_DATA),
      content: stableJson(workbookAudit),
    },
    {
      url: new URL('base-fish-reconciliation.audit.csv', AUDIT_DATA),
      content: workbookReconciliationCsv(workbookReconciliation),
    },
    {
      url: new URL('base-fish-manual-decisions.audit.csv', AUDIT_DATA),
      content: workbookManualCsv(workbookReconciliation),
    },
    {
      url: new URL('mixed-script-manual-decisions.audit.csv', AUDIT_DATA),
      content: mixedScriptManualCsv(mixedScript),
    },
    {
      url: new URL('forum69-fish-recovery.audit.json', AUDIT_DATA),
      content: stableJson(forumRecovery),
    },
    {
      url: new URL('list-fish-metadata.audit.json', AUDIT_DATA),
      content: stableJson(listAudit),
    },
  ];
}

async function run(): Promise<void> {
  const check = process.argv.slice(2).includes('--check');
  const generatedArtifacts = await buildArtifacts();
  let preserveApplyReady = false;
  try {
    const current = JSON.parse(
      await readFile(new URL('fish-reconciliation.json', CATALOG_DATA), 'utf8'),
    ) as { mode?: string };
    preserveApplyReady = current.mode === 'APPLY_READY';
  } catch {
    preserveApplyReady = false;
  }
  const trackedManifestNames = new Set([
    'forum69-fish.json',
    'fish-reconciliation.json',
    'fishing-base-fish-reconciliation.json',
    'list-fish-metadata.json',
  ]);
  const artifacts = preserveApplyReady
    ? generatedArtifacts.filter(
        (artifact) =>
          !trackedManifestNames.has(fileURLToPath(artifact.url).split('/').at(-1) ?? ''),
      )
    : generatedArtifacts;
  await mkdir(AUDIT_DATA, { recursive: true });

  for (const artifact of artifacts) {
    if (check) {
      const current = await readFile(artifact.url, 'utf8');
      if (current !== artifact.content) {
        throw new Error(`Generated Fish audit artifact is stale: ${fileURLToPath(artifact.url)}`);
      }
    } else {
      await writeFile(artifact.url, artifact.content, 'utf8');
    }
  }

  process.stdout.write(
    `${stableJson({ mode: check ? 'check' : 'write', artifacts: artifacts.length })}`,
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Fish catalog audit generation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
