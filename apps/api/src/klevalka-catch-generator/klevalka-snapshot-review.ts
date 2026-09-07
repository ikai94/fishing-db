import { createHash } from 'node:crypto';
import { buildCatalogLookupIndex, resolveCatalogLookup } from '../catalog/catalog-lookup.js';
import type { CatalogLookupIndex } from '../catalog/catalog-lookup.js';
import {
  KLEVALKA_MAX_FILE_CODE_UNITS,
  KLEVALKA_MAX_LINES_PER_FILE,
  deterministicCatchCount,
  deterministicWeight,
  formatKlevalkaWeight,
  klevalkaSourceAwareGeneratorMax,
  klevalkaWeightProfileForBase,
  type CatalogBait,
  type CatalogFishingBase,
  type CatalogLocation,
  type CatalogNamedItem,
  type KlevalkaCatalogSnapshot,
  type KlevalkaSourceRow,
  type ResolvedKlevalkaRow,
  type ReviewField,
  type ReviewIssue,
} from './klevalka-catch-generator.js';

export interface ProjectionIssueExample {
  sourceFile: string;
  sourceRow: number;
  fish: string;
  fishingBase: string;
  location: string;
  bait: string;
  int: string;
}

export interface ProjectionIssueSummary {
  code: string;
  field: ReviewField | 'snapshot';
  count: number;
  examples: ProjectionIssueExample[];
}

export interface ProjectionContributor {
  id: string;
  name: string;
  tuples: number;
  generatedCount: number;
}

export interface ProjectionIntSummary {
  count: number;
  minimum: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  maximum: number | null;
  buckets: Record<string, number>;
}

export interface KlevalkaProjectionReview {
  sourceRows: number;
  resolvedRows: number;
  blockedRows: number;
  excludedRows: number;
  uniqueTuples: number;
  duplicatesRemoved: number;
  issues: ProjectionIssueSummary[];
  sourceIntDistribution: ProjectionIntSummary;
  retainedIntDistribution: ProjectionIntSummary;
  projectedGeneratedCount: number;
  projectedOutputBytes: number;
  projectedOutputFiles: number;
  generatedCountDistribution: Record<string, number>;
  largestContributors: {
    fish: ProjectionContributor[];
    fishingBases: ProjectionContributor[];
    locations: ProjectionContributor[];
    baits: ProjectionContributor[];
  };
  decisionApplications: KlevalkaDecisionApplication[];
}

export interface KlevalkaReviewedDataset {
  projection: KlevalkaProjectionReview;
  retainedRows: ResolvedKlevalkaRow[];
}

interface DecisionBase {
  groupId: string;
  expectedRows: number;
  affectedRowsSha256?: string;
  reason: string;
  evidence: string[];
}

export type KlevalkaGroupedDecision =
  | (DecisionBase & {
      action: 'MAP_FISH';
      sourceFile: string;
      sourceFishName: string;
      targetFishId: string;
      targetFishName: string;
    })
  | (DecisionBase & {
      action: 'EXCLUDE_MEMBERSHIP';
      fishingBaseId: string;
      fishingBaseName: string;
      fishId: string;
      fishName: string;
    })
  | (DecisionBase & {
      action: 'OVERRIDE_WEIGHT_BOUNDS';
      fishingBaseId: string;
      fishingBaseName: string;
      fishId: string;
      fishName: string;
      minWeightGrams: number;
      maxWeightGrams: number;
    })
  | (DecisionBase & {
      action: 'EXCLUDE_WEIGHT_BOUNDS';
      fishingBaseId: string;
      fishingBaseName: string;
      fishId: string;
      fishName: string;
    })
  | (DecisionBase & {
      action: 'EXCLUDE_BAIT';
      sourceBaitName: string;
    });

export interface KlevalkaDecisionApplication {
  groupId: string;
  action: KlevalkaGroupedDecision['action'];
  expectedRows: number;
  appliedRows: number;
  affectedRowsSha256: string;
}

