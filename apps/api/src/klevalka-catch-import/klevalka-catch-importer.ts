import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ArgumentMetadata } from '@nestjs/common';
import { isPrismaError } from '../catalog/catalog-errors.js';
import { prepareCatchReportCreates } from '../catch-reports/catch-report-create-domain.js';
import { nativeContributorKey } from '../catch-reports/catch-report-identity.js';
import type {
  CatchReportDraft,
  DraftField,
} from '../catch-reports/parser/catch-report-parser.types.js';
import { CatchReportParserService } from '../catch-reports/parser/catch-report-parser.service.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { CreateCatchReportDto } from '../catch-reports/dto/create-catch-report.dto.js';
import { loadCurrentKlevalkaCatalog } from '../klevalka-catch-generator/generate-klevalka-catches.js';
import type { KlevalkaCatalogSnapshot } from '../klevalka-catch-generator/klevalka-catch-generator.js';
import { catalogSha256 } from '../klevalka-catch-generator/review-klevalka-snapshots.js';

export const APPROVED_KLEVALKA_V3_RELEASE_SHA256 =
  '3eabcfd828a21da736ae0872a98f565edbd7e922579fa179aea47946bed63b1b';
export const APPROVED_KLEVALKA_V3_LINES = 7_105_791;

const IMPORT_BATCH_SIZE = 1_000;
const INSERT_CHUNK_SIZE = 500;
const TRANSACTION_ATTEMPTS = 3;
const TRANSACTION_TIMEOUT_MS = 120_000;
const IMPORT_INITIALIZATION_LOCK = 7_105_791n;
const DTO_METADATA: ArgumentMetadata = { type: 'body', metatype: CreateCatchReportDto };
const DTO_PIPE = createApplicationValidationPipe(CreateCatchReportDto);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const APPROVED_WHALE_BASES = ['Кроноцкий залив', 'Саргассово море', 'ЮАР'] as const;
const APPROVED_WHALE_NAME = 'Кит синий северный';

type ImportStatus = 'RUNNING' | 'FAILED' | 'COMPLETE';

interface ReleaseFile {
  path: string;
  sha256: string;
  bytes: number;
  lines: number;
  fishingBaseId: string;
  fishingBaseName: string;
}

interface ReleaseManifest {
  schemaVersion: 1;
  releaseKind: 'KLEVALKA_CATCH_TXT';
  catalogSha256: string;
  output: { lines: number; files: number; bytes: number };
  files: ReleaseFile[];
  releaseSha256: string;
}

interface VerifiedRelease {
  root: string;
  manifestSha256: string;
  manifest: ReleaseManifest;
}

interface Checkpoint {
  id: string;
  releaseSha256: string;
  manifestSha256: string;
  targetUserId: string;
  catalogSha256: string;
  nextFileIndex: number;
  nextLineNumber: number;
  committedReports: number;
  status: ImportStatus;
}

export interface KlevalkaCatchImportOptions {
  releasePath: string;
  targetUserId: string;
  expectedReleaseSha256?: string;
  expectedLines?: number;
  batchSize?: number;
  /** Used by focused tests and controlled rehearsals; the production CLI runs to completion. */
  maxBatches?: number;
}

export interface KlevalkaCatchImportSummary {
  releaseSha256: string;
  targetUserId: string;
  status: ImportStatus;
  insertedThisRun: number;
  committedReports: number;
  nextFileIndex: number;
  nextLineNumber: number;
}

