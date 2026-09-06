import { Inject, Injectable } from '@nestjs/common';
import { catalogErrors } from '../catalog/catalog-errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  buildCatchReportPage,
  decodeCatchReportCursor,
  InvalidCatchReportCursorError,
} from './catch-report-pagination.js';
import {
  PUBLIC_CATCH_REPORT_SELECT,
  resolveBaseFishWeightBounds,
  toPublicCatchReport,
} from './catch-reports.service.js';
import { catchReportErrors } from './catch-reports.errors.js';
import type {
  SpotEvidenceQueryDto,
  SpotStatisticsQueryDto,
} from './dto/spot-statistics-query.dto.js';
import {
  decodeSpotGroupKey,
  encodeSpotGroupKey,
  InvalidSpotGroupKeyError,
  type SpotGroupIdentity,
} from './spot-group-key.js';

interface ResolvedFishScope {
  kind: 'fish';
  fishId: string;
  baseIds: string[] | undefined;
}

interface ResolvedLocationScope {
  kind: 'location';
  locationId: string;
  fishIds: string[] | undefined;
}

type ResolvedSpotScope = ResolvedFishScope | ResolvedLocationScope;

interface SpotMetadataDatabaseRow {
  scopedReportsCount: bigint;
  unlocatedReportsCount: bigint;
  totalGroups: bigint;
}

interface SpotGroupDatabaseRow extends SpotGroupIdentity {
  fishingBaseId: string;
  fishingBaseName: string;
  fishingBaseIsActive: boolean;
  locationNumber: number;
  locationName: string;
  locationIsActive: boolean;
  spotPosition: string | null;
  contributorCount: bigint;
  reportsCount: bigint;
  fishCount: bigint;
  latestReportCreatedAt: Date;
}

interface TopBaitDatabaseRow extends SpotGroupIdentity {
  baitId: string;
  baitName: string;
  baitIsActive: boolean;
  contributorCount: bigint;
  reportsCount: bigint;
}

interface EvidenceIdDatabaseRow {
  id: string;
  createdAt: Date;
}

type SpotTransaction = Prisma.TransactionClient;