export interface KlevalkaReviewManifest {
  schemaVersion: 2;
  snapshotManifestSha256: string;
  catalogSha256: string;
  datasetId: string;
  decisions: KlevalkaGroupedDecision[];
  acceptedSourceFailures: Array<{
    sourceId: number;
    code: string;
    reason: string;
  }>;
}

interface PreparedCatalog {
  fish: CatalogLookupIndex<CatalogNamedItem>;
  fishingBases: CatalogLookupIndex<CatalogFishingBase>;
  baits: CatalogLookupIndex<CatalogBait>;
  locations: Map<string, CatalogLookupIndex<CatalogLocation>>;
  memberships: Map<string, KlevalkaCatalogSnapshot['memberships'][number]>;
}

interface OutputChunkState {
  files: number;
  rows: number;
  codeUnits: number;
}

interface DecisionUsage {
  decision: KlevalkaGroupedDecision;
  rows: string[];
}

interface SourceWeightStats {
  rowCount: number;
  maximumGrams: number;
}

const INT_BUCKETS = [
  { label: '1', minimum: 1, maximum: 1 },
  { label: '2..9', minimum: 2, maximum: 9 },
  { label: '10', minimum: 10, maximum: 10 },
  { label: '11..99', minimum: 11, maximum: 99 },
  { label: '100..999', minimum: 100, maximum: 999 },
  { label: '1000..9999', minimum: 1_000, maximum: 9_999 },
  { label: '10000..54999', minimum: 10_000, maximum: 54_999 },
  { label: '55000+', minimum: 55_000, maximum: Number.MAX_SAFE_INTEGER },
] as const;

function tupleKey(row: ResolvedKlevalkaRow): string {
  return [row.fish.id, row.fishingBase.id, row.location.id, row.bait.id].join('\0');
}

function decisionRowKey(row: KlevalkaSourceRow): string {
  return JSON.stringify([row.sourceFile, row.sourceRow, row.sourceId]);
}

function rowsSha256(rows: readonly string[]): string {
  return createHash('sha256')
    .update(`${JSON.stringify([...rows].sort())}\n`)
    .digest('hex');
}

function issueForResolution(
  rawValue: string,
  field: ReviewField,
  status: 'NOT_FOUND' | 'AMBIGUOUS',
  candidateIds?: string[],
): ReviewIssue {
  return {
    code: status === 'AMBIGUOUS' ? 'CATALOG_MATCH_AMBIGUOUS' : 'CATALOG_MATCH_UNKNOWN',
    field,
    rawValue,
    ...(candidateIds === undefined ? {} : { candidateIds }),
    message:
      status === 'AMBIGUOUS'
        ? `${field} matches multiple active catalog items`
        : `${field} does not match an active catalog item`,
  };
}

function resolveIndexed<T extends CatalogNamedItem>(
  rawValue: string,
  index: CatalogLookupIndex<T>,
  field: ReviewField,
): { item: T | null; issue: ReviewIssue | null } {
  const resolution = resolveCatalogLookup(index, rawValue);
  if (resolution.status === 'UNIQUE') return { item: resolution.item, issue: null };
  return {
    item: null,
    issue: issueForResolution(
      rawValue,
      field,
      resolution.status,
      resolution.status === 'AMBIGUOUS'
        ? resolution.items.map((item) => item.id).sort()
        : undefined,
    ),
  };
}

function prepareCatalog(catalog: KlevalkaCatalogSnapshot): PreparedCatalog {
  return {
    fish: buildCatalogLookupIndex(catalog.fish),
    fishingBases: buildCatalogLookupIndex(catalog.fishingBases),
    baits: buildCatalogLookupIndex(catalog.baits),
    locations: new Map(
      catalog.fishingBases.map((base) => [base.id, buildCatalogLookupIndex(base.locations)]),
    ),
    memberships: new Map(
      catalog.memberships.map((membership) => [
        `${membership.fishingBaseId}\0${membership.fishId}`,
        membership,
      ]),
    ),
  };
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.floor((sorted.length - 1) * fraction)] ?? null;
}

