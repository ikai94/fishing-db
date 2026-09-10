import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RECORDS_TIME_ZONE } from './records.constants.js';
import { getRecordsWeek } from './records-week.js';

export type PublicRecordState = 'RECORD' | 'NO_RECORD' | 'UNKNOWN';
export type PublicRecordStatus =
  'NO_RECORD' | 'CAN_BEAT' | 'NEAR_MAX' | 'MAXIMUM' | 'MUTANT' | 'MAX_UNKNOWN' | null;

export function assessOfficialRecord(
  recordWeightGrams: number | null,
  normalMaxWeightGrams: number | null,
) {
  if (recordWeightGrams === null) {
    return { headroomGrams: null, headroomPercent: null, status: 'NO_RECORD' as const };
  }
  if (normalMaxWeightGrams === null) {
    return { headroomGrams: null, headroomPercent: null, status: 'MAX_UNKNOWN' as const };
  }
  const headroomGrams = normalMaxWeightGrams - recordWeightGrams;
  const headroomPercent = (100 * headroomGrams) / normalMaxWeightGrams;
  return {
    headroomGrams,
    headroomPercent,
    status:
      headroomGrams < 0
        ? ('MUTANT' as const)
        : headroomGrams === 0
          ? ('MAXIMUM' as const)
          : headroomPercent <= 0.5
            ? ('NEAR_MAX' as const)
            : ('CAN_BEAT' as const),
  };
}

@Injectable()
export class RecordsQueryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPublicRecords(now = new Date()) {
    const week = getRecordsWeek(now);
    const [fish, snapshot, syncState] = await Promise.all([
      this.prisma.fish.findMany({
        where: { isActive: true },
        orderBy: [{ nameNormalized: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          isRarest: true,
          fishingBaseLinks: {
            select: {
              maxWeightGrams: true,
              fishingBase: { select: { id: true, name: true, isActive: true } },
            },
          },
        },
      }),
      this.prisma.officialRecordSnapshot.findFirst({
        where: { weekStartsAt: week.startsAt },
        orderBy: { fetchedAt: 'desc' },
        select: {
          fetchedAt: true,
          rows: {
            select: {
              fishId: true,
              weightGrams: true,
              waterbodyRaw: true,
              playerNameRaw: true,
              caughtAt: true,
              fishingBase: { select: { id: true, name: true, isActive: true } },
            },
          },
        },
      }),
      this.prisma.officialRecordSyncState.findUnique({
        where: { id: 1 },
        select: { lastAttemptAt: true, lastSuccessAt: true, lastError: true },
      }),
    ]);
    const records = new Map(snapshot?.rows.map((row) => [row.fishId, row]) ?? []);
    return {
      week: {
        startsAt: week.startsAt.toISOString(),
        endsAt: week.endsAt.toISOString(),
        timezone: RECORDS_TIME_ZONE,
        serverNow: now.toISOString(),
      },
      sync: {
        status: snapshot === null ? 'WAITING' : syncState?.lastError ? 'STALE' : 'CURRENT',
        observedAt: snapshot?.fetchedAt.toISOString() ?? null,
        lastAttemptAt: syncState?.lastAttemptAt?.toISOString() ?? null,
        lastSuccessAt: syncState?.lastSuccessAt?.toISOString() ?? null,
      },
      items: fish.map((item) => {
        const record = records.get(item.id) ?? null;
        const knownMaxima = item.fishingBaseLinks
          .map((link) => link.maxWeightGrams)
          .filter((value): value is number => value !== null);
        const normalMaxWeightGrams = knownMaxima.length > 0 ? Math.max(...knownMaxima) : null;
        const maxBases =
          normalMaxWeightGrams === null
            ? []
            : item.fishingBaseLinks
                .filter((link) => link.maxWeightGrams === normalMaxWeightGrams)
                .map((link) => link.fishingBase)
                .sort(
                  (left, right) =>
                    left.name.localeCompare(right.name, 'ru-RU') || left.id.localeCompare(right.id),
                );
        const state: PublicRecordState =
          snapshot === null ? 'UNKNOWN' : record === null ? 'NO_RECORD' : 'RECORD';
        const assessment =
          state === 'UNKNOWN'
            ? { headroomGrams: null, headroomPercent: null, status: null }
            : assessOfficialRecord(record?.weightGrams ?? null, normalMaxWeightGrams);
        return {
          fish: { id: item.id, name: item.name, isRarest: item.isRarest },
          state,
          record:
            record === null
              ? null
              : {
                  weightGrams: record.weightGrams,
                  waterbody: record.waterbodyRaw,
                  fishingBase: record.fishingBase,
                  playerName: record.playerNameRaw,
                  caughtAt: record.caughtAt.toISOString(),
                },
          normalMaxWeightGrams,
          maxBases,
          ...assessment,
        };
      }),
    };
  }
}
