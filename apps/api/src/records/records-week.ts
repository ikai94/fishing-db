// Москва круглый год живёт в UTC+3, поэтому фиксированное смещение здесь точнее сезонных правил.
const MOSCOW_OFFSET_MS = 3 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export type RecordsWeek = { startsAt: Date; endsAt: Date };

/**
 * Возвращает границы официальной недели, которая начинается в воскресенье в 22:00 по Москве.
 * Расчёт ведётся через UTC-компоненты искусственно сдвинутой даты, чтобы результат не зависел
 * от часового пояса процесса Node.js.
 */
export function getRecordsWeek(now: Date): RecordsWeek {
  const local = new Date(now.getTime() + MOSCOW_OFFSET_MS);

  // Date.UTC используется как календарная арифметика над московскими компонентами, а не как
  // утверждение, что 22:00 действительно относится к UTC.
  const startLocalMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - local.getUTCDay(),
    22,
  );
  const candidateUtcMs = startLocalMs - MOSCOW_OFFSET_MS;

  // До воскресного переключения кандидат ещё лежит в будущем, поэтому берём предыдущую неделю.
  const startsAtMs = now.getTime() < candidateUtcMs ? candidateUtcMs - WEEK_MS : candidateUtcMs;
  return { startsAt: new Date(startsAtMs), endsAt: new Date(startsAtMs + WEEK_MS) };
}