function summarizeInts(values: readonly number[]): ProjectionIntSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const buckets = Object.fromEntries(INT_BUCKETS.map((bucket) => [bucket.label, 0]));
  for (const value of sorted) {
    const bucket = INT_BUCKETS.find(
      (candidate) => value >= candidate.minimum && value <= candidate.maximum,
    );
    if (bucket !== undefined) buckets[bucket.label] = (buckets[bucket.label] ?? 0) + 1;
  }
  return {
    count: sorted.length,
    minimum: sorted[0] ?? null,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    maximum: sorted.at(-1) ?? null,
    buckets,
  };
}

function addContributor(
  contributors: Map<string, ProjectionContributor>,
  item: CatalogNamedItem,
  generatedCount: number,
): void {
  const current = contributors.get(item.id) ?? {
    id: item.id,
    name: item.name,
    tuples: 0,
    generatedCount: 0,
  };
  current.tuples += 1;
  current.generatedCount += generatedCount;
  contributors.set(item.id, current);
}

function largest(contributors: Map<string, ProjectionContributor>): ProjectionContributor[] {
  return [...contributors.values()]
    .sort(
      (left, right) =>
        right.generatedCount - left.generatedCount ||
        right.tuples - left.tuples ||
        left.name.localeCompare(right.name, 'ru') ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 10);
}

function appendOutputRows(state: OutputChunkState, count: number, rowCodeUnits: number): void {
  let remaining = count;
  while (remaining > 0) {
    if (state.rows === 0) state.files += 1;
    const rowCapacity = KLEVALKA_MAX_LINES_PER_FILE - state.rows;
    const unitCapacity = Math.floor(
      (KLEVALKA_MAX_FILE_CODE_UNITS - state.codeUnits) / rowCodeUnits,
    );
    const accepted = Math.min(remaining, rowCapacity, unitCapacity);
    if (accepted === 0) {
      state.rows = 0;
      state.codeUnits = 0;
      continue;
    }
    state.rows += accepted;
    state.codeUnits += accepted * rowCodeUnits;
    remaining -= accepted;
  }
}

export class KlevalkaProjectionReviewer {
  private readonly prepared: PreparedCatalog;
  private readonly fishMappings = new Map<
    string,
    Extract<KlevalkaGroupedDecision, { action: 'MAP_FISH' }>
  >();
  private readonly membershipExclusions = new Map<
    string,
    Extract<KlevalkaGroupedDecision, { action: 'EXCLUDE_MEMBERSHIP' }>
  >();
  private readonly weightOverrides = new Map<
    string,
    Extract<KlevalkaGroupedDecision, { action: 'OVERRIDE_WEIGHT_BOUNDS' }>
  >();
  private readonly weightExclusions = new Map<
    string,
    Extract<KlevalkaGroupedDecision, { action: 'EXCLUDE_WEIGHT_BOUNDS' }>
  >();
  private readonly baitExclusions = new Map<
    string,
    Extract<KlevalkaGroupedDecision, { action: 'EXCLUDE_BAIT' }>
  >();
  private readonly decisionUsage = new Map<string, DecisionUsage>();
  private readonly retainedByTuple = new Map<string, ResolvedKlevalkaRow>();
  private readonly issueSummaries = new Map<string, ProjectionIssueSummary>();
  private readonly sourceInts: number[] = [];
  private readonly sourceWeightsByBaseFish = new Map<string, SourceWeightStats>();
  private sourceRows = 0;
  private resolvedRows = 0;
  private blockedRows = 0;
  private excludedRows = 0;

