import 'dotenv/config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  buildForumRecoveryAudit,
  countByCategory,
  csvCell,
  normalizeAuditName,
  stableJson,
  type FishReconciliationEntry,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';
import {
  FINAL_HUMAN_DB_FISH_NAMES,
  FINAL_HUMAN_WORKBOOK_CANDIDATES,
  MANUAL_REVIEW_COLLISIONS,
  REVIEWED_DB_FISH_NAMES,
  assertManualWorkbookReviewComplete,
  buildManualDbReview,
  buildManualWorkbookDecisions,
  finalizeFishReconciliation,
  projectManualWorkbookDecisions,
  type FishReferenceCounts,
  type ManualDbReviewEntry,
  type ManualWorkbookDecision,
} from './fish-catalog-manual-review.js';
import { createPrismaAdapter } from './prisma-adapter.js';

const LOCAL_ROOT = new URL('../../.local/', import.meta.url);
const FORUM_OUTPUT = new URL('forum-import/rus-fishsoft/outputs/all-parent-69/', LOCAL_ROOT);
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const AUDIT_DATA = new URL('audits/fish-catalog/manual-review/', CATALOG_DATA);

interface ForumManifest {
  fish: ForumFishIdentity[];
}

interface FishManifest {
  sourceCatalogFingerprint: string;
  entries: FishReconciliationEntry[];
}

interface WorkbookManifest {
  sourceWorkbook: { sha256: string };
  rows: WorkbookFishResolution[];
}

interface CatalogSnapshot {
  fishingBases: Array<{ id: string; name: string }>;
}

interface CandidateIdentityManifest {
  posts: Array<{
    topicId: string;
    postId: string;
    candidates: Array<{ candidateOrdinal: number; importKey: string }>;
  }>;
}

interface StagedCandidate {
  fishNameRaw: string | null;
  resolution: {
    fish: { status: string };
    fishingBase: { status: string; id: string | null; name: string | null };
  };
  issues: Array<{ code: string; field?: string }>;
}

interface OutputArtifact {
  url: URL;
  content: string;
}

interface FishEvidence {
  fishId: string;
  name: string;
  isActive: boolean;
  catchReports: number;
  catchReportIds: string[];
  fishingBaseFish: number;
  fishingBases: Array<{ id: string; name: string }>;
}

interface HumanDecisionEntry {
  scope: 'DB' | 'WORKBOOK';
  value: string;
  workbookCells: Array<{
    baseName: string;
    sourceSheet: string;
    sourceCell: string;
    rawName: string;
  }>;
  existingFish: FishEvidence[];
  candidates: Array<{
    topicId: string;
    canonicalName: string;
    existingFish: FishEvidence[];
    independentWorkbookCells: Array<{
      baseName: string;
      sourceSheet: string;
      sourceCell: string;
      rawName: string;
    }>;
    independentlySupportedBaseNames: string[];
    distinctSourceRowCollisionBaseNames: string[];
    adjacentDistinctSourceCells: string[];
    coversEverySourceBase: boolean;
  }>;
  uniquelySupportedCandidateByBaseContext: {
    topicId: string;
    canonicalName: string;
  } | null;
  decision: 'PROPOSED' | 'DO_NOT_MAP';
}

interface DbImportedEvidence {
  fishId: string;
  fishName: string;
  reports: { total: number; native: number; imported: number; importedMapped: number };
  importedSources: Array<{
    topicId: string;
    sourceTitle: string;
    canonicalName: string;
    reportsCount: number;
    reportIds: string[];
    reportBaseNames: string[];
  }>;
  unmappedImportedReportIds: string[];
  evidenceConclusion:
    | 'ONE_FORUM69_FISH'
    | 'CONFLICTING_FORUM69_FISH'
    | 'INCOMPLETE_IMPORT_TRACE'
    | 'NO_IMPORTED_EVIDENCE';
}

async function readJson<T>(url: URL): Promise<T> {
  return JSON.parse(await readFile(url, 'utf8')) as T;
}

async function readCandidates(): Promise<StagedCandidate[]> {
  const content = await readFile(new URL('staging/candidates.jsonl', FORUM_OUTPUT), 'utf8');
  return content
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as StagedCandidate);
}

function sumDecisionRows(
  decisions: readonly ManualWorkbookDecision[],
  decision: ManualWorkbookDecision['decision'],
): number {
  return decisions
    .filter((entry) => entry.decision === decision)
    .reduce((total, entry) => total + entry.rows, 0);
}

function projectedMembershipCount(rows: readonly WorkbookFishResolution[]): number {
  return new Set(
    rows
      .filter((row) => row.topicId !== null)
      .map((row) => `${normalizeAuditName(row.baseName)}\0${row.topicId}`),
  ).size;
}