export class KlevalkaCatchImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly file?: string,
    readonly lineNumber?: number,
  ) {
    super(message);
    this.name = 'KlevalkaCatchImportError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', `${field} must be a non-empty string`);
  }
  return value;
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new KlevalkaCatchImportError(
      'RELEASE_INVALID',
      `${field} must be a non-negative integer`,
    );
  }
  return Number(value);
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!isRecord(value) || !isRecord(value.output) || !Array.isArray(value.files)) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', 'Release manifest has an invalid shape');
  }
  if (value.schemaVersion !== 1 || value.releaseKind !== 'KLEVALKA_CATCH_TXT') {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', 'Unsupported release manifest');
  }
  const files = value.files.map((entry, index): ReleaseFile => {
    if (!isRecord(entry)) {
      throw new KlevalkaCatchImportError('RELEASE_INVALID', `files[${index}] is invalid`);
    }
    const file: ReleaseFile = {
      path: requireString(entry.path, `files[${index}].path`),
      sha256: requireString(entry.sha256, `files[${index}].sha256`),
      bytes: requireInteger(entry.bytes, `files[${index}].bytes`),
      lines: requireInteger(entry.lines, `files[${index}].lines`),
      fishingBaseId: requireString(entry.fishingBaseId, `files[${index}].fishingBaseId`),
      fishingBaseName: requireString(entry.fishingBaseName, `files[${index}].fishingBaseName`),
    };
    if (!SHA256_PATTERN.test(file.sha256) || file.lines < 1 || file.bytes < 1) {
      throw new KlevalkaCatchImportError('RELEASE_INVALID', `files[${index}] has invalid metadata`);
    }
    return file;
  });
  const releaseSha256 = requireString(value.releaseSha256, 'releaseSha256');
  const catalogHash = requireString(value.catalogSha256, 'catalogSha256');
  if (!SHA256_PATTERN.test(releaseSha256) || !SHA256_PATTERN.test(catalogHash)) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', 'Release hashes must be SHA-256 values');
  }
  return {
    schemaVersion: 1,
    releaseKind: 'KLEVALKA_CATCH_TXT',
    catalogSha256: catalogHash,
    output: {
      lines: requireInteger(value.output.lines, 'output.lines'),
      files: requireInteger(value.output.files, 'output.files'),
      bytes: requireInteger(value.output.bytes, 'output.bytes'),
    },
    files,
    releaseSha256,
  };
}

function assertContainedPath(root: string, candidate: string, label: string): void {
  const fromRoot = relative(root, candidate);
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', `${label} escapes the release directory`);
  }
}

async function readVerifiedFile(root: string, entry: ReleaseFile): Promise<string[]> {
  if (entry.path.startsWith('/') || entry.path.includes('\\')) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', `Invalid release path: ${entry.path}`);
  }
  const requestedPath = resolve(root, entry.path);
  assertContainedPath(root, requestedPath, entry.path);
  const filePath = await realpath(requestedPath);
  assertContainedPath(root, filePath, entry.path);
  const bytes = await readFile(filePath);
  if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) {
    throw new KlevalkaCatchImportError('RELEASE_CHANGED', `Release file changed: ${entry.path}`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!bytes.equals(Buffer.from(text, 'utf8')) || !text.endsWith('\n') || text.includes('\r')) {
    throw new KlevalkaCatchImportError(
      'RELEASE_INVALID',
      `Release file must be canonical UTF-8 with LF delimiters: ${entry.path}`,
    );
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== entry.lines || lines.some((line) => line.length === 0)) {
    throw new KlevalkaCatchImportError('RELEASE_CHANGED', `Line count changed: ${entry.path}`);
  }
  return lines;
}

export async function verifyKlevalkaCatchRelease(
  releasePath: string,
  expectedReleaseSha256 = APPROVED_KLEVALKA_V3_RELEASE_SHA256,
  expectedLines = APPROVED_KLEVALKA_V3_LINES,
): Promise<VerifiedRelease> {
  if (!isAbsolute(releasePath)) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', '--release must be an absolute path');
  }
  const root = await realpath(releasePath);
  if (!(await stat(root)).isDirectory()) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', '--release must be a directory');
  }
  const manifestBytes = await readFile(resolve(root, 'manifest.json'));
  const manifestText = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  const parsed = JSON.parse(manifestText) as unknown;
  const manifest = parseReleaseManifest(parsed);
  if (!isRecord(parsed)) throw new KlevalkaCatchImportError('RELEASE_INVALID', 'Invalid manifest');
  const descriptor = { ...parsed };
  delete descriptor.releaseSha256;
  if (sha256(stableJson(descriptor)) !== manifest.releaseSha256) {
    throw new KlevalkaCatchImportError('RELEASE_CHANGED', 'Release descriptor checksum mismatch');
  }
  if (manifest.releaseSha256 !== expectedReleaseSha256 || manifest.output.lines !== expectedLines) {
    throw new KlevalkaCatchImportError(
      'RELEASE_NOT_APPROVED',
      'Release identity or line count is not approved',
    );
  }
  if (manifest.output.files !== manifest.files.length) {
    throw new KlevalkaCatchImportError('RELEASE_INVALID', 'Manifest file count is inconsistent');
  }
  const paths = new Set<string>();
  let lines = 0;
  let bytes = 0;
  for (const entry of manifest.files) {
    if (paths.has(entry.path)) {
      throw new KlevalkaCatchImportError(
        'RELEASE_INVALID',
        `Duplicate release path: ${entry.path}`,
      );
    }
    paths.add(entry.path);
    await readVerifiedFile(root, entry);
    lines += entry.lines;
    bytes += entry.bytes;
  }
  if (lines !== manifest.output.lines || bytes !== manifest.output.bytes) {
    throw new KlevalkaCatchImportError(
      'RELEASE_CHANGED',
      'Release totals do not match the manifest',
    );
  }
  return { root, manifestSha256: sha256(manifestBytes), manifest };
}