  constructor(
    private readonly catalog: KlevalkaCatalogSnapshot,
    private readonly datasetId: string,
    decisions: readonly KlevalkaGroupedDecision[] = [],
  ) {
    if (datasetId.trim().length === 0) throw new TypeError('datasetId must not be empty');
    this.prepared = prepareCatalog(catalog);
    const fishById = new Map(catalog.fish.map((item) => [item.id, item]));
    const basesById = new Map(catalog.fishingBases.map((item) => [item.id, item]));
    const baseFishDecisionKeys = new Set<string>();
    for (const decision of decisions) {
      if (
        decision.groupId.trim().length === 0 ||
        decision.reason.trim().length === 0 ||
        decision.evidence.length === 0 ||
        decision.evidence.some((item) => item.trim().length === 0)
      ) {
        throw new Error(`Incomplete Klevalka review group: ${decision.groupId}`);
      }
      if (this.decisionUsage.has(decision.groupId)) {
        throw new Error(`Duplicate Klevalka review groupId: ${decision.groupId}`);
      }
      if (!Number.isSafeInteger(decision.expectedRows) || decision.expectedRows < 1) {
        throw new Error(`Invalid expectedRows for Klevalka review group ${decision.groupId}`);
      }
      if (
        decision.affectedRowsSha256 !== undefined &&
        !/^[a-f0-9]{64}$/u.test(decision.affectedRowsSha256)
      ) {
        throw new Error(`Invalid affectedRowsSha256 for Klevalka review group ${decision.groupId}`);
      }
      this.decisionUsage.set(decision.groupId, { decision, rows: [] });
      if (decision.action === 'MAP_FISH') {
        const target = fishById.get(decision.targetFishId);
        if (target?.name !== decision.targetFishName) {
          throw new Error(`Klevalka Fish mapping target changed for ${decision.groupId}`);
        }
        this.setUniqueDecision(
          this.fishMappings,
          `${decision.sourceFile}\0${decision.sourceFishName}`,
          decision,
        );
      } else if (decision.action === 'EXCLUDE_BAIT') {
        this.setUniqueDecision(this.baitExclusions, decision.sourceBaitName, decision);
      } else {
        const base = basesById.get(decision.fishingBaseId);
        const fish = fishById.get(decision.fishId);
        if (base?.name !== decision.fishingBaseName || fish?.name !== decision.fishName) {
          throw new Error(`Klevalka BaseFish decision target changed for ${decision.groupId}`);
        }
        const key = `${decision.fishingBaseId}\0${decision.fishId}`;
        if (baseFishDecisionKeys.has(key)) {
          throw new Error(`Overlapping Klevalka BaseFish decision: ${decision.groupId}`);
        }
        baseFishDecisionKeys.add(key);
        if (decision.action === 'EXCLUDE_MEMBERSHIP') {
          this.setUniqueDecision(this.membershipExclusions, key, decision);
        } else if (decision.action === 'OVERRIDE_WEIGHT_BOUNDS') {
          if (
            !Number.isSafeInteger(decision.minWeightGrams) ||
            !Number.isSafeInteger(decision.maxWeightGrams) ||
            decision.minWeightGrams < 1 ||
            decision.minWeightGrams > decision.maxWeightGrams
          ) {
            throw new Error(`Invalid manual bounds for ${decision.groupId}`);
          }
          this.setUniqueDecision(this.weightOverrides, key, decision);
        } else this.setUniqueDecision(this.weightExclusions, key, decision);
      }
    }
  }

  private setUniqueDecision<T extends KlevalkaGroupedDecision>(
    map: Map<string, T>,
    key: string,
    decision: T,
  ): void {
    if (map.has(key)) throw new Error(`Overlapping Klevalka review decision: ${decision.groupId}`);
    map.set(key, decision);
  }

  private applyDecision(decision: KlevalkaGroupedDecision, row: KlevalkaSourceRow): void {
    const usage = this.decisionUsage.get(decision.groupId);
    if (usage === undefined) throw new Error(`Unknown Klevalka review group: ${decision.groupId}`);
    usage.rows.push(decisionRowKey(row));
  }

  addRows(rows: readonly KlevalkaSourceRow[]): void {
    for (const row of rows) this.addRow(row);
  }

  private addIssue(issue: ReviewIssue, row: KlevalkaSourceRow): void {
    const key = `${issue.code}\0${issue.field}`;
    const summary = this.issueSummaries.get(key) ?? {
      code: issue.code,
      field: issue.field,
      count: 0,
      examples: [],
    };
    summary.count += 1;
    if (summary.examples.length < 5) {
      summary.examples.push({
        sourceFile: row.sourceFile,
        sourceRow: row.sourceRow,
        fish: row.fishNameRaw,
        fishingBase: row.fishingBaseNameRaw,
        location: row.locationNameRaw,
        bait: row.baitNameRaw,
        int: row.intRaw,
      });
    }
    this.issueSummaries.set(key, summary);
  }

