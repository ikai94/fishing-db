import { HttpException } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { normalizeEmail } from '../auth/normalization.js';
import { isPrismaError } from '../catalog/catalog-errors.js';
import { prepareCatchReportCreate } from '../catch-reports/catch-report-create-domain.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { CreateCatchReportDto } from '../catch-reports/dto/create-catch-report.dto.js';
import { loadCatalogSnapshot } from './catalog-source.js';
import type { StagingCandidate } from './staging.js';
import {
  assertCompleteStagingCandidate,
  type VerifiedForumStagingBundle,
} from './staging-reader.js';

const REQUIRED_MIGRATIONS = [
  '20260809121540_add_catch_reports',
  '20260809144907_replace_location_fish_with_fishing_base_fish',
  '20260809145137_add_catch_report_v2_compatibility',
  '20260809151033_enforce_catch_report_v2_invariant',
  '20260820120000_add_catch_report_contributor_identity',
  '20260826120000_relax_catch_report_observations',
] as const;
const REQUIRED_COLUMNS = [
  'userId',
  'contributorKey',
  'importKey',
  'locationId',
  'fishId',
  'baitId',
  'weightGrams',
  'fishingMethod',
  'holeDepthCm',
  'spotPositionRaw',
  'fishingNote',
  'spinningSize',
  'spinningSpeed',
  'userNoteRaw',
  'rawSourceText',
] as const;
const SERIALIZABLE_ATTEMPTS = 3;
const QUERY_BATCH_SIZE = 500;
const INSERT_BATCH_SIZE = 250;
const TRANSACTION_MAX_WAIT_MS = 10_000;
const TRANSACTION_TIMEOUT_MS = 120_000;
const DTO_METADATA: ArgumentMetadata = { type: 'body', metatype: CreateCatchReportDto };

type ImportFailureCode =
  | 'ADMIN_ACCOUNT_INVALID'
  | 'CATALOG_FINGERPRINT_MISMATCH'
  | 'DATABASE_SCHEMA_NOT_READY'
  | 'IMPORT_CONFLICT'
  | 'VALIDATION_FAILED';

export interface ForumCompleteImportSummary {
  dryRun: boolean;
  totalCandidates: number;
  completeCandidates: number;
  partialPreserved: number;
  unresolvedPreserved: number;
  validationFailed: number;
  conflicts: number;
  alreadyPresent: number;
  wouldInsert: number;
  inserted: number;
}

export class ForumCompleteImportError extends Error {
  constructor(
    readonly code: ImportFailureCode,
    message: string,
    readonly summary?: ForumCompleteImportSummary,
    readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ForumCompleteImportError';
  }
}

export interface ForumCompleteImportOptions {
  adminEmail: string;
  dryRun: boolean;
  bundle: VerifiedForumStagingBundle;
}

interface ExistingCatchReport {
  userId: string;
  contributorKey: string;
  importKey: string | null;
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  userNoteRaw: string | null;
  rawSourceText: string | null;
}

interface PreparedImport {
  candidate: StagingCandidate;
  data: Prisma.CatchReportCreateManyInput;
}

class ForumCandidateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForumCandidateValidationError';
  }
}

function baseSummary(
  bundle: VerifiedForumStagingBundle,
  dryRun: boolean,
): ForumCompleteImportSummary {
  let completeCandidates = 0;
  let partialPreserved = 0;
  let unresolvedPreserved = 0;
  for (const candidate of bundle.candidates) {
    if (candidate.status === 'USABLE_COMPLETE') completeCandidates += 1;
    else if (candidate.status === 'USABLE_PARTIAL') partialPreserved += 1;
    else unresolvedPreserved += 1;
  }
  return {
    dryRun,
    totalCandidates: bundle.candidates.length,
    completeCandidates,
    partialPreserved,
    unresolvedPreserved,
    validationFailed: 0,
    conflicts: 0,
    alreadyPresent: 0,
    wouldInsert: 0,
    inserted: 0,
  };
}

function chunks<Value>(values: readonly Value[], size: number): Value[][] {
  const result: Value[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function failureDescription(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return String(response.code);
    }
  }
  return error instanceof Error ? error.message : 'Unknown validation failure';
}

