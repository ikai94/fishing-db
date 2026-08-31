import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ParsedForumCandidate } from '../candidate-types.js';
import type { CatalogSnapshot } from '../catalog-source.js';
import { FORUM83_SOURCE } from './constants.js';

export const FORUM83_REVIEWED_DECISIONS_SHA256 =
  'bbfbfe0537867de75660baf7b645b710e653868ae9c21b92967ab8ef05b30e7d' as const;

export interface Forum83ReviewedPair {
  baseName: string;
  fishName: string;
}

interface ScopedMapping {
  baseName: string;
  raw: string;
  target: string;
}

interface RawMapping {
  raw: string;
  target: string;
}

interface EmbeddedBaseMapping {
  topicBase: string;
  raw: string;
  target: string;
}

export interface Forum83ReviewedDecisions {
  version: 1;
  source: typeof FORUM83_SOURCE;
  corpusScope: 'forum83-all-forum-83';
  locationMappings: ScopedMapping[];
  baitMappings: RawMapping[];
  embeddedBaseMappings: EmbeddedBaseMapping[];
  fishMappings: ScopedMapping[];
  baseFishAdditions: Forum83ReviewedPair[];
  baseFishRejections: Forum83ReviewedPair[];
  rejectedBaitRaw: string[];
}

export interface Forum83CatalogRawOverride {
  fishNameRaw?: string;
  locationRaw?: string;
  baitRaw?: string;
}

let cached: Forum83ReviewedDecisions | undefined;

export class Forum83ReviewedDecisionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Forum83ReviewedDecisionsError';
  }
}

export function loadForum83ReviewedDecisions(): Forum83ReviewedDecisions {
  if (cached !== undefined) return cached;
  const source = readFileSync(
    new URL('../../../prisma/catalog-data/forum83-reviewed-decisions.json', import.meta.url),
    'utf8',
  );
  const observedHash = createHash('sha256').update(source).digest('hex');
  if (observedHash !== FORUM83_REVIEWED_DECISIONS_SHA256) {
    throw new Forum83ReviewedDecisionsError(
      `forum83 reviewed decisions hash is ${observedHash}, expected ${FORUM83_REVIEWED_DECISIONS_SHA256}`,
    );
  }

  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) throw new Forum83ReviewedDecisionsError('reviewed decisions must be JSON');
  if (
    value.version !== 1 ||
    value.source !== FORUM83_SOURCE ||
    value.corpusScope !== 'forum83-all-forum-83'
  ) {
    throw new Forum83ReviewedDecisionsError('reviewed decisions identity is invalid');
  }

  const decisions: Forum83ReviewedDecisions = {
    version: 1,
    source: FORUM83_SOURCE,
    corpusScope: 'forum83-all-forum-83',
    locationMappings: scopedMappings(value.locationMappings, 'locationMappings', 6),
    baitMappings: rawMappings(value.baitMappings, 'baitMappings', 15),
    embeddedBaseMappings: embeddedMappings(value.embeddedBaseMappings, 1),
    fishMappings: scopedMappings(value.fishMappings, 'fishMappings', 2),
    baseFishAdditions: pairs(value.baseFishAdditions, 'baseFishAdditions', 7),
    baseFishRejections: pairs(value.baseFishRejections, 'baseFishRejections', 14),
    rejectedBaitRaw: strings(value.rejectedBaitRaw, 'rejectedBaitRaw', 4),
  };
  assertUnique(decisions.locationMappings, ({ baseName, raw }) => `${baseName}\0${raw}`);
  assertUnique(decisions.baitMappings, ({ raw }) => raw);
  assertUnique(decisions.embeddedBaseMappings, ({ topicBase, raw }) => `${topicBase}\0${raw}`);
  assertUnique(decisions.fishMappings, ({ baseName, raw }) => `${baseName}\0${raw}`);
  assertUnique(decisions.baseFishAdditions, pairKey);
  assertUnique(decisions.baseFishRejections, pairKey);
  assertUnique(decisions.rejectedBaitRaw, (raw) => raw);
  const rejectedPairs = new Set(decisions.baseFishRejections.map(pairKey));
  if (decisions.baseFishAdditions.some((pair) => rejectedPairs.has(pairKey(pair)))) {
    throw new Forum83ReviewedDecisionsError('BaseFish addition and rejection sets overlap');
  }
  const mappedBaits = new Set(decisions.baitMappings.map(({ raw }) => raw));
  if (decisions.rejectedBaitRaw.some((raw) => mappedBaits.has(raw))) {
    throw new Forum83ReviewedDecisionsError('Bait mapping and rejection sets overlap');
  }
  cached = decisions;
  return decisions;
}

export function forum83CatalogRawOverride(
  candidate: ParsedForumCandidate,
): Forum83CatalogRawOverride {
  const decisions = loadForum83ReviewedDecisions();
  const scopedKey = `${candidate.fishingBaseRaw ?? ''}\0`;
  const fishNameRaw = decisions.fishMappings.find(
    ({ baseName, raw }) => `${baseName}\0${raw}` === `${scopedKey}${candidate.fishNameRaw ?? ''}`,
  )?.target;
  const locationRaw = decisions.locationMappings.find(
    ({ baseName, raw }) => `${baseName}\0${raw}` === `${scopedKey}${candidate.locationRaw ?? ''}`,
  )?.target;
  const baitRaw = decisions.baitMappings.find(({ raw }) => raw === candidate.baitRaw)?.target;
  return {
    ...(fishNameRaw === undefined ? {} : { fishNameRaw }),
    ...(locationRaw === undefined ? {} : { locationRaw }),
    ...(baitRaw === undefined ? {} : { baitRaw }),
  };
}