  private addRow(row: KlevalkaSourceRow): void {
    this.sourceRows += 1;
    const issues: ReviewIssue[] = [];
    if (row.int === null) {
      issues.push({
        code: 'INVALID_INT',
        field: 'int',
        rawValue: row.intRaw,
        message: 'INT must be a positive integer',
      });
    } else this.sourceInts.push(row.int);
    if (row.sourceWeightGrams === null) {
      issues.push({
        code: 'INVALID_SOURCE_WEIGHT',
        field: 'sourceWeight',
        rawValue: row.sourceWeightGramsRaw,
        message: 'Klevalka source weight must be a non-negative integer number of grams',
      });
    }

    const base = resolveIndexed(row.fishingBaseNameRaw, this.prepared.fishingBases, 'fishingBase');
    const fishMapping = this.fishMappings.get(`${row.sourceFile}\0${row.fishNameRaw}`);
    const fish =
      fishMapping === undefined
        ? resolveIndexed(row.fishNameRaw, this.prepared.fish, 'fish')
        : {
            item: this.catalog.fish.find((item) => item.id === fishMapping.targetFishId) ?? null,
            issue: null,
          };
    if (fishMapping !== undefined) this.applyDecision(fishMapping, row);
    if (base.item !== null && fish.item !== null && row.sourceWeightGrams !== null) {
      const key = `${base.item.id}\0${fish.item.id}`;
      const stats = this.sourceWeightsByBaseFish.get(key) ?? {
        rowCount: 0,
        maximumGrams: 0,
      };
      stats.rowCount += 1;
      stats.maximumGrams = Math.max(stats.maximumGrams, row.sourceWeightGrams);
      this.sourceWeightsByBaseFish.set(key, stats);
    }
    const baitExclusion = this.baitExclusions.get(row.baitNameRaw);
    if (baitExclusion !== undefined) {
      this.applyDecision(baitExclusion, row);
      this.excludedRows += 1;
      return;
    }
    const bait = resolveIndexed(row.baitNameRaw, this.prepared.baits, 'bait');
    const location = resolveIndexed(
      row.locationNameRaw,
      base.item === null
        ? new Map<string, readonly CatalogLocation[]>()
        : (this.prepared.locations.get(base.item.id) ?? new Map()),
      'location',
    );
    for (const result of [base, fish, bait, location]) {
      if (result.issue !== null) issues.push(result.issue);
    }

    let membership: KlevalkaCatalogSnapshot['memberships'][number] | undefined;
    if (base.item !== null && fish.item !== null) {
      const baseFishKey = `${base.item.id}\0${fish.item.id}`;
      const membershipExclusion = this.membershipExclusions.get(baseFishKey);
      if (membershipExclusion !== undefined) {
        this.applyDecision(membershipExclusion, row);
        this.excludedRows += 1;
        return;
      }
      membership = this.prepared.memberships.get(baseFishKey);
      const weightOverride = this.weightOverrides.get(baseFishKey);
      const weightExclusion = this.weightExclusions.get(baseFishKey);
      if (weightOverride !== undefined && weightExclusion !== undefined) {
        throw new Error(
          `Conflicting Klevalka weight decisions for ${base.item.name}/${fish.item.name}`,
        );
      }
      if (weightOverride !== undefined) {
        this.applyDecision(weightOverride, row);
        membership = {
          fishingBaseId: base.item.id,
          fishId: fish.item.id,
          minWeightGrams: weightOverride.minWeightGrams,
          maxWeightGrams: weightOverride.maxWeightGrams,
        };
      } else if (membership === undefined) {
        issues.push({
          code: 'FISH_NOT_IN_BASE',
          field: 'membership',
          message: 'Resolved Fish is not linked to the resolved Base',
        });
      } else if (weightExclusion !== undefined) {
        this.applyDecision(weightExclusion, row);
        this.excludedRows += 1;
        return;
      } else {
        if (
          membership.minWeightGrams === null ||
          membership.maxWeightGrams === null ||
          membership.minWeightGrams < 1 ||
          membership.minWeightGrams > membership.maxWeightGrams
        ) {
          issues.push({
            code: 'WEIGHT_BOUNDS_MISSING',
            field: 'weightBounds',
            message: 'BaseFish needs valid minimum and maximum weights',
          });
        }
      }
    }

    if (
      issues.length > 0 ||
      row.int === null ||
      row.sourceWeightGrams === null ||
      base.item === null ||
      fish.item === null ||
      bait.item === null ||
      location.item === null ||
      membership?.minWeightGrams === null ||
      membership?.minWeightGrams === undefined ||
      membership.maxWeightGrams === null
    ) {
      this.blockedRows += 1;
      for (const issue of issues) this.addIssue(issue, row);
      return;
    }

    this.resolvedRows += 1;
    const resolved: ResolvedKlevalkaRow = {
      ...row,
      fish: fish.item,
      fishingBase: base.item,
      location: location.item,
      bait: bait.item,
      minWeightGrams: membership.minWeightGrams,
      maxWeightGrams: membership.maxWeightGrams,
    };
    const key = tupleKey(resolved);
    const retained = this.retainedByTuple.get(key);
    const tieKey = `${resolved.sourceId}\0${resolved.sourceFile}\0${resolved.sourceRow.toString().padStart(10, '0')}`;
    const retainedTieKey =
      retained === undefined
        ? ''
        : `${retained.sourceId}\0${retained.sourceFile}\0${retained.sourceRow.toString().padStart(10, '0')}`;
    if (
      retained === undefined ||
      (resolved.int ?? 0) > (retained.int ?? 0) ||
      ((resolved.int ?? 0) === (retained.int ?? 0) && tieKey < retainedTieKey)
    ) {
      this.retainedByTuple.set(key, resolved);
    }
  }

