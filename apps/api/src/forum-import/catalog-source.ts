import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';

export interface CatalogNamedRow {
  id: string;
  name: string;
  nameNormalized: string;
  isActive: boolean;
}

export interface CatalogLocationRow extends CatalogNamedRow {
  fishingBaseId: string;
  number: number;
}

export interface CatalogBaitRow extends CatalogNamedRow {
  type: 'BAIT' | 'LURE';
}

export interface CatalogMembershipRow {
  fishingBaseId: string;
  fishId: string;
}

export interface CatalogSnapshotData {
  version: 1;
  fishingBases: CatalogNamedRow[];
  locations: CatalogLocationRow[];
  fish: CatalogNamedRow[];
  baits: CatalogBaitRow[];
  memberships: CatalogMembershipRow[];
}

export interface CatalogSnapshot extends CatalogSnapshotData {
  fingerprint: string;
}

export type CatalogSnapshotSource = Pick<
  PrismaService,
  'fishingBase' | 'location' | 'fish' | 'bait' | 'fishingBaseFish'
>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNamedRows(left: CatalogNamedRow, right: CatalogNamedRow): number {
  return compareText(left.nameNormalized, right.nameNormalized) || compareText(left.id, right.id);
}

function compareLocations(left: CatalogLocationRow, right: CatalogLocationRow): number {
  return (
    compareText(left.fishingBaseId, right.fishingBaseId) ||
    compareText(left.nameNormalized, right.nameNormalized) ||
    left.number - right.number ||
    compareText(left.id, right.id)
  );
}

function compareMemberships(left: CatalogMembershipRow, right: CatalogMembershipRow): number {
  return (
    compareText(left.fishingBaseId, right.fishingBaseId) || compareText(left.fishId, right.fishId)
  );
}

export function serializeCatalogSnapshot(snapshot: CatalogSnapshotData): string {
  return JSON.stringify(snapshot);
}

export function fingerprintCatalogSnapshot(snapshot: CatalogSnapshotData): string {
  return createHash('sha256').update(serializeCatalogSnapshot(snapshot), 'utf8').digest('hex');
}

export async function loadCatalogSnapshot(source: CatalogSnapshotSource): Promise<CatalogSnapshot> {
  const [fishingBases, locations, fish, baits, memberships] = await Promise.all([
    source.fishingBase.findMany({
      select: { id: true, name: true, nameNormalized: true, isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
    }),
    source.location.findMany({
      select: {
        id: true,
        fishingBaseId: true,
        number: true,
        name: true,
        nameNormalized: true,
        isActive: true,
      },
      orderBy: [
        { fishingBaseId: 'asc' },
        { nameNormalized: 'asc' },
        { number: 'asc' },
        { id: 'asc' },
      ],
    }),
    source.fish.findMany({
      select: { id: true, name: true, nameNormalized: true, isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
    }),
    source.bait.findMany({
      select: { id: true, name: true, nameNormalized: true, type: true, isActive: true },
      orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
    }),
    source.fishingBaseFish.findMany({
      select: { fishingBaseId: true, fishId: true },
      orderBy: [{ fishingBaseId: 'asc' }, { fishId: 'asc' }],
    }),
  ]);

  const data: CatalogSnapshotData = {
    version: 1,
    fishingBases: [...fishingBases].sort(compareNamedRows),
    locations: [...locations].sort(compareLocations),
    fish: [...fish].sort(compareNamedRows),
    baits: [...baits].sort(compareNamedRows),
    memberships: [...memberships].sort(compareMemberships),
  };

  return { ...data, fingerprint: fingerprintCatalogSnapshot(data) };
}