async function candidateDto(candidate: StagingCandidate): Promise<CreateCatchReportDto> {
  const locationId = candidate.resolution.location.id;
  const fishId = candidate.resolution.fish.id;
  const baitId = candidate.resolution.bait.id;
  if (locationId === null || fishId === null || baitId === null) {
    throw new Error('COMPLETE candidate has a missing catalog ID');
  }
  const pipe = createApplicationValidationPipe(CreateCatchReportDto);
  return (await pipe.transform(
    {
      locationId,
      fishId,
      baitId,
      weightGrams: candidate.weightGrams,
      holeDepthCm: candidate.holeDepthCm,
      spotPositionRaw: candidate.spotPositionRaw,
      fishingNote: candidate.fishingNote,
      spinningSize: candidate.spinningSize,
      spinningSpeed: candidate.spinningSpeed,
      userNoteRaw: candidate.userNoteRaw,
      rawSourceText: null,
    },
    DTO_METADATA,
  )) as CreateCatchReportDto;
}

function differingFields(existing: ExistingCatchReport, planned: PreparedImport['data']): string[] {
  const fields = [
    'userId',
    'contributorKey',
    'importKey',
    'locationId',
    'fishId',
    'baitId',
    'weightGrams',
    'fishingMethod',
    'holeDepthCm',
    'spotPositionRaw',
    'fishingNote',
    'spinningSize',
    'spinningSpeed',
    'userNoteRaw',
    'rawSourceText',
  ] as const;
  return fields.filter((field) => existing[field] !== planned[field]);
}

async function resolveAdmin(
  transaction: Prisma.TransactionClient,
  adminEmail: string,
): Promise<{ id: string; email: string }> {
  const [admin] = await transaction.$queryRaw<
    Array<{ id: string; email: string; role: 'USER' | 'ADMIN'; isBanned: boolean }>
  >`
    SELECT "id", "email", "role"::text AS "role", "isBanned"
    FROM "User"
    WHERE "email" = ${adminEmail}
    FOR SHARE
  `;
  if (admin === undefined) {
    throw new ForumCompleteImportError(
      'ADMIN_ACCOUNT_INVALID',
      `Configured ADMIN_EMAIL does not identify a local user: ${adminEmail}`,
    );
  }
  if (admin.role !== 'ADMIN') {
    throw new ForumCompleteImportError(
      'ADMIN_ACCOUNT_INVALID',
      `Configured ADMIN_EMAIL is not an ADMIN: ${adminEmail}`,
    );
  }
  if (admin.isBanned) {
    throw new ForumCompleteImportError(
      'ADMIN_ACCOUNT_INVALID',
      `Configured ADMIN_EMAIL belongs to a banned ADMIN: ${adminEmail}`,
    );
  }
  return { id: admin.id, email: admin.email };
}