  private retainedRowsForGeneration(): ResolvedKlevalkaRow[] {
    return [...this.retainedByTuple.values()]
      .map((row) => {
        const key = `${row.fishingBase.id}\0${row.fish.id}`;
        const stats = this.sourceWeightsByBaseFish.get(key);
        if (stats === undefined) {
          throw new Error(`Resolved Klevalka BaseFish has no source weights: ${key}`);
        }
        const maxWeightGrams = klevalkaSourceAwareGeneratorMax({
          fishingBaseName: row.fishingBase.name,
          fishName: row.fish.name,
          effectiveMaxWeightGrams: row.maxWeightGrams,
          sourceMaxWeightGrams: stats.maximumGrams,
          sourceRowCount: stats.rowCount,
          usesReviewedWeightOverride: this.weightOverrides.has(key),
        });
        if (maxWeightGrams < row.minWeightGrams) {
          throw new Error(
            `Klevalka source-aware maximum is below minimum weight for ${row.fishingBase.name}/${row.fish.name}`,
          );
        }
        return maxWeightGrams === row.maxWeightGrams ? row : { ...row, maxWeightGrams };
      })
      .sort((left, right) => tupleKey(left).localeCompare(tupleKey(right)));
  }

  finish(): KlevalkaProjectionReview {
    const decisionApplications = [...this.decisionUsage.values()]
      .map(({ decision, rows }) => {
        const affectedRowsSha256 = rowsSha256(rows);
        if (rows.length !== decision.expectedRows) {
          throw new Error(
            `Klevalka review group ${decision.groupId} matched ${rows.length} rows; expected ${decision.expectedRows}`,
          );
        }
        if (
          decision.affectedRowsSha256 !== undefined &&
          decision.affectedRowsSha256 !== affectedRowsSha256
        ) {
          throw new Error(`Klevalka review group ${decision.groupId} source rows changed`);
        }
        return {
          groupId: decision.groupId,
          action: decision.action,
          expectedRows: decision.expectedRows,
          appliedRows: rows.length,
          affectedRowsSha256,
        };
      })
      .sort((left, right) => left.groupId.localeCompare(right.groupId));
    const retainedRows = this.retainedRowsForGeneration();
    const retainedInts: number[] = [];
    const countDistribution = new Map<number, number>();
    const contributors = {
      fish: new Map<string, ProjectionContributor>(),
      fishingBases: new Map<string, ProjectionContributor>(),
      locations: new Map<string, ProjectionContributor>(),
      baits: new Map<string, ProjectionContributor>(),
    };
    const outputByBase = new Map<string, OutputChunkState>();
    let projectedGeneratedCount = 0;
    let projectedOutputBytes = 0;

    for (const row of retainedRows) {
      const int = row.int;
      if (int === null) throw new Error('Retained projection row has invalid INT');
      retainedInts.push(int);
      const count = deterministicCatchCount(int, this.datasetId, row.sourceId);
      projectedGeneratedCount += count;
      countDistribution.set(count, (countDistribution.get(count) ?? 0) + 1);
      addContributor(contributors.fish, row.fish, count);
      addContributor(contributors.fishingBases, row.fishingBase, count);
      addContributor(contributors.locations, row.location, count);
      addContributor(contributors.baits, row.bait, count);

      const prefix = `${row.fish.name} `;
      const suffix = `. Поймана на ${row.fishingBase.name}: ${row.location.name}, ${row.bait.name}.`;
      const baseBytes = Buffer.byteLength(prefix + suffix, 'utf8') + 1;
      const baseCodeUnits = prefix.length + suffix.length + 1;
      const minimumWeight = formatKlevalkaWeight(row.minWeightGrams);
      const chunkState = outputByBase.get(row.fishingBase.id) ?? {
        files: 0,
        rows: 0,
        codeUnits: 0,
      };
      if (row.minWeightGrams === row.maxWeightGrams) {
        projectedOutputBytes += count * (baseBytes + Buffer.byteLength(minimumWeight, 'utf8'));
        appendOutputRows(chunkState, count, baseCodeUnits + minimumWeight.length);
      } else {
        for (let ordinal = 1; ordinal <= count; ordinal += 1) {
          const weight = formatKlevalkaWeight(
            deterministicWeight(
              row.minWeightGrams,
              row.maxWeightGrams,
              this.datasetId,
              row.sourceId,
              ordinal,
              klevalkaWeightProfileForBase(row.fishingBase.name),
            ),
          );
          projectedOutputBytes += baseBytes + Buffer.byteLength(weight, 'utf8');
          appendOutputRows(chunkState, 1, baseCodeUnits + weight.length);
        }
      }
      outputByBase.set(row.fishingBase.id, chunkState);
    }

    return {
      sourceRows: this.sourceRows,
      resolvedRows: this.resolvedRows,
      blockedRows: this.blockedRows,
      excludedRows: this.excludedRows,
      uniqueTuples: retainedRows.length,
      duplicatesRemoved: this.resolvedRows - retainedRows.length,
      issues: [...this.issueSummaries.values()].sort(
        (left, right) => right.count - left.count || left.code.localeCompare(right.code),
      ),
      sourceIntDistribution: summarizeInts(this.sourceInts),
      retainedIntDistribution: summarizeInts(retainedInts),
      projectedGeneratedCount,
      projectedOutputBytes,
      projectedOutputFiles: [...outputByBase.values()].reduce((sum, state) => sum + state.files, 0),
      generatedCountDistribution: Object.fromEntries(
        [...countDistribution.entries()]
          .sort(([left], [right]) => left - right)
          .map(([count, tuples]) => [String(count), tuples]),
      ),
      largestContributors: {
        fish: largest(contributors.fish),
        fishingBases: largest(contributors.fishingBases),
        locations: largest(contributors.locations),
        baits: largest(contributors.baits),
      },
      decisionApplications,
    };
  }

  finishForGeneration(): KlevalkaReviewedDataset {
    const projection = this.finish();
    return {
      projection,
      retainedRows: this.retainedRowsForGeneration(),
    };
  }
}