function toSafeCount(value: bigint, field: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds the JavaScript safe integer range`);
  }
  return Number(value);
}

function spotIdentityKey(identity: SpotGroupIdentity): string {
  return JSON.stringify([identity.locationId, identity.holeDepthCm, identity.normalizedSpotKey]);
}

function normalizedSpotExpression(): Prisma.Sql {
  return Prisma.sql`(
    NULLIF(
      lower(
        btrim(
          regexp_replace(
            normalize(report."spotPositionRaw", NFKC),
            '[[:space:]]+',
            ' ',
            'g'
          )
        )
      ),
      ''
    ) COLLATE "C"
  )`;
}

function scopePredicate(scope: ResolvedSpotScope): Prisma.Sql {
  if (scope.kind === 'location') {
    const fishFilter =
      scope.fishIds === undefined
        ? Prisma.empty
        : Prisma.sql`AND report."fishId" IN (${Prisma.join(
            scope.fishIds.map((fishId) => Prisma.sql`${fishId}::uuid`),
          )})`;
    return Prisma.sql`report."locationId" = ${scope.locationId}::uuid ${fishFilter}`;
  }

  const baseFilter =
    scope.baseIds === undefined
      ? Prisma.empty
      : scope.baseIds.length === 0
        ? Prisma.sql`AND FALSE`
        : Prisma.sql`AND source_location."fishingBaseId" IN (${Prisma.join(
            scope.baseIds.map((baseId) => Prisma.sql`${baseId}::uuid`),
          )})`;
  return Prisma.sql`report."fishId" = ${scope.fishId}::uuid ${baseFilter}`;
}

function candidateReports(scope: ResolvedSpotScope): Prisma.Sql {
  return Prisma.sql`
    SELECT
      report."id",
      report."locationId",
      report."fishId",
      report."baitId",
      report."holeDepthCm",
      report."spotPositionRaw",
      report."contributorKey",
      report."createdAt",
      ${normalizedSpotExpression()} AS "normalizedSpotKey"
    FROM "CatchReport" AS report
    INNER JOIN "Location" AS source_location ON source_location."id" = report."locationId"
    WHERE ${scopePredicate(scope)}
  `;
}

export function buildSpotMetadataQuery(scope: ResolvedSpotScope): Prisma.Sql {
  return Prisma.sql`
    WITH "candidateReports" AS (${candidateReports(scope)}),
    "locatedGroups" AS (
      SELECT candidate."locationId", candidate."holeDepthCm", candidate."normalizedSpotKey"
      FROM "candidateReports" AS candidate
      WHERE candidate."holeDepthCm" IS NOT NULL OR candidate."normalizedSpotKey" IS NOT NULL
      GROUP BY candidate."locationId", candidate."holeDepthCm", candidate."normalizedSpotKey"
    )
    SELECT
      (SELECT COUNT(*) FROM "candidateReports") AS "scopedReportsCount",
      (SELECT COUNT(*) FROM "candidateReports"
        WHERE "holeDepthCm" IS NULL AND "normalizedSpotKey" IS NULL
      ) AS "unlocatedReportsCount",
      (SELECT COUNT(*) FROM "locatedGroups") AS "totalGroups"
  `;
}

export function buildSpotPageQuery(
  scope: ResolvedSpotScope,
  limit: number,
  offset: number,
): Prisma.Sql {
  return Prisma.sql`
    WITH "candidateReports" AS (${candidateReports(scope)}),
    "spotGroups" AS (
      SELECT
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        COUNT(DISTINCT candidate."contributorKey") AS "contributorCount",
        COUNT(*) AS "reportsCount",
        COUNT(DISTINCT candidate."fishId") AS "fishCount",
        MAX(candidate."createdAt") AS "latestReportCreatedAt"
      FROM "candidateReports" AS candidate
      WHERE candidate."holeDepthCm" IS NOT NULL OR candidate."normalizedSpotKey" IS NOT NULL
      GROUP BY candidate."locationId", candidate."holeDepthCm", candidate."normalizedSpotKey"
    ),
    "rawVariants" AS (
      SELECT
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        candidate."spotPositionRaw" COLLATE "C" AS "spotPositionRaw",
        COUNT(DISTINCT candidate."contributorKey") AS "variantContributorCount",
        COUNT(*) AS "variantReportsCount",
        MAX(candidate."createdAt") AS "variantLatestReportCreatedAt"
      FROM "candidateReports" AS candidate
      WHERE candidate."normalizedSpotKey" IS NOT NULL
      GROUP BY
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        candidate."spotPositionRaw" COLLATE "C"
    ),
    "rankedVariants" AS (
      SELECT
        variant.*,
        ROW_NUMBER() OVER (
          PARTITION BY variant."locationId", variant."holeDepthCm", variant."normalizedSpotKey"
          ORDER BY
            variant."variantContributorCount" DESC,
            variant."variantReportsCount" DESC,
            variant."variantLatestReportCreatedAt" DESC,
            variant."spotPositionRaw" COLLATE "C" ASC
        ) AS "variantRank"
      FROM "rawVariants" AS variant
    )
    SELECT
      fishing_base."id" AS "fishingBaseId",
      fishing_base."name" AS "fishingBaseName",
      fishing_base."isActive" AS "fishingBaseIsActive",
      location."id" AS "locationId",
      location."number" AS "locationNumber",
      location."name" AS "locationName",
      location."isActive" AS "locationIsActive",
      spot_group."holeDepthCm" AS "holeDepthCm",
      spot_group."normalizedSpotKey" AS "normalizedSpotKey",
      representative."spotPositionRaw" AS "spotPosition",
      spot_group."contributorCount" AS "contributorCount",
      spot_group."reportsCount" AS "reportsCount",
      spot_group."fishCount" AS "fishCount",
      spot_group."latestReportCreatedAt" AS "latestReportCreatedAt"
    FROM "spotGroups" AS spot_group
    INNER JOIN "Location" AS location ON location."id" = spot_group."locationId"
    INNER JOIN "FishingBase" AS fishing_base ON fishing_base."id" = location."fishingBaseId"
    LEFT JOIN "rankedVariants" AS representative
      ON representative."locationId" = spot_group."locationId"
      AND representative."holeDepthCm" IS NOT DISTINCT FROM spot_group."holeDepthCm"
      AND representative."normalizedSpotKey" IS NOT DISTINCT FROM spot_group."normalizedSpotKey"
      AND representative."variantRank" = 1
    ORDER BY
      spot_group."contributorCount" DESC,
      spot_group."reportsCount" DESC,
      spot_group."latestReportCreatedAt" DESC,
      spot_group."locationId" ASC,
      spot_group."holeDepthCm" ASC NULLS FIRST,
      spot_group."normalizedSpotKey" COLLATE "C" ASC NULLS FIRST
    LIMIT ${limit} OFFSET ${offset}
  `;
}

export function buildSpotTopBaitsQuery(
  scope: ResolvedSpotScope,
  identities: readonly SpotGroupIdentity[],
): Prisma.Sql {
  const identityPredicates = identities.map(
    (identity) => Prisma.sql`(
      candidate."locationId" = ${identity.locationId}::uuid
      AND candidate."holeDepthCm" IS NOT DISTINCT FROM ${identity.holeDepthCm}
      AND candidate."normalizedSpotKey" IS NOT DISTINCT FROM ${identity.normalizedSpotKey}
    )`,
  );

  return Prisma.sql`
    WITH "candidateReports" AS (${candidateReports(scope)}),
    "baitGroups" AS (
      SELECT
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        bait."id" AS "baitId",
        bait."name" AS "baitName",
        bait."isActive" AS "baitIsActive",
        COUNT(DISTINCT candidate."contributorKey") AS "contributorCount",
        COUNT(*) AS "reportsCount"
      FROM "candidateReports" AS candidate
      INNER JOIN "Bait" AS bait ON bait."id" = candidate."baitId"
      WHERE ${Prisma.join(identityPredicates, ' OR ')}
      GROUP BY
        candidate."locationId",
        candidate."holeDepthCm",
        candidate."normalizedSpotKey",
        bait."id",
        bait."name",
        bait."isActive"
    ),
    "rankedBaits" AS (
      SELECT
        bait_group.*,
        ROW_NUMBER() OVER (
          PARTITION BY
            bait_group."locationId",
            bait_group."holeDepthCm",
            bait_group."normalizedSpotKey"
          ORDER BY
            bait_group."contributorCount" DESC,
            bait_group."reportsCount" DESC,
            bait_group."baitId" ASC
        ) AS "baitRank"
      FROM "baitGroups" AS bait_group
    )
    SELECT
      "locationId",
      "holeDepthCm",
      "normalizedSpotKey",
      "baitId",
      "baitName",
      "baitIsActive",
      "contributorCount",
      "reportsCount"
    FROM "rankedBaits"
    WHERE "baitRank" <= 3
    ORDER BY "locationId", "holeDepthCm" NULLS FIRST, "normalizedSpotKey" COLLATE "C" NULLS FIRST, "baitRank"
  `;
}

function buildSpotEvidenceIdsQuery(
  scope: ResolvedSpotScope,
  identity: SpotGroupIdentity,
  cursor: { createdAt: Date; id: string } | undefined,
  take: number,
): Prisma.Sql {
  const cursorPredicate =
    cursor === undefined
      ? Prisma.empty
      : Prisma.sql`AND (
          report."createdAt" < ${cursor.createdAt}
          OR (report."createdAt" = ${cursor.createdAt} AND report."id" < ${cursor.id}::uuid)
        )`;

  return Prisma.sql`
    SELECT report."id", report."createdAt"
    FROM "CatchReport" AS report
    INNER JOIN "Location" AS source_location ON source_location."id" = report."locationId"
    WHERE ${scopePredicate(scope)}
      AND report."locationId" = ${identity.locationId}::uuid
      AND report."holeDepthCm" IS NOT DISTINCT FROM ${identity.holeDepthCm}
      AND ${normalizedSpotExpression()} IS NOT DISTINCT FROM ${identity.normalizedSpotKey}
      ${cursorPredicate}
    ORDER BY report."createdAt" DESC, report."id" DESC
    LIMIT ${take}
  `;
}

@Injectable()
export class SpotAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: SpotStatisticsQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.resolveScope(tx, query);
        const [metadata] = await tx.$queryRaw<SpotMetadataDatabaseRow[]>(
          buildSpotMetadataQuery(scope),
        );
        const rows = await tx.$queryRaw<SpotGroupDatabaseRow[]>(
          buildSpotPageQuery(scope, query.limit, query.offset),
        );
        const identities = rows.map(({ locationId, holeDepthCm, normalizedSpotKey }) => ({
          locationId,
          holeDepthCm,
          normalizedSpotKey,
        }));
        const baitRows =
          identities.length === 0
            ? []
            : await tx.$queryRaw<TopBaitDatabaseRow[]>(buildSpotTopBaitsQuery(scope, identities));
        const baitsByIdentity = new Map<string, TopBaitDatabaseRow[]>();
        for (const bait of baitRows) {
          const key = spotIdentityKey(bait);
          const existing = baitsByIdentity.get(key);
          if (existing === undefined) baitsByIdentity.set(key, [bait]);
          else existing.push(bait);
        }

        return {
          items: rows.map((row) => {
            const identity: SpotGroupIdentity = {
              locationId: row.locationId,
              holeDepthCm: row.holeDepthCm,
              normalizedSpotKey: row.normalizedSpotKey,
            };
            return {
              groupKey: encodeSpotGroupKey(identity),
              fishingBase: {
                id: row.fishingBaseId,
                name: row.fishingBaseName,
                isActive: row.fishingBaseIsActive,
              },
              location: {
                id: row.locationId,
                number: row.locationNumber,
                name: row.locationName,
                isActive: row.locationIsActive,
              },
              holeDepthCm: row.holeDepthCm,
              spotPosition: row.spotPosition,
              contributorCount: toSafeCount(row.contributorCount, 'contributorCount'),
              reportsCount: toSafeCount(row.reportsCount, 'reportsCount'),
              fishCount: toSafeCount(row.fishCount, 'fishCount'),
              topBaits: (baitsByIdentity.get(spotIdentityKey(identity)) ?? []).map((bait) => ({
                bait: { id: bait.baitId, name: bait.baitName, isActive: bait.baitIsActive },
                contributorCount: toSafeCount(bait.contributorCount, 'baitContributorCount'),
                reportsCount: toSafeCount(bait.reportsCount, 'baitReportsCount'),
              })),
              latestReportCreatedAt: row.latestReportCreatedAt,
            };
          }),
          totalGroups: toSafeCount(metadata?.totalGroups ?? 0n, 'totalGroups'),
          scopedReportsCount: toSafeCount(metadata?.scopedReportsCount ?? 0n, 'scopedReportsCount'),
          unlocatedReportsCount: toSafeCount(
            metadata?.unlocatedReportsCount ?? 0n,
            'unlocatedReportsCount',
          ),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listEvidence(query: SpotEvidenceQueryDto) {
    let identity: SpotGroupIdentity;
    try {
      identity = decodeSpotGroupKey(query.groupKey);
    } catch (error: unknown) {
      if (error instanceof InvalidSpotGroupKeyError) throw catchReportErrors.invalidSpotGroupKey();
      throw error;
    }

    let cursor: { createdAt: Date; id: string } | undefined;
    try {
      cursor = query.cursor === undefined ? undefined : decodeCatchReportCursor(query.cursor);
    } catch (error: unknown) {
      if (error instanceof InvalidCatchReportCursorError) throw catchReportErrors.invalidCursor();
      throw error;
    }

    return this.prisma.$transaction(
      async (tx) => {
        const scope = await this.resolveScope(tx, query);
        const idRows = await tx.$queryRaw<EvidenceIdDatabaseRow[]>(
          buildSpotEvidenceIdsQuery(scope, identity, cursor, query.limit + 1),
        );
        const page = buildCatchReportPage(idRows, query.limit);
        const records = await tx.catchReport.findMany({
          where: { id: { in: page.items.map((item) => item.id) } },
          select: PUBLIC_CATCH_REPORT_SELECT,
        });
        const recordById = new Map(records.map((record) => [record.id, record]));
        const orderedRecords = page.items.flatMap((item) => {
          const record = recordById.get(item.id);
          return record === undefined ? [] : [record];
        });
        const bounds = await resolveBaseFishWeightBounds(tx, orderedRecords);
        return {
          items: orderedRecords.map((record) => toPublicCatchReport(record, bounds)),
          nextCursor: page.nextCursor,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async resolveScope(
    tx: SpotTransaction,
    query: Pick<SpotStatisticsQueryDto, 'fishId' | 'locationId' | 'baseIds' | 'fishIds'>,
  ): Promise<ResolvedSpotScope> {
    const fishScope = query.fishId !== undefined;
    const locationScope = query.locationId !== undefined;
    if (
      fishScope === locationScope ||
      (fishScope && query.fishIds !== undefined) ||
      (locationScope && query.baseIds !== undefined)
    ) {
      throw catchReportErrors.invalidSpotScope();
    }

    if (query.fishId !== undefined) {
      const fish = await tx.fish.findFirst({
        where: { id: query.fishId, isActive: true },
        select: { id: true },
      });
      if (fish === null) throw catalogErrors.fishNotFound();

      if (query.baseIds === undefined) {
        return { kind: 'fish', fishId: query.fishId, baseIds: undefined };
      }

      const visibleBases = await tx.fishingBase.findMany({
        where: {
          id: { in: query.baseIds },
          isActive: true,
          fishLinks: { some: { fishId: query.fishId } },
        },
        select: { id: true },
      });
      const visibleIds = new Set(visibleBases.map((base) => base.id));
      return {
        kind: 'fish',
        fishId: query.fishId,
        baseIds: query.baseIds.filter((baseId) => visibleIds.has(baseId)),
      };
    }

    const locationId = query.locationId;
    if (locationId === undefined) throw catchReportErrors.invalidSpotScope();
    const location = await tx.location.findFirst({
      where: {
        id: locationId,
        isActive: true,
        fishingBase: { isActive: true },
      },
      select: { id: true },
    });
    if (location === null) throw catalogErrors.locationNotFound();
    return {
      kind: 'location',
      locationId,
      fishIds: query.fishIds,
    };
  }
}
