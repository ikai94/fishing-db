const MOSCOW_OFFSET_MS = 3 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export type RecordsWeek = { startsAt: Date; endsAt: Date };

export function getRecordsWeek(now: Date): RecordsWeek {
  const local = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  const startLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - local.getUTCDay(),
    22,
  );
  const candidateUtcMs = startLocalMs - MOSCOW_OFFSET_MS;
  const startsAtMs = now.getTime() < candidateUtcMs ? candidateUtcMs - WEEK_MS : candidateUtcMs;
  return { startsAt: new Date(startsAtMs), endsAt: new Date(startsAtMs + WEEK_MS) };
}