function resolvedRequired<T>(field: DraftField<T>, name: string): T {
  if (field.status !== 'RESOLVED' || field.value === null) {
    throw new KlevalkaCatchImportError('PARSE_FAILED', `${name} is unresolved`);
  }
  return field.value;
}

function resolvedOptional<T>(field: DraftField<T>, name: string): T | null {
  if (field.status !== 'RESOLVED') {
    throw new KlevalkaCatchImportError('PARSE_FAILED', `${name} is unresolved`);
  }
  return field.value;
}

async function draftDto(
  draft: CatchReportDraft,
  rawSourceText: string,
): Promise<CreateCatchReportDto> {
  if (draft.rawSourceText !== rawSourceText || !draft.canConfirm) {
    throw new KlevalkaCatchImportError(
      'PARSE_FAILED',
      'Parser did not produce a confirmable exact-source draft',
    );
  }
  const unexpectedIssues = draft.issues.filter((issue) => issue.code !== 'DUPLICATE_INPUT_ROW');
  if (unexpectedIssues.length > 0) {
    throw new KlevalkaCatchImportError(
      'PARSE_FAILED',
      `Parser issue(s): ${unexpectedIssues.map((issue) => issue.code).join(', ')}`,
    );
  }
  const location = resolvedRequired(draft.fields.location, 'location');
  const fish = resolvedRequired(draft.fields.fish, 'fish');
  const bait = resolvedRequired(draft.fields.bait, 'bait');
  return (await DTO_PIPE.transform(
    {
      locationId: location.id,
      fishId: fish.id,
      baitId: bait.id,
      weightGrams: resolvedRequired(draft.fields.weightGrams, 'weightGrams'),
      holeDepthCm: resolvedOptional(draft.fields.holeDepthCm, 'holeDepthCm'),
      spotPositionRaw: resolvedOptional(draft.fields.spotPositionRaw, 'spotPositionRaw'),
      fishingNote: resolvedOptional(draft.fields.fishingNote, 'fishingNote'),
      spinningSize: resolvedOptional(draft.fields.spinningSize, 'spinningSize'),
      spinningSpeed: resolvedOptional(draft.fields.spinningSpeed, 'spinningSpeed'),
      userNoteRaw: resolvedOptional(draft.fields.userNoteRaw, 'userNoteRaw'),
      rawSourceText,
    },
    DTO_METADATA,
  )) as CreateCatchReportDto;
}

async function parseBatch(
  prisma: PrismaClient,
  lines: readonly string[],
  entry: ReleaseFile,
  firstLineNumber: number,
): Promise<CreateCatchReportDto[]> {
  const result = await new CatchReportParserService(prisma as never).parseBatch(lines.join('\n'));
  if (result.rows.length !== lines.length) {
    throw new KlevalkaCatchImportError(
      'PARSE_FAILED',
      'Parser row count mismatch',
      entry.path,
      firstLineNumber,
    );
  }
  return Promise.all(
    result.rows.map(async (row, index) => {
      const lineNumber = firstLineNumber + index;
      const rawSourceText = lines[index];
      if (rawSourceText === undefined) {
        throw new KlevalkaCatchImportError(
          'PARSE_FAILED',
          'Source line is missing',
          entry.path,
          lineNumber,
        );
      }
      try {
        const parsedBase = resolvedRequired(row.draft.fields.fishingBase, 'fishingBase');
        if (parsedBase.id !== entry.fishingBaseId || parsedBase.name !== entry.fishingBaseName) {
          throw new KlevalkaCatchImportError(
            'PARSE_FAILED',
            'Parsed Base differs from file manifest',
          );
        }
        return await draftDto(row.draft, rawSourceText);
      } catch (error: unknown) {
        if (error instanceof KlevalkaCatchImportError) {
          throw new KlevalkaCatchImportError(error.code, error.message, entry.path, lineNumber);
        }
        throw new KlevalkaCatchImportError(
          'VALIDATION_FAILED',
          error instanceof Error ? error.message : 'Draft validation failed',
          entry.path,
          lineNumber,
        );
      }
    }),
  );
}