function manualDbCsv(entries: readonly ManualDbReviewEntry[]): string {
  const header = [
    'fishId',
    'currentName',
    'currentIsActive',
    'catchReports',
    'fishingBaseFish',
    'fishingBases',
    'forum69Candidates',
    'workbookCells',
    'recommendation',
    'recommendedIsActive',
    'proposedCanonicalName',
    'rationale',
  ];
  const rows = entries.map((entry) => [
    entry.fishId,
    entry.currentName,
    entry.currentIsActive,
    entry.catchReports,
    entry.fishingBaseFish,
    entry.fishingBases.map((base) => `${base.name} [${base.id}]`).join('|'),
    entry.exactForum69Candidates
      .map((candidate) => `${candidate.topicId}:${candidate.canonicalName}`)
      .join('|'),
    entry.workbookCells
      .map((cell) => `${cell.sourceSheet}!${cell.sourceCell}:${cell.rawName}`)
      .join('|'),
    entry.recommendation,
    entry.recommendedIsActive,
    entry.proposedCanonicalName,
    entry.rationale,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function workbookDecisionCsv(decisions: readonly ManualWorkbookDecision[]): string {
  const header = ['rawName', 'rows', 'cells', 'decision', 'topicId', 'canonicalName', 'rationale'];
  const rows = decisions.map((entry) => [
    entry.rawName,
    entry.rows,
    entry.cells.map((cell) => `${cell.sourceSheet}!${cell.sourceCell}`).join('|'),
    entry.decision,
    entry.topicId,
    entry.canonicalName,
    entry.rationale,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function humanDecisionCsv(entries: readonly HumanDecisionEntry[]): string {
  const header = [
    'scope',
    'value',
    'workbookCells',
    'existingFishReferences',
    'forum69Candidates',
    'candidateBaseEvidence',
    'uniquelySupportedCandidateByBaseContext',
    'decision',
  ];
  const rows = entries.map((entry) => [
    entry.scope,
    entry.value,
    entry.workbookCells
      .map((cell) => `${cell.sourceSheet}!${cell.sourceCell}:${cell.baseName}`)
      .join('|'),
    entry.existingFish
      .map(
        (fish) => `${fish.fishId}:${fish.name}:CR=${fish.catchReports}:BF=${fish.fishingBaseFish}`,
      )
      .join('|'),
    entry.candidates
      .map((candidate) => `${candidate.topicId}:${candidate.canonicalName}`)
      .join('|'),
    entry.candidates
      .map(
        (candidate) =>
          `${candidate.topicId}:projected=${candidate.independentlySupportedBaseNames.join('+') || 'NONE'}:distinct-row-collision=${candidate.distinctSourceRowCollisionBaseNames.join('+') || 'NONE'}:adjacent=${candidate.adjacentDistinctSourceCells.join('+') || 'NONE'}`,
      )
      .join('|'),
    entry.uniquelySupportedCandidateByBaseContext === null
      ? null
      : `${entry.uniquelySupportedCandidateByBaseContext.topicId}:${entry.uniquelySupportedCandidateByBaseContext.canonicalName}`,
    entry.decision,
  ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function unresolvedEvidenceCsv(
  dbEvidence: readonly DbImportedEvidence[],
  workbookEvidence: readonly HumanDecisionEntry[],
): string {
  const header = [
    'scope',
    'value',
    'reportsNative',
    'reportsImported',
    'forum69CandidatesOrSources',
    'workbookCells',
    'projectedBaseContext',
    'conclusion',
  ];
  const dbRows = dbEvidence.map((entry) => [
    'DB',
    entry.fishName,
    entry.reports.native,
    entry.reports.imported,
    entry.importedSources
      .map(
        (source) =>
          `${source.topicId}:${source.sourceTitle}=>${source.canonicalName}:reports=${source.reportsCount}:bases=${source.reportBaseNames.join('+')}`,
      )
      .join('|'),
    null,
    null,
    entry.evidenceConclusion,
  ]);
  const workbookRows = workbookEvidence.map((entry) => [
    'WORKBOOK',
    entry.value,
    null,
    null,
    entry.candidates
      .map((candidate) => `${candidate.topicId}:${candidate.canonicalName}`)
      .join('|'),
    entry.workbookCells
      .map((cell) => `${cell.baseName}:${cell.sourceSheet}!${cell.sourceCell}`)
      .join('|'),
    entry.candidates
      .map(
        (candidate) =>
          `${candidate.topicId}:projected=${candidate.independentlySupportedBaseNames.join('+') || 'NONE'}:distinct-row-collision=${candidate.distinctSourceRowCollisionBaseNames.join('+') || 'NONE'}:adjacent=${candidate.adjacentDistinctSourceCells.join('+') || 'NONE'}`,
      )
      .join('|'),
    entry.uniquelySupportedCandidateByBaseContext === null
      ? entry.decision
      : `UNIQUE_CONTEXT_ONLY:${entry.uniquelySupportedCandidateByBaseContext.topicId}`,
  ]);
  return `${[header, ...dbRows, ...workbookRows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')}\n`;
}

async function readFishReferences(
  prisma: PrismaClient,
  fishIds: readonly string[],
): Promise<{
  references: FishReferenceCounts[];
  rows: Array<{ id: string; name: string; isActive: boolean }>;
  reports: Array<{
    fishId: string;
    reportId: string;
    importKey: string | null;
    fishingBaseName: string;
  }>;
}> {
  const rows = await prisma.fish.findMany({
    where: { id: { in: [...fishIds] } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      isActive: true,
      _count: { select: { catchReports: true, fishingBaseLinks: true } },
      catchReports: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          importKey: true,
          location: { select: { fishingBase: { select: { name: true } } } },
        },
      },
      fishingBaseLinks: {
        orderBy: { fishingBaseId: 'asc' },
        select: { fishingBase: { select: { id: true, name: true } } },
      },
    },
  });
  if (rows.length !== new Set(fishIds).size) {
    throw new Error(`expected ${new Set(fishIds).size} reviewed Fish rows, found ${rows.length}`);
  }
  return {
    references: rows.map((row) => ({
      fishId: row.id,
      catchReports: row._count.catchReports,
      catchReportIds: row.catchReports.map((report) => report.id),
      fishingBaseFish: row._count.fishingBaseLinks,
      fishingBases: row.fishingBaseLinks.map((link) => link.fishingBase),
    })),
    rows: rows.map((row) => ({ id: row.id, name: row.name, isActive: row.isActive })),
    reports: rows.flatMap((row) =>
      row.catchReports.map((report) => ({
        fishId: row.id,
        reportId: report.id,
        importKey: report.importKey,
        fishingBaseName: report.location.fishingBase.name,
      })),
    ),
  };
}

async function buildArtifacts(prisma: PrismaClient): Promise<OutputArtifact[]> {
  const [
    forumManifest,
    fishManifest,
    workbookManifest,
    listFishManifest,
    snapshot,
    candidates,
    candidateIdentities,
  ] = await Promise.all([
    readJson<ForumManifest>(new URL('forum69-fish.json', CATALOG_DATA)),
    readJson<FishManifest>(new URL('fish-reconciliation.json', CATALOG_DATA)),
    readJson<WorkbookManifest>(new URL('fishing-base-fish-reconciliation.json', CATALOG_DATA)),
    readJson<Record<string, unknown>>(new URL('list-fish-metadata.json', CATALOG_DATA)),
    readJson<CatalogSnapshot>(new URL('technical/catalog-snapshot.json', FORUM_OUTPUT)),
    readCandidates(),
    readJson<CandidateIdentityManifest>(
      new URL('technical/candidate-identities.json', FORUM_OUTPUT),
    ),
  ]);
  const manualEntries = fishManifest.entries.filter(
    (entry) => entry.currentName !== null && REVIEWED_DB_FISH_NAMES.has(entry.currentName),
  );
  if (manualEntries.length !== 13)
    throw new Error(`expected 13 manual DB Fish, found ${manualEntries.length}`);
  const manualFishIds = manualEntries
    .map((entry) => entry.currentFishId)
    .filter((id) => id !== null);
  const collisionFishIds = MANUAL_REVIEW_COLLISIONS.flatMap((entry) => [
    entry.legacyFishId,
    entry.canonicalFishId,
  ]);
  const finalCandidateTopicIds = new Set(
    [...FINAL_HUMAN_WORKBOOK_CANDIDATES.values()].flatMap((topicIds) => [...topicIds]),
  );
  const finalCandidateFishIds = fishManifest.entries
    .filter(
      (entry) =>
        entry.topicId !== null &&
        finalCandidateTopicIds.has(entry.topicId) &&
        entry.currentFishId !== null,
    )
    .map((entry) => entry.currentFishId as string);
  const allReferenceIds = [
    ...new Set([...manualFishIds, ...collisionFishIds, ...finalCandidateFishIds]),
  ];
  const fishReferences = await readFishReferences(prisma, allReferenceIds);
  const referencesById = new Map(
    fishReferences.references.map((entry) => [entry.fishId, entry] as const),
  );
  const fishRowsById = new Map(fishReferences.rows.map((entry) => [entry.id, entry] as const));

  const decisions = buildManualWorkbookDecisions(workbookManifest.rows, forumManifest.fish);
  assertManualWorkbookReviewComplete(decisions);
  if (decisions.length !== 135) {
    throw new Error(`expected 135 distinct manual workbook values, found ${decisions.length}`);
  }
  const decisionsByRawName = new Map(decisions.map((entry) => [entry.rawName, entry] as const));
  const baselineRows = workbookManifest.rows.map((row): WorkbookFishResolution =>
    decisionsByRawName.has(row.rawName)
      ? {
          ...row,
          lookupName: row.rawName,
          annotationStripped: false,
          category: 'MANUAL',
          topicId: null,
          canonicalName: null,
        }
      : { ...row },
  );
  const projectedRows = projectManualWorkbookDecisions(baselineRows, decisions);
  const manualDbReview = buildManualDbReview(
    manualEntries,
    fishReferences.references,
    forumManifest.fish,
    baselineRows,
  );
  const finalizedFishEntries = finalizeFishReconciliation(
    fishManifest.entries,
    manualDbReview,
    forumManifest.fish,
  );
  const baseNamesById = new Map(snapshot.fishingBases.map((base) => [base.id, base.name] as const));
  const beforeRecovery = buildForumRecoveryAudit(
    candidates,
    forumManifest.fish,
    baselineRows,
    baseNamesById,
  );
  const afterRecovery = buildForumRecoveryAudit(
    candidates,
    forumManifest.fish,
    projectedRows,
    baseNamesById,
  );
  const resolvedRows = sumDecisionRows(decisions, 'PROPOSED');
  const excludedNonFishRows = sumDecisionRows(decisions, 'EXCLUDE_NON_FISH');
  const excludedNoiseRows = sumDecisionRows(decisions, 'EXCLUDE_NOISE');
  const doNotMapRows = sumDecisionRows(decisions, 'DO_NOT_MAP');
  const unresolvedRows = sumDecisionRows(decisions, 'MANUAL');
  const reviewedRows =
    resolvedRows + excludedNonFishRows + excludedNoiseRows + doNotMapRows + unresolvedRows;
  if (reviewedRows !== 223) {
    throw new Error(`expected 223 manual workbook rows, found ${reviewedRows}`);
  }
  const projectedMemberships = projectedMembershipCount(projectedRows);
  const originalMemberships = projectedMembershipCount(baselineRows);
  const unresolved = decisions.filter((decision) => decision.decision === 'MANUAL');
  const proposed = decisions.filter((decision) => decision.decision === 'PROPOSED');
  const excludedNonFish = decisions.filter((decision) => decision.decision === 'EXCLUDE_NON_FISH');
  const excludedNoise = decisions.filter((decision) => decision.decision === 'EXCLUDE_NOISE');
  const doNotMap = decisions.filter((decision) => decision.decision === 'DO_NOT_MAP');
  if (
    proposed.length !== 92 ||
    resolvedRows !== 161 ||
    excludedNonFish.length !== 28 ||
    excludedNonFishRows !== 44 ||
    excludedNoise.length !== 12 ||
    excludedNoiseRows !== 12 ||
    doNotMap.length !== 3 ||
    doNotMapRows !== 6 ||
    unresolved.length !== 0 ||
    unresolvedRows !== 0
  ) {
    throw new Error('final manual workbook classification counts changed');
  }
  const corpusByTopic = new Map(forumManifest.fish.map((fish) => [fish.topicId, fish] as const));

  const collisions = MANUAL_REVIEW_COLLISIONS.map((collision) => {
    const topic = corpusByTopic.get(collision.topicId);
    if (topic?.canonicalName !== collision.canonicalName) {
      throw new Error(`collision topic identity changed: ${collision.topicId}`);
    }
    const legacyFish = fishRowsById.get(collision.legacyFishId);
    const canonicalFish = fishRowsById.get(collision.canonicalFishId);
    const legacyReferences = referencesById.get(collision.legacyFishId);
    const canonicalReferences = referencesById.get(collision.canonicalFishId);
    if (
      legacyFish === undefined ||
      canonicalFish === undefined ||
      legacyReferences === undefined ||
      canonicalReferences === undefined
    ) {
      throw new Error(`collision database references are incomplete: ${collision.topicId}`);
    }
    return {
      topicId: collision.topicId,
      canonicalName: collision.canonicalName,
      legacyFish: { ...legacyFish, ...legacyReferences },
      canonicalFish: { ...canonicalFish, ...canonicalReferences },
      workbookCells: projectedRows
        .filter((row) => row.topicId === collision.topicId)
        .map((row) => ({
          baseName: row.baseName,
          sourceSheet: row.sourceSheet,
          sourceCell: row.sourceCell,
          rawName: row.rawName,
        })),
      automaticActionTaken: false,
    };
  });

  const fishEvidence = (fishId: string): FishEvidence => {
    const row = fishRowsById.get(fishId);
    const reference = referencesById.get(fishId);
    if (row === undefined || reference === undefined) {
      throw new Error(`final human decision Fish references are incomplete: ${fishId}`);
    }
    return {
      fishId,
      name: row.name,
      isActive: row.isActive,
      catchReports: reference.catchReports,
      catchReportIds: reference.catchReportIds,
      fishingBaseFish: reference.fishingBaseFish,
      fishingBases: reference.fishingBases,
    };
  };
  const buildHumanDecision = (
    scope: HumanDecisionEntry['scope'],
    value: string,
    topicIds: readonly string[],
  ): HumanDecisionEntry => {
    const workbookCells = workbookManifest.rows
      .filter((row) => row.rawName === value)
      .map((row) => ({
        baseName: row.baseName,
        sourceSheet: row.sourceSheet,
        sourceCell: row.sourceCell,
        rawName: row.rawName,
      }));
    const sourceBaseNames = new Set(workbookCells.map((cell) => cell.baseName));
    const existingFishIds = finalizedFishEntries
      .filter((entry) => entry.currentName === value && entry.currentFishId !== null)
      .map((entry) => entry.currentFishId as string);
    const candidates = topicIds.map((topicId) => {
      const topic = corpusByTopic.get(topicId);
      if (topic === undefined) throw new Error(`final human candidate topic is absent: ${topicId}`);
      const candidateEntries = finalizedFishEntries.filter((entry) => entry.topicId === topicId);
      const candidateFishIds = [
        ...new Set(
          candidateEntries.map((entry) => entry.currentFishId).filter((fishId) => fishId !== null),
        ),
      ];
      const independentWorkbookCells = projectedRows
        .filter((row) => row.topicId === topicId && row.rawName !== value)
        .map((row) => ({
          baseName: row.baseName,
          sourceSheet: row.sourceSheet,
          sourceCell: row.sourceCell,
          rawName: row.rawName,
        }));
      const independentlySupportedBaseNames = new Set(
        independentWorkbookCells.map((cell) => cell.baseName),
      );
      for (const entry of candidateEntries) {
        if (entry.category !== 'EXACT_CANONICAL' || entry.currentFishId === null) continue;
        for (const base of fishEvidence(entry.currentFishId).fishingBases) {
          independentlySupportedBaseNames.add(base.name);
        }
      }
      const supportedBaseNames = [...independentlySupportedBaseNames].sort();
      const distinctSourceRowCollisionBaseNames = [
        ...new Set(
          independentWorkbookCells
            .filter((cell) => sourceBaseNames.has(cell.baseName))
            .map((cell) => cell.baseName),
        ),
      ].sort();
      const adjacentDistinctSourceCells = independentWorkbookCells
        .filter((candidateCell) =>
          workbookCells.some((sourceCell) => {
            if (sourceCell.sourceSheet !== candidateCell.sourceSheet) return false;
            const sourceRow = Number(sourceCell.sourceCell.match(/\d+$/u)?.[0]);
            const candidateRow = Number(candidateCell.sourceCell.match(/\d+$/u)?.[0]);
            return Number.isSafeInteger(sourceRow) && Math.abs(sourceRow - candidateRow) === 1;
          }),
        )
        .map((cell) => `${cell.sourceSheet}!${cell.sourceCell}`)
        .sort();
      return {
        topicId,
        canonicalName: topic.canonicalName,
        existingFish: candidateFishIds.map(fishEvidence),
        independentWorkbookCells,
        independentlySupportedBaseNames: supportedBaseNames,
        distinctSourceRowCollisionBaseNames,
        adjacentDistinctSourceCells,
        coversEverySourceBase:
          sourceBaseNames.size > 0 &&
          [...sourceBaseNames].every((baseName) => independentlySupportedBaseNames.has(baseName)),
      };
    });
    const coveringCandidates = candidates.filter(
      (candidate) =>
        candidate.coversEverySourceBase &&
        candidate.distinctSourceRowCollisionBaseNames.length === 0,
    );
    return {
      scope,
      value,
      workbookCells,
      existingFish: [...new Set(existingFishIds)].map(fishEvidence),
      candidates,
      uniquelySupportedCandidateByBaseContext:
        coveringCandidates.length === 1
          ? {
              topicId: coveringCandidates[0]?.topicId ?? '',
              canonicalName: coveringCandidates[0]?.canonicalName ?? '',
            }
          : null,
      decision:
        scope === 'DB'
          ? 'PROPOSED'
          : decisionsByRawName.get(value)?.decision === 'DO_NOT_MAP'
            ? 'DO_NOT_MAP'
            : 'PROPOSED',
    };
  };
  const finalHumanDbDecisions = manualDbReview
    .filter((entry) => FINAL_HUMAN_DB_FISH_NAMES.has(entry.currentName))
    .map((entry) =>
      buildHumanDecision(
        'DB',
        entry.currentName,
        entry.exactForum69Candidates.map((candidate) => candidate.topicId),
      ),
    );
  const finalHumanWorkbookDecisions = [...FINAL_HUMAN_WORKBOOK_CANDIDATES].map(
    ([rawName, topicIds]) => buildHumanDecision('WORKBOOK', rawName, topicIds),
  );
  if (finalHumanDbDecisions.length !== 3 || finalHumanWorkbookDecisions.length !== 6) {
    throw new Error('final human decision report must contain exactly 3 DB and 6 workbook rows');
  }
  const finalHumanDecisions = [...finalHumanDbDecisions, ...finalHumanWorkbookDecisions];
  const candidateIdentityByImportKey = new Map<
    string,
    { topicId: string; postId: string; candidateOrdinal: number }
  >();
  for (const post of candidateIdentities.posts) {
    for (const candidate of post.candidates) {
      if (candidateIdentityByImportKey.has(candidate.importKey)) {
        throw new Error(`duplicate accepted candidate import identity: ${candidate.importKey}`);
      }
      candidateIdentityByImportKey.set(candidate.importKey, {
        topicId: post.topicId,
        postId: post.postId,
        candidateOrdinal: candidate.candidateOrdinal,
      });
    }
  }
  const dbImportedEvidence = finalHumanDbDecisions.map((entry): DbImportedEvidence => {
    const fish = entry.existingFish[0];
    if (fish === undefined || entry.existingFish.length !== 1) {
      throw new Error(`expected one current Fish for imported evidence: ${entry.value}`);
    }
    const reports = fishReferences.reports.filter((report) => report.fishId === fish.fishId);
    const native = reports.filter((report) => report.importKey === null);
    const imported = reports.filter((report) => report.importKey !== null);
    const unmappedImportedReportIds: string[] = [];
    const reportsByTopic = new Map<string, Array<{ reportId: string; fishingBaseName: string }>>();
    for (const report of imported) {
      const identity = candidateIdentityByImportKey.get(report.importKey as string);
      if (identity === undefined) {
        unmappedImportedReportIds.push(report.reportId);
        continue;
      }
      const reportIds = reportsByTopic.get(identity.topicId) ?? [];
      reportIds.push({ reportId: report.reportId, fishingBaseName: report.fishingBaseName });
      reportsByTopic.set(identity.topicId, reportIds);
    }
    const importedSources = [...reportsByTopic]
      .sort(([left], [right]) => Number(BigInt(left) - BigInt(right)))
      .map(([topicId, sourceReports]) => {
        const topic = corpusByTopic.get(topicId);
        if (topic === undefined) {
          throw new Error(`imported report source topic is absent from forum69 corpus: ${topicId}`);
        }
        return {
          topicId,
          sourceTitle: topic.sourceTitle,
          canonicalName: topic.canonicalName,
          reportsCount: sourceReports.length,
          reportIds: sourceReports.map((report) => report.reportId).sort(),
          reportBaseNames: [
            ...new Set(sourceReports.map((report) => report.fishingBaseName)),
          ].sort(),
        };
      });
    const evidenceConclusion =
      imported.length === 0
        ? 'NO_IMPORTED_EVIDENCE'
        : unmappedImportedReportIds.length > 0
          ? 'INCOMPLETE_IMPORT_TRACE'
          : importedSources.length === 1
            ? 'ONE_FORUM69_FISH'
            : 'CONFLICTING_FORUM69_FISH';
    return {
      fishId: fish.fishId,
      fishName: fish.name,
      reports: {
        total: reports.length,
        native: native.length,
        imported: imported.length,
        importedMapped: imported.length - unmappedImportedReportIds.length,
      },
      importedSources,
      unmappedImportedReportIds: [...unmappedImportedReportIds].sort(),
      evidenceConclusion,
    };
  });
  const safeExtraDecisions = manualDbReview
    .filter((entry) => entry.currentName === 'Акула' || entry.currentName === 'Скат')
    .map((entry) => ({
      fishId: entry.fishId,
      currentName: entry.currentName,
      currentIsActive: entry.currentIsActive,
      catchReports: entry.catchReports,
      fishingBaseFish: entry.fishingBaseFish,
      decision: entry.recommendation,
      recommendedIsActive: entry.recommendedIsActive,
    }));
  if (
    safeExtraDecisions.length !== 2 ||
    safeExtraDecisions.some(
      (entry) => entry.decision !== 'KEEP_EXTRA' || entry.recommendedIsActive !== false,
    )
  ) {
    throw new Error('Акула and Скат must be finalized as inactive KEEP_EXTRA Fish');
  }
  const safeDbRenameDecisions = dbImportedEvidence.map((evidence) => {
    const review = manualDbReview.find((entry) => entry.fishId === evidence.fishId);
    const source = evidence.importedSources[0];
    if (
      review === undefined ||
      source === undefined ||
      evidence.evidenceConclusion !== 'ONE_FORUM69_FISH' ||
      evidence.importedSources.length !== 1 ||
      review.recommendation !== 'RENAME' ||
      review.proposedCanonicalName !== source.canonicalName
    ) {
      throw new Error(`import evidence does not support one safe DB rename: ${evidence.fishName}`);
    }
    return {
      fishId: review.fishId,
      currentName: review.currentName,
      decision: review.recommendation,
      topicId: source.topicId,
      canonicalName: source.canonicalName,
    };
  });
  const safeWorkbookNames = new Set(['Коралловый группер', 'Красный луциан', 'Лещ морской']);
  const safeWorkbookDecisions = decisions
    .filter((entry) => safeWorkbookNames.has(entry.rawName))
    .map((entry) => {
      if (entry.decision !== 'PROPOSED' || entry.topicId === null || entry.canonicalName === null) {
        throw new Error(`safe workbook evidence is not finalized: ${entry.rawName}`);
      }
      return {
        rawName: entry.rawName,
        rows: entry.rows,
        decision: entry.decision,
        topicId: entry.topicId,
        canonicalName: entry.canonicalName,
      };
    });
  const stillManualWorkbookDecisions = decisions
    .filter((entry) => entry.decision === 'MANUAL')
    .map((entry) => ({ rawName: entry.rawName, rows: entry.rows }));
  const doNotMapWorkbookDecisions = decisions
    .filter((entry) => entry.decision === 'DO_NOT_MAP')
    .map((entry) => ({
      rawName: entry.rawName,
      rows: entry.rows,
      cells: entry.cells,
      decision: entry.decision,
      topicId: null,
      canonicalName: null,
      rationale: entry.rationale,
    }));
  if (
    safeWorkbookDecisions.length !== 3 ||
    doNotMapWorkbookDecisions.length !== 3 ||
    stillManualWorkbookDecisions.length !== 0
  ) {
    throw new Error('final unresolved workbook decision partition changed');
  }

  const finalFishCounts = { ...countByCategory(finalizedFishEntries), MANUAL: 0 };
  const finalWorkbookCounts = { ...countByCategory(projectedRows), MANUAL: 0 };
  const finalFishManifest = {
    schemaVersion: 2,
    mode: 'APPLY_READY',
    sourceCatalogFingerprint: fishManifest.sourceCatalogFingerprint,
    policy: {
      forum69TopicIdentityIsCanonical: true,
      preserveExistingFishIdForRename: true,
      explicitRepointTargetsOnly: true,
      fuzzyMatching: false,
    },
    counts: finalFishCounts,
    entries: finalizedFishEntries,
  };
  const finalWorkbookManifest = {
    schemaVersion: 2,
    mode: 'APPLY_READY',
    sourceWorkbook: { ...workbookManifest.sourceWorkbook },
    policy: {
      membershipOnly: true,
      rawExcelNamesMayBecomeDisplayNames: false,
      sourceAliasesRemainEvidenceOnly: true,
      doNotMapCreatesMembership: false,
      fuzzyMatching: false,
    },
    counts: finalWorkbookCounts,
    projectedMemberships,
    humanDecisions: {
      doNotMap: doNotMapWorkbookDecisions,
    },
    rows: projectedRows,
  };

  const dbAudit = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    sourceCatalogFingerprint: fishManifest.sourceCatalogFingerprint,
    counts: {
      manualFish: manualDbReview.length,
      recommendations: Object.fromEntries(
        ['KEEP_EXTRA', 'RENAME', 'REPOINT+DEACTIVATE', 'MANUAL'].map((recommendation) => [
          recommendation,
          manualDbReview.filter((entry) => entry.recommendation === recommendation).length,
        ]),
      ),
    },
    entries: manualDbReview,
  };
  const workbookAudit = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    sourceWorkbookSha256: workbookManifest.sourceWorkbook.sha256,
    policy: {
      forum69FullNameAuthority: true,
      aliasesRemainSourceCellsOnly: true,
      fuzzyMatching: false,
      applyManifestChanged: true,
    },
    counts: {
      originalManualRows: 223,
      originalManualDistinctValues: 135,
      proposedResolvedRows: resolvedRows,
      proposedResolvedDistinctValues: proposed.length,
      excludedNonFishRows,
      excludedNonFishDistinctValues: excludedNonFish.length,
      excludedNoiseRows,
      excludedNoiseDistinctValues: excludedNoise.length,
      doNotMapRows,
      doNotMapDistinctValues: doNotMap.length,
      unresolvedRows,
      unresolvedDistinctValues: unresolved.length,
      originalProjectedUniqueBaseFish: originalMemberships,
      projectedUniqueBaseFish: projectedMemberships,
      projectedUniqueBaseFishDelta: projectedMemberships - originalMemberships,
    },
    decisions,
  };
  const humanDecisionAudit = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    policy: {
      noFuzzyMatching: true,
      baseContextIsEvidenceOnly: true,
      baseContextSupportRequiresIndependentResolvedWorkbookOrExactCanonicalFish: true,
      automaticDecisionTaken: false,
    },
    counts: {
      db: finalHumanDbDecisions.length,
      workbookDistinctValues: finalHumanWorkbookDecisions.length,
      workbookRows: finalHumanWorkbookDecisions.reduce(
        (total, entry) => total + entry.workbookCells.length,
        0,
      ),
      uniquelySupportedByBaseContext: finalHumanDecisions.filter(
        (entry) => entry.uniquelySupportedCandidateByBaseContext !== null,
      ).length,
    },
    entries: finalHumanDecisions,
  };
  const unresolvedEvidenceAudit = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY',
    policy: {
      importedTraceUsesExactImportKey: true,
      importKeysEmitted: false,
      nativeReportsCarryNoForumIdentity: true,
      nameSimilarityUsed: false,
      automaticDecisionTaken: false,
    },
    safeDecisions: {
      dbExtras: safeExtraDecisions,
      dbRenames: safeDbRenameDecisions,
      workbookMappings: safeWorkbookDecisions,
    },
    stillManualDecisions: {
      db: [],
      workbook: stillManualWorkbookDecisions,
    },
    doNotMapDecisions: doNotMapWorkbookDecisions,
    dbReportEvidence: dbImportedEvidence,
    workbookDecisiveEvidence: finalHumanWorkbookDecisions,
  };
  const recoveryAudit = {
    schemaVersion: 1,
    mode: 'AUDIT_ONLY_PROJECTED',
    beforeManualWorkbookReview: beforeRecovery,
    afterManualWorkbookReview: afterRecovery,
    updatedCounts: {
      currentlyFishBlockedCandidates: afterRecovery.candidates.currentFishBlocked,
      fishResolvedAgainstProposedCanonicalCatalog:
        afterRecovery.currentFishBlockedRecovery.fishResolved,
      usableAfterProjectedBaseFish:
        afterRecovery.currentFishBlockedRecovery.usableAfterProjectedMembership,
      newlyUsableDeltaFromManualWorkbookReview:
        afterRecovery.currentFishBlockedRecovery.usableAfterProjectedMembership -
        beforeRecovery.currentFishBlockedRecovery.usableAfterProjectedMembership,
      membershipResolved: afterRecovery.currentFishBlockedRecovery.membershipResolved,
      membershipMissing: afterRecovery.currentFishBlockedRecovery.membershipMissing,
      membershipDependencyUnresolved:
        afterRecovery.currentFishBlockedRecovery.membershipDependencyUnresolved,
      stillFishUnresolved: afterRecovery.currentFishBlockedRecovery.stillFishUnresolved,
    },
  };

  return [
    { url: new URL('forum69-fish.json', CATALOG_DATA), content: stableJson(forumManifest) },
    {
      url: new URL('fish-reconciliation.json', CATALOG_DATA),
      content: stableJson(finalFishManifest),
    },
    {
      url: new URL('fishing-base-fish-reconciliation.json', CATALOG_DATA),
      content: stableJson(finalWorkbookManifest),
    },
    {
      url: new URL('list-fish-metadata.json', CATALOG_DATA),
      content: stableJson(listFishManifest),
    },
    { url: new URL('manual-db-fish-review.audit.json', AUDIT_DATA), content: stableJson(dbAudit) },
    {
      url: new URL('manual-db-fish-review.audit.csv', AUDIT_DATA),
      content: manualDbCsv(manualDbReview),
    },
    {
      url: new URL('manual-base-fish-review.audit.json', AUDIT_DATA),
      content: stableJson(workbookAudit),
    },
    {
      url: new URL('manual-base-fish-review.audit.csv', AUDIT_DATA),
      content: workbookDecisionCsv(decisions),
    },
    {
      url: new URL('manual-base-fish-unresolved.audit.csv', AUDIT_DATA),
      content: workbookDecisionCsv(unresolved),
    },
    {
      url: new URL('manual-fish-collisions.audit.json', AUDIT_DATA),
      content: stableJson({ schemaVersion: 1, mode: 'AUDIT_ONLY', collisions }),
    },
    {
      url: new URL('final-human-decisions.audit.json', AUDIT_DATA),
      content: stableJson(humanDecisionAudit),
    },
    {
      url: new URL('final-human-decisions.audit.csv', AUDIT_DATA),
      content: humanDecisionCsv(finalHumanDecisions),
    },
    {
      url: new URL('final-unresolved-evidence.audit.json', AUDIT_DATA),
      content: stableJson(unresolvedEvidenceAudit),
    },
    {
      url: new URL('final-unresolved-evidence.audit.csv', AUDIT_DATA),
      content: unresolvedEvidenceCsv(dbImportedEvidence, finalHumanWorkbookDecisions),
    },
    {
      url: new URL('forum69-recovery-after-manual-review.audit.json', AUDIT_DATA),
      content: stableJson(recoveryAudit),
    },
  ];
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });
  try {
    const check = process.argv.slice(2).includes('--check');
    const artifacts = await buildArtifacts(prisma);
    await mkdir(AUDIT_DATA, { recursive: true });
    for (const artifact of artifacts) {
      if (check) {
        const current = await readFile(artifact.url, 'utf8');
        if (current !== artifact.content) {
          throw new Error(`Generated manual Fish review is stale: ${fileURLToPath(artifact.url)}`);
        }
      } else {
        await writeFile(artifact.url, artifact.content, 'utf8');
      }
    }
    process.stdout.write(
      stableJson({ mode: check ? 'check' : 'write', artifacts: artifacts.length }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Manual Fish review generation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