export function isReviewedEmbeddedBaseEquivalent(topicBase: string, raw: string): boolean {
  return loadForum83ReviewedDecisions().embeddedBaseMappings.some(
    (mapping) =>
      mapping.topicBase === topicBase && mapping.raw === raw && mapping.target === topicBase,
  );
}

export function isProtectedReviewedBaitRaw(raw: string): boolean {
  const decisions = loadForum83ReviewedDecisions();
  return (
    decisions.baitMappings.some((mapping) => mapping.raw === raw) ||
    decisions.rejectedBaitRaw.includes(raw)
  );
}

export function assertForum83ReviewedResolutionTargets(catalog: CatalogSnapshot): void {
  const decisions = loadForum83ReviewedDecisions();
  const exactBases = exactIndex(catalog.fishingBases, 'FishingBase');
  const exactFish = exactIndex(catalog.fish, 'Fish');
  const exactBaits = exactIndex(catalog.baits, 'Bait');

  for (const mapping of decisions.locationMappings) {
    const base = requiredActive(exactBases, mapping.baseName, 'FishingBase');
    const matches = catalog.locations.filter(
      (location) => location.fishingBaseId === base.id && location.name === mapping.target,
    );
    if (matches.length !== 1 || !matches[0]?.isActive) {
      throw new Forum83ReviewedDecisionsError(
        `reviewed Location target is not one exact active row: ${mapping.baseName}/${mapping.target}`,
      );
    }
  }

  for (const mapping of decisions.baitMappings) {
    requiredActive(exactBaits, mapping.target, 'Bait');
  }

  for (const mapping of decisions.embeddedBaseMappings) {
    requiredActive(exactBases, mapping.target, 'FishingBase');
  }

  for (const mapping of decisions.fishMappings) {
    const base = requiredActive(exactBases, mapping.baseName, 'FishingBase');
    const fish = requiredActive(exactFish, mapping.target, 'Fish');
    if (
      !catalog.memberships.some(
        (membership) => membership.fishingBaseId === base.id && membership.fishId === fish.id,
      )
    ) {
      throw new Forum83ReviewedDecisionsError(
        `reviewed Fish mapping target membership is absent: ${mapping.baseName}/${mapping.target}`,
      );
    }
  }
}

function exactIndex<Row extends { id: string; name: string; isActive: boolean }>(
  rows: readonly Row[],
  kind: string,
): Map<string, Row> {
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (result.has(row.name)) {
      throw new Forum83ReviewedDecisionsError(`${kind} exact name is duplicated: ${row.name}`);
    }
    result.set(row.name, row);
  }
  return result;
}

function requiredActive<Row extends { id: string; name: string; isActive: boolean }>(
  rows: Map<string, Row>,
  name: string,
  kind: string,
): Row {
  const row = rows.get(name);
  if (row === undefined || !row.isActive) {
    throw new Forum83ReviewedDecisionsError(
      `reviewed ${kind} target is not one exact active row: ${name}`,
    );
  }
  return row;
}

function scopedMappings(value: unknown, path: string, expected: number): ScopedMapping[] {
  return objects(value, path, expected).map((entry, index) => ({
    baseName: stringField(entry, 'baseName', `${path}[${String(index)}]`),
    raw: stringField(entry, 'raw', `${path}[${String(index)}]`),
    target: stringField(entry, 'target', `${path}[${String(index)}]`),
  }));
}

function rawMappings(value: unknown, path: string, expected: number): RawMapping[] {
  return objects(value, path, expected).map((entry, index) => ({
    raw: stringField(entry, 'raw', `${path}[${String(index)}]`),
    target: stringField(entry, 'target', `${path}[${String(index)}]`),
  }));
}

function embeddedMappings(value: unknown, expected: number): EmbeddedBaseMapping[] {
  return objects(value, 'embeddedBaseMappings', expected).map((entry, index) => ({
    topicBase: stringField(entry, 'topicBase', `embeddedBaseMappings[${String(index)}]`),
    raw: stringField(entry, 'raw', `embeddedBaseMappings[${String(index)}]`),
    target: stringField(entry, 'target', `embeddedBaseMappings[${String(index)}]`),
  }));
}

function pairs(value: unknown, path: string, expected: number): Forum83ReviewedPair[] {
  return objects(value, path, expected).map((entry, index) => ({
    baseName: stringField(entry, 'baseName', `${path}[${String(index)}]`),
    fishName: stringField(entry, 'fishName', `${path}[${String(index)}]`),
  }));
}

function objects(value: unknown, path: string, expected: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new Forum83ReviewedDecisionsError(
      `${path} must contain exactly ${String(expected)} rows`,
    );
  }
  const result: Record<string, unknown>[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) {
      throw new Forum83ReviewedDecisionsError(`${path} entries must be objects`);
    }
    result.push(entry);
  }
  return result;
}

function strings(value: unknown, path: string, expected: number): string[] {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new Forum83ReviewedDecisionsError(
      `${path} must contain exactly ${String(expected)} strings`,
    );
  }
  const result: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Forum83ReviewedDecisionsError(`${path} entries must be non-empty strings`);
    }
    result.push(entry);
  }
  return result;
}

function stringField(value: Record<string, unknown>, field: string, path: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) {
    throw new Forum83ReviewedDecisionsError(`${path}.${field} must be a non-empty string`);
  }
  return result;
}

function assertUnique<Value>(values: readonly Value[], key: (value: Value) => string): void {
  const keys = values.map(key);
  if (new Set(keys).size !== keys.length) {
    throw new Forum83ReviewedDecisionsError('reviewed decisions contain duplicate keys');
  }
}

function pairKey(pair: Forum83ReviewedPair): string {
  return `${pair.baseName}\0${pair.fishName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