async function assertTargetUser(
  database: Prisma.TransactionClient,
  targetUserId: string,
): Promise<void> {
  const user = await database.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, isBanned: true, emailVerifiedAt: true },
  });
  if (user === null || user.role !== 'USER' || user.isBanned || user.emailVerifiedAt === null) {
    throw new KlevalkaCatchImportError(
      'TARGET_USER_INVALID',
      'Target must be an existing, verified, non-banned USER',
    );
  }
}

function uniqueActiveNamed<T extends { id: string }>(values: readonly T[], label: string): T {
  if (values.length !== 1 || values[0] === undefined) {
    throw new KlevalkaCatchImportError(
      'CATALOG_INVALID',
      `Expected one active catalog item: ${label}`,
    );
  }
  return values[0];
}

export async function ensureApprovedWhaleMemberships(
  database: Prisma.TransactionClient,
): Promise<void> {
  const fish = uniqueActiveNamed(
    await database.fish.findMany({
      where: { name: APPROVED_WHALE_NAME, isActive: true },
      select: { id: true },
    }),
    APPROVED_WHALE_NAME,
  );
  const bases = await database.fishingBase.findMany({
    where: { name: { in: [...APPROVED_WHALE_BASES] }, isActive: true },
    select: { id: true, name: true },
  });
  const byName = new Map(bases.map((base) => [base.name, base]));
  const rows = APPROVED_WHALE_BASES.map((name) => {
    const base = byName.get(name);
    if (base === undefined) {
      throw new KlevalkaCatchImportError('CATALOG_INVALID', `Missing active FishingBase: ${name}`);
    }
    return { fishingBaseId: base.id, fishId: fish.id };
  });
  await database.fishingBaseFish.createMany({ data: rows, skipDuplicates: true });
}

async function currentCatalogHash(
  database: Prisma.TransactionClient | PrismaClient,
): Promise<string> {
  return catalogSha256(await loadCurrentKlevalkaCatalog(database));
}

function catalogHashWithoutApprovedWhaleMemberships(catalog: KlevalkaCatalogSnapshot): string {
  const fish = uniqueActiveNamed(
    catalog.fish.filter((item) => item.name === APPROVED_WHALE_NAME),
    APPROVED_WHALE_NAME,
  );
  const baseIds = new Set(
    APPROVED_WHALE_BASES.map(
      (name) =>
        uniqueActiveNamed(
          catalog.fishingBases.filter((item) => item.name === name),
          name,
        ).id,
    ),
  );
  return catalogSha256({
    ...catalog,
    memberships: catalog.memberships.filter(
      (membership) => membership.fishId !== fish.id || !baseIds.has(membership.fishingBaseId),
    ),
  });
}

