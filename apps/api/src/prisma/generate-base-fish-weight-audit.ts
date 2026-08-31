import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  baseFishWeightAuditCsv,
  buildBaseFishWeightAudit,
  readWorkbookAuditWorksheets,
} from './base-fish-weight-audit.js';
import {
  baseFishWeightApplyReadySha256,
  buildBaseFishWeightApplyReadyManifest,
  type BaseFishWeightReviewedDecisions,
} from './base-fish-weight-apply-ready.js';
import {
  sha256,
  stableJson,
  type ForumFishIdentity,
  type WorkbookFishResolution,
} from './fish-catalog-audit.js';

const LOCAL_ROOT = new URL('../../.local/', import.meta.url);
const CATALOG_DATA = new URL('../../prisma/catalog-data/', import.meta.url);
const AUDIT_DATA = new URL('audits/base-fish-weights/', CATALOG_DATA);
const WORKBOOK = new URL('catalog/Klevalka-2026.xlsx', LOCAL_ROOT);
const RECONCILIATION = new URL('fishing-base-fish-reconciliation.json', CATALOG_DATA);
const FORUM69 = new URL('forum69-fish.json', CATALOG_DATA);
const REVIEWED_DECISIONS = new URL('base-fish-weight-reviewed-decisions.json', CATALOG_DATA);
const APPLY_READY_MANIFEST = new URL('fishing-base-fish-weights.json', CATALOG_DATA);
const EXPECTED_WORKBOOK_SHA256 = '58c13109fe71e3c041f40d6e721b6c6cd0d0bbade43fe7dc1b0063dd8ba7eac3';
const EXPECTED_RECONCILIATION_SHA256 =
  '9fc0545e3754e1be0fa0f45a1d2e27f2e3856d98c7fe0d80955b275e4da7a7f6';
const EXPECTED_FORUM69_SHA256 = 'd02e29cbec275375626870a84091ac4cc198e9ca522bd9190352132ff47f1060';

interface ReconciliationManifest {
  schemaVersion: number;
  mode: string;
  rows: WorkbookFishResolution[];
}

interface Forum69Manifest {
  schemaVersion: number;
  policy?: { excelNamesAreDisplayNames?: boolean };
  fish: ForumFishIdentity[];
}

interface OutputArtifact {
  url: URL;
  content: string;
}

async function readJsonFile<T>(url: URL): Promise<{ parsed: T; content: string; hash: string }> {
  const content = await readFile(url, 'utf8');
  return { parsed: JSON.parse(content) as T, content, hash: sha256(content) };
}