export async function assertForumImportSchemaReady(prisma: PrismaClient): Promise<void> {
  try {
    const migrations = await prisma.$queryRaw<
      Array<{ migrationName: string; finishedAt: Date | null; rolledBackAt: Date | null }>
    >`
      SELECT
        migration_name AS "migrationName",
        finished_at AS "finishedAt",
        rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      WHERE migration_name IN (
        '20260809121540_add_catch_reports',
        '20260809144907_replace_location_fish_with_fishing_base_fish',
        '20260809145137_add_catch_report_v2_compatibility',
        '20260809151033_enforce_catch_report_v2_invariant',
        '20260820120000_add_catch_report_contributor_identity',
        '20260826120000_relax_catch_report_observations'
      )
    `;
    const successful = new Set(
      migrations
        .filter((migration) => migration.finishedAt !== null && migration.rolledBackAt === null)
        .map((migration) => migration.migrationName),
    );
    const missingMigrations = REQUIRED_MIGRATIONS.filter((name) => !successful.has(name));

    const columns = await prisma.$queryRaw<Array<{ columnName: string; isNullable: 'YES' | 'NO' }>>`
      SELECT column_name AS "columnName", is_nullable AS "isNullable"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'CatchReport'
    `;
    const presentColumns = new Map(columns.map((column) => [column.columnName, column]));
    const missingColumns = REQUIRED_COLUMNS.filter((name) => !presentColumns.has(name));
    const identityNullabilityValid =
      presentColumns.get('contributorKey')?.isNullable === 'NO' &&
      presentColumns.get('importKey')?.isNullable === 'YES';

    const [databaseObjects] = await prisma.$queryRaw<
      Array<{
        requiredConstraints: boolean;
        importKeyIndex: boolean;
        identityTrigger: boolean;
      }>
    >`
      SELECT
        (
          SELECT count(*) = 5
          FROM pg_constraint constraint_row
          JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
          JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
          WHERE namespace_row.nspname = current_schema()
            AND table_row.relname = 'CatchReport'
            AND constraint_row.conname IN (
              'CatchReport_weightGrams_positive_check',
              'CatchReport_holeDepthCm_positive_check',
              'CatchReport_method_observations_check',
              'CatchReport_contributorKey_nonempty_check',
              'CatchReport_importKey_nonempty_check'
            )
            AND constraint_row.convalidated
        ) AS "requiredConstraints",
        EXISTS (
          SELECT 1
          FROM pg_index index_row
          JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
          JOIN pg_class table_row ON table_row.oid = index_row.indrelid
          JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
          WHERE namespace_row.nspname = current_schema()
            AND table_row.relname = 'CatchReport'
            AND index_class.relname = 'CatchReport_importKey_key'
            AND index_row.indisunique
            AND index_row.indisvalid
        ) AS "importKeyIndex",
        EXISTS (
          SELECT 1
          FROM pg_trigger trigger_row
          JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
          JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
          WHERE namespace_row.nspname = current_schema()
            AND table_row.relname = 'CatchReport'
            AND trigger_row.tgname = 'CatchReport_identity_immutable_trigger'
            AND NOT trigger_row.tgisinternal
            AND trigger_row.tgenabled <> 'D'
        ) AS "identityTrigger"
    `;

    const problems = [
      ...(missingMigrations.length === 0
        ? []
        : [`missing migrations: ${missingMigrations.join(', ')}`]),
      ...(missingColumns.length === 0 ? [] : [`missing columns: ${missingColumns.join(', ')}`]),
      ...(identityNullabilityValid ? [] : ['identity column nullability mismatch']),
      ...(databaseObjects?.requiredConstraints
        ? []
        : ['required CatchReport constraints missing or unvalidated']),
      ...(databaseObjects?.importKeyIndex ? [] : ['CatchReport importKey unique index missing']),
      ...(databaseObjects?.identityTrigger ? [] : ['CatchReport identity trigger missing']),
    ];
    if (problems.length > 0) {
      throw new ForumCompleteImportError(
        'DATABASE_SCHEMA_NOT_READY',
        `Database schema is not ready for forum import: ${problems.join('; ')}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof ForumCompleteImportError) throw error;
    const message = error instanceof Error ? error.message : 'unknown schema inspection error';
    throw new ForumCompleteImportError(
      'DATABASE_SCHEMA_NOT_READY',
      `Database schema readiness check failed: ${message}`,
    );
  }
}

async function runAttempt(
  transaction: Prisma.TransactionClient,
  options: ForumCompleteImportOptions,
  normalizedAdminEmail: string,
): Promise<ForumCompleteImportSummary> {
  const summary = baseSummary(options.bundle, options.dryRun);
  const admin = await resolveAdmin(transaction, normalizedAdminEmail);
  const catalog = await loadCatalogSnapshot(transaction);
  if (catalog.fingerprint !== options.bundle.manifest.catalogSnapshotFingerprint) {
    throw new ForumCompleteImportError(
      'CATALOG_FINGERPRINT_MISMATCH',
      'Live catalog fingerprint differs from the verified staging manifest; restage explicitly',
      summary,
    );
  }

  const complete = options.bundle.candidates.filter(
    (candidate) => candidate.status === 'USABLE_COMPLETE',
  );
  const prepared: PreparedImport[] = [];
  const validationFailures: string[] = [];
  for (const candidate of complete) {
    assertCompleteStagingCandidate(candidate);
    try {
      const contributorKey = candidate.contributorKey;
      if (contributorKey === null) {
        throw new ForumCandidateValidationError('COMPLETE candidate has a missing contributorKey');
      }
      const dto = await candidateDto(candidate);
      const domain = await prepareCatchReportCreate(transaction, dto);
      if (domain.fishingBaseId !== candidate.resolution.fishingBase.id) {
        throw new ForumCandidateValidationError(
          'staged FishingBase ID does not own the staged Location ID',
        );
      }
      if (domain.data.fishingMethod !== candidate.fishingMethod) {
        throw new ForumCandidateValidationError(
          'staged fishingMethod differs from the current Bait-derived method',
        );
      }
      prepared.push({
        candidate,
        data: {
          userId: admin.id,
          contributorKey,
          importKey: candidate.importKey,
          ...domain.data,
          rawSourceText: null,
        },
      });
    } catch (error: unknown) {
      if (!(error instanceof HttpException) && !(error instanceof ForumCandidateValidationError)) {
        throw error;
      }
      validationFailures.push(`${candidate.importKey}: ${failureDescription(error)}`);
    }
  }
  summary.validationFailed = validationFailures.length;
  if (validationFailures.length > 0) {
    throw new ForumCompleteImportError(
      'VALIDATION_FAILED',
      `${String(validationFailures.length)} COMPLETE candidate(s) failed current CatchReport validation`,
      summary,
      validationFailures,
    );
  }

  const existing = new Map<string, ExistingCatchReport>();
  for (const batch of chunks(
    prepared.map((item) => item.candidate.importKey),
    QUERY_BATCH_SIZE,
  )) {
    const rows = await transaction.catchReport.findMany({
      where: { importKey: { in: batch } },
      select: {
        userId: true,
        contributorKey: true,
        importKey: true,
        locationId: true,
        fishId: true,
        baitId: true,
        weightGrams: true,
        fishingMethod: true,
        holeDepthCm: true,
        spotPositionRaw: true,
        fishingNote: true,
        spinningSize: true,
        spinningSpeed: true,
        userNoteRaw: true,
        rawSourceText: true,
      },
    });
    for (const row of rows) {
      if (row.importKey !== null) existing.set(row.importKey, row);
    }
  }

  const missing: PreparedImport[] = [];
  const conflicts: string[] = [];
  for (const item of prepared) {
    const current = existing.get(item.candidate.importKey);
    if (current === undefined) {
      missing.push(item);
      continue;
    }
    const differing = differingFields(current, item.data);
    if (differing.length === 0) summary.alreadyPresent += 1;
    else conflicts.push(`${item.candidate.importKey}: ${differing.join(', ')}`);
  }
  summary.conflicts = conflicts.length;
  summary.wouldInsert = missing.length;
  if (conflicts.length > 0) {
    throw new ForumCompleteImportError(
      'IMPORT_CONFLICT',
      `${String(conflicts.length)} existing importKey(s) conflict with staged content`,
      summary,
      conflicts,
    );
  }

  if (!options.dryRun) {
    for (const batch of chunks(missing, INSERT_BATCH_SIZE)) {
      await transaction.catchReport.createMany({ data: batch.map((item) => item.data) });
    }
    summary.inserted = missing.length;
  }
  return summary;
}

export async function importCompleteForumCandidates(
  prisma: PrismaClient,
  options: ForumCompleteImportOptions,
): Promise<ForumCompleteImportSummary> {
  const normalizedAdminEmail = normalizeEmail(options.adminEmail);
  await assertForumImportSchemaReady(prisma);
  let lastConflict: unknown;
  for (let attempt = 1; attempt <= SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        (transaction) => runAttempt(transaction, options, normalizedAdminEmail),
        {
          isolationLevel: 'Serializable',
          maxWait: TRANSACTION_MAX_WAIT_MS,
          timeout: TRANSACTION_TIMEOUT_MS,
        },
      );
    } catch (error: unknown) {
      if (!isPrismaError(error, 'P2034') && !isPrismaError(error, 'P2002')) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}