async function initializeCheckpoint(
  prisma: PrismaClient,
  release: VerifiedRelease,
  targetUserId: string,
): Promise<Checkpoint> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(${IMPORT_INITIALIZATION_LOCK}) IS NULL AS "locked"
      `;
      const existing = await tx.catchImportRun.findUnique({
        where: { releaseSha256: release.manifest.releaseSha256 },
      });
      if (existing !== null) {
        if (
          existing.manifestSha256 !== release.manifestSha256 ||
          existing.targetUserId !== targetUserId
        ) {
          throw new KlevalkaCatchImportError(
            'CHECKPOINT_CONFLICT',
            'Existing checkpoint belongs to different release bytes or target user',
          );
        }
        await assertTargetUser(tx, targetUserId);
        if ((await currentCatalogHash(tx)) !== existing.catalogSha256) {
          throw new KlevalkaCatchImportError(
            'CATALOG_CHANGED',
            'Catalog changed after import initialization',
          );
        }
        return existing as Checkpoint;
      }

      await assertTargetUser(tx, targetUserId);
      const initialCatalog = await loadCurrentKlevalkaCatalog(tx);
      if (
        catalogSha256(initialCatalog) !== release.manifest.catalogSha256 &&
        catalogHashWithoutApprovedWhaleMemberships(initialCatalog) !==
          release.manifest.catalogSha256
      ) {
        throw new KlevalkaCatchImportError(
          'CATALOG_CHANGED',
          'Current catalog differs from the approved release beyond the approved memberships',
        );
      }
      await ensureApprovedWhaleMemberships(tx);
      const catalogHash = await currentCatalogHash(tx);
      return (await tx.catchImportRun.create({
        data: {
          releaseSha256: release.manifest.releaseSha256,
          manifestSha256: release.manifestSha256,
          targetUserId,
          catalogSha256: catalogHash,
          status: 'RUNNING',
        },
      })) as Checkpoint;
    },
    { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: TRANSACTION_TIMEOUT_MS },
  );
}

async function lockedCheckpoint(tx: Prisma.TransactionClient, id: string): Promise<Checkpoint> {
  const [row] = await tx.$queryRaw<Checkpoint[]>`
    SELECT
      "id", "releaseSha256", "manifestSha256", "targetUserId", "catalogSha256",
      "nextFileIndex", "nextLineNumber", "committedReports", "status"
    FROM "CatchImportRun"
    WHERE "id" = ${id}::uuid
    FOR UPDATE
  `;
  if (row === undefined) {
    throw new KlevalkaCatchImportError('CHECKPOINT_MISSING', 'Catch import checkpoint is missing');
  }
  return row;
}

function failureCode(error: unknown): string {
  if (error instanceof KlevalkaCatchImportError) return error.code;
  if (isPrismaError(error, 'P2034')) return 'TRANSACTION_CONFLICT';
  return 'IMPORT_FAILED';
}

async function recordFailure(
  prisma: PrismaClient,
  checkpoint: Checkpoint,
  entry: ReleaseFile,
  error: unknown,
): Promise<void> {
  const sourceError = error instanceof KlevalkaCatchImportError ? error : undefined;
  await prisma.catchImportRun.updateMany({
    where: {
      id: checkpoint.id,
      nextFileIndex: checkpoint.nextFileIndex,
      nextLineNumber: checkpoint.nextLineNumber,
    },
    data: {
      status: 'FAILED',
      lastErrorCode: failureCode(error),
      lastErrorFile: sourceError?.file ?? entry.path,
      lastErrorLineNumber: sourceError?.lineNumber ?? checkpoint.nextLineNumber,
      lastErrorMessage: error instanceof Error ? error.message : 'Unknown import failure',
    },
  });
}

async function persistBatch(
  prisma: PrismaClient,
  checkpoint: Checkpoint,
  release: VerifiedRelease,
  entry: ReleaseFile,
  dtos: readonly CreateCatchReportDto[],
): Promise<Checkpoint | null> {
  let lastConflict: unknown;
  for (let attempt = 1; attempt <= TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const current = await lockedCheckpoint(tx, checkpoint.id);
          if (
            current.nextFileIndex !== checkpoint.nextFileIndex ||
            current.nextLineNumber !== checkpoint.nextLineNumber
          ) {
            return null;
          }
          await assertTargetUser(tx, checkpoint.targetUserId);
          const results = await prepareCatchReportCreates(tx, dtos);
          const prepared = results.map((result, index) => {
            if ('error' in result) {
              const error = result.error;
              throw new KlevalkaCatchImportError(
                'DOMAIN_VALIDATION_FAILED',
                error instanceof Error ? error.message : 'CatchReport domain validation failed',
                entry.path,
                checkpoint.nextLineNumber + index,
              );
            }
            if (result.prepared.data.rawSourceText !== dtos[index]?.rawSourceText) {
              throw new KlevalkaCatchImportError(
                'RAW_SOURCE_CHANGED',
                'Domain preparation changed rawSourceText',
                entry.path,
                checkpoint.nextLineNumber + index,
              );
            }
            return result.prepared;
          });
          const contributorKey = nativeContributorKey(checkpoint.targetUserId);
          for (let offset = 0; offset < prepared.length; offset += INSERT_CHUNK_SIZE) {
            const chunk = prepared.slice(offset, offset + INSERT_CHUNK_SIZE);
            const inserted = await tx.catchReport.createMany({
              data: chunk.map((item) => ({
                id: randomUUID(),
                userId: checkpoint.targetUserId,
                contributorKey,
                importKey: null,
                ...item.data,
              })),
            });
            if (inserted.count !== chunk.length) {
              throw new KlevalkaCatchImportError(
                'INSERT_COUNT_MISMATCH',
                'CatchReport insert count mismatch',
              );
            }
          }

          const afterLine = checkpoint.nextLineNumber + dtos.length;
          const fileComplete = afterLine > entry.lines;
          const nextFileIndex = fileComplete
            ? checkpoint.nextFileIndex + 1
            : checkpoint.nextFileIndex;
          const nextLineNumber = fileComplete ? 1 : afterLine;
          const complete = nextFileIndex === release.manifest.files.length;
          return (await tx.catchImportRun.update({
            where: { id: checkpoint.id },
            data: {
              nextFileIndex,
              nextLineNumber,
              committedReports: { increment: dtos.length },
              status: complete ? 'COMPLETE' : 'RUNNING',
              completedAt: complete ? new Date() : null,
              lastErrorCode: null,
              lastErrorFile: null,
              lastErrorLineNumber: null,
              lastErrorMessage: null,
            },
          })) as Checkpoint;
        },
        { isolationLevel: 'Serializable', maxWait: 10_000, timeout: TRANSACTION_TIMEOUT_MS },
      );
    } catch (error: unknown) {
      if (!isPrismaError(error, 'P2034') || attempt === TRANSACTION_ATTEMPTS) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}

export async function importKlevalkaCatchRelease(
  prisma: PrismaClient,
  options: KlevalkaCatchImportOptions,
): Promise<KlevalkaCatchImportSummary> {
  if (!UUID_V4_PATTERN.test(options.targetUserId)) {
    throw new KlevalkaCatchImportError('TARGET_USER_INVALID', '--user-id must be a UUIDv4');
  }
  const batchSize = options.batchSize ?? IMPORT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > IMPORT_BATCH_SIZE) {
    throw new KlevalkaCatchImportError('OPTION_INVALID', 'batchSize must be between 1 and 1000');
  }
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  if (
    maxBatches !== Number.POSITIVE_INFINITY &&
    (!Number.isSafeInteger(maxBatches) || maxBatches < 1)
  ) {
    throw new KlevalkaCatchImportError('OPTION_INVALID', 'maxBatches must be a positive integer');
  }
  const release = await verifyKlevalkaCatchRelease(
    options.releasePath,
    options.expectedReleaseSha256,
    options.expectedLines,
  );
  let checkpoint = await initializeCheckpoint(prisma, release, options.targetUserId);
  let insertedThisRun = 0;
  let completedBatches = 0;

  while (checkpoint.status !== 'COMPLETE' && completedBatches < maxBatches) {
    const entry = release.manifest.files[checkpoint.nextFileIndex];
    if (entry === undefined) {
      throw new KlevalkaCatchImportError(
        'CHECKPOINT_INVALID',
        'Checkpoint points beyond release files',
      );
    }
    try {
      if ((await currentCatalogHash(prisma)) !== checkpoint.catalogSha256) {
        throw new KlevalkaCatchImportError('CATALOG_CHANGED', 'Catalog changed during import');
      }
      const lines = await readVerifiedFile(release.root, entry);
      const start = checkpoint.nextLineNumber - 1;
      const batchLines = lines.slice(start, start + batchSize);
      if (batchLines.length === 0) {
        throw new KlevalkaCatchImportError(
          'CHECKPOINT_INVALID',
          'Checkpoint line is beyond the source file',
          entry.path,
          checkpoint.nextLineNumber,
        );
      }
      const dtos = await parseBatch(prisma, batchLines, entry, checkpoint.nextLineNumber);
      const advanced = await persistBatch(prisma, checkpoint, release, entry, dtos);
      if (advanced !== null) insertedThisRun += dtos.length;
      checkpoint =
        advanced ??
        ((await prisma.catchImportRun.findUniqueOrThrow({
          where: { id: checkpoint.id },
        })) as Checkpoint);
      completedBatches += 1;
    } catch (error: unknown) {
      const current = (await prisma.catchImportRun.findUnique({
        where: { id: checkpoint.id },
      })) as Checkpoint | null;
      if (
        current !== null &&
        (current.nextFileIndex !== checkpoint.nextFileIndex ||
          current.nextLineNumber !== checkpoint.nextLineNumber)
      ) {
        checkpoint = current;
        continue;
      }
      await recordFailure(prisma, checkpoint, entry, error);
      throw error;
    }
  }

  if (
    checkpoint.status === 'COMPLETE' &&
    checkpoint.committedReports !== release.manifest.output.lines
  ) {
    throw new KlevalkaCatchImportError(
      'FINAL_COUNT_MISMATCH',
      'Completed checkpoint count is incorrect',
    );
  }
  return {
    releaseSha256: checkpoint.releaseSha256,
    targetUserId: checkpoint.targetUserId,
    status: checkpoint.status,
    insertedThisRun,
    committedReports: checkpoint.committedReports,
    nextFileIndex: checkpoint.nextFileIndex,
    nextLineNumber: checkpoint.nextLineNumber,
  };
}