async function buildArtifacts(): Promise<{
  artifacts: OutputArtifact[];
  summary: Record<string, unknown>;
}> {
  const [workbook, reconciliationFile, forumFile, reviewedDecisionsFile] = await Promise.all([
    readFile(WORKBOOK),
    readJsonFile<ReconciliationManifest>(RECONCILIATION),
    readJsonFile<Forum69Manifest>(FORUM69),
    readJsonFile<BaseFishWeightReviewedDecisions>(REVIEWED_DECISIONS),
  ]);
  const workbookSha256 = sha256(workbook);
  if (workbookSha256 !== EXPECTED_WORKBOOK_SHA256) {
    throw new Error(`Workbook SHA-256 ${workbookSha256} is not the accepted source`);
  }
  if (reconciliationFile.hash !== EXPECTED_RECONCILIATION_SHA256) {
    throw new Error(
      `FishingBaseFish reconciliation SHA-256 ${reconciliationFile.hash} is not accepted`,
    );
  }
  if (forumFile.hash !== EXPECTED_FORUM69_SHA256) {
    throw new Error(`forum69 manifest SHA-256 ${forumFile.hash} is not accepted`);
  }
  if (reconciliationFile.parsed.schemaVersion !== 2) {
    throw new Error('FishingBaseFish reconciliation schemaVersion is not 2');
  }
  if (reconciliationFile.parsed.mode !== 'APPLY_READY') {
    throw new Error('FishingBaseFish reconciliation manifest is not APPLY_READY');
  }
  if (forumFile.parsed.schemaVersion !== 1) {
    throw new Error('forum69 manifest schemaVersion is not 1');
  }
  if (forumFile.parsed.policy?.excelNamesAreDisplayNames !== false) {
    throw new Error('forum69 manifest does not forbid Excel names from becoming Fish names');
  }
  if (reviewedDecisionsFile.content !== stableJson(reviewedDecisionsFile.parsed)) {
    throw new Error('BaseFish weight reviewed decisions formatting is not deterministic');
  }

  const worksheets = readWorkbookAuditWorksheets(
    workbook,
    reconciliationFile.parsed.rows.map((row) => row.sourceSheet),
  );
  const audit = buildBaseFishWeightAudit({
    reconciliationRows: reconciliationFile.parsed.rows,
    forumFish: forumFile.parsed.fish,
    worksheets,
    sources: {
      workbookFileName: 'Klevalka-2026.xlsx',
      workbookSha256,
      reconciliationSha256: reconciliationFile.hash,
      forum69Sha256: forumFile.hash,
    },
    expectedCounts: {
      totalRows: 3_659,
      mappedRows: 3_597,
      uniqueTargetMemberships: 3_596,
    },
  });
  const applyReadyManifest = buildBaseFishWeightApplyReadyManifest({
    audit,
    reviewedDecisions: reviewedDecisionsFile.parsed,
    reviewedDecisionsSha256: reviewedDecisionsFile.hash,
    expectedTargetCount: 3_596,
  });
  const manualCsv = baseFishWeightAuditCsv(audit.manualReviewRows);
  const artifacts = [
    {
      url: new URL('base-fish-weight.audit.json', AUDIT_DATA),
      content: stableJson(audit),
    },
    {
      url: new URL('base-fish-weight.audit.csv', AUDIT_DATA),
      content: baseFishWeightAuditCsv(audit.rows),
    },
    {
      url: new URL('base-fish-weight-manual-review.audit.csv', AUDIT_DATA),
      content: manualCsv,
    },
    {
      url: APPLY_READY_MANIFEST,
      content: stableJson(applyReadyManifest),
    },
  ];

  return {
    artifacts,
    summary: {
      reconciliation: audit.reconciliation,
      uniqueTargetMemberships: audit.uniqueTargetMemberships,
      weightStatusCounts: audit.weightStatusCounts,
      duplicateIdenticalGroups: audit.duplicateIdenticalGroups,
      conflictingGroups: audit.conflictingGroups,
      manualReviewRows: audit.manualReviewRows,
      blockersBeforeApplyReady: audit.blockersBeforeApplyReady,
      applyReady: audit.applyReady,
      finalMode: applyReadyManifest.mode,
      finalCounts: applyReadyManifest.counts,
      unresolvedBlockers: applyReadyManifest.unresolvedBlockers,
      applyReadySha256: baseFishWeightApplyReadySha256(applyReadyManifest),
    },
  };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--check')) {
    throw new Error('usage: generate-base-fish-weight-audit.ts [--check]');
  }
  const check = args.includes('--check');
  const { artifacts, summary } = await buildArtifacts();
  await mkdir(AUDIT_DATA, { recursive: true });

  for (const artifact of artifacts) {
    if (check) {
      let current: string;
      try {
        current = await readFile(artifact.url, 'utf8');
      } catch {
        throw new Error(
          `BaseFish weight audit artifact is missing: ${fileURLToPath(artifact.url)}`,
        );
      }
      if (current !== artifact.content) {
        throw new Error(`BaseFish weight audit artifact is stale: ${fileURLToPath(artifact.url)}`);
      }
    } else {
      await writeFile(artifact.url, artifact.content, 'utf8');
    }
  }

  process.stdout.write(
    stableJson({
      mode: check ? 'check' : 'write',
      artifacts: artifacts.map((artifact) => fileURLToPath(artifact.url)),
      ...summary,
    }),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`BaseFish weight audit generation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
