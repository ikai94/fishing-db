import { apiRequest } from './api-client';

/** Независимые варианты знаний сообщества; не заменяют исторические условия уловов. */
export const COMMUNITY_MARKS = [
  'BOTTOM',
  'MIDWATER',
  'FLY',
  'NIGHT',
  'TWILIGHT',
  'DAY',
  'ALL_DAY',
] as const;
/** Один независимый вариант, общий для чтения и изменения голосов. */
export type CommunityMark = (typeof COMMUNITY_MARKS)[number];
/** Публичный итог голосов без идентификаторов участников. */
export type CommunityCount = { mark: CommunityMark; count: number };
/** Ограниченная страница публичных никнеймов. */
export type VotersPage = { items: { nickname: string }[]; nextCursor: string | null };

/** Проверяет точные ключи публичных и собственных REST-проекций. */
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  )
    throw new Error('Некорректные отметки сообщества');
  return value as Record<string, unknown>;
}
/** Отклоняет неизвестные варианты и повторения в ответах. */
function marks(value: unknown, counts: boolean): CommunityCount[] {
  const response = record(value, ['items']);
  if (!Array.isArray(response.items)) throw new Error('Некорректные отметки сообщества');
  const seen = new Set<string>();
  const items = response.items.map((raw) => {
    const item = record(raw, counts ? ['mark', 'count'] : ['mark']);
    if (!COMMUNITY_MARKS.includes(item.mark as CommunityMark) || seen.has(item.mark as string))
      throw new Error('Некорректные отметки сообщества');
    seen.add(item.mark as string);
    if (
      counts &&
      (typeof item.count !== 'number' || !Number.isSafeInteger(item.count) || item.count < 0)
    )
      throw new Error('Некорректный счётчик');
    return { mark: item.mark as CommunityMark, count: counts ? (item.count as number) : 0 };
  });
  if (counts && items.length !== COMMUNITY_MARKS.length)
    throw new Error('Неполные отметки сообщества');
  return items;
}
/** Читает публичные счётчики независимо от текущей сессии. */
export async function getCommunityCounts(
  fishId: string,
  signal?: AbortSignal,
): Promise<CommunityCount[]> {
  return marks(
    await apiRequest<unknown>(`/catalog/fish/${encodeURIComponent(fishId)}/community-marks`, {
      signal,
    }),
    true,
  );
}
/** Читает только голоса текущего пользователя. */
export async function getMyCommunityMarks(
  fishId: string,
  signal?: AbortSignal,
): Promise<CommunityMark[]> {
  return marks(
    await apiRequest<unknown>(`/me/fish/${encodeURIComponent(fishId)}/community-marks`, { signal }),
    false,
  ).map((item) => item.mark);
}
/** Изменяет отметку через cookie-сессию без передачи userId. */
export async function setCommunityMark(
  fishId: string,
  mark: CommunityMark,
  enabled: boolean,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest(`/me/fish/${encodeURIComponent(fishId)}/community-marks/${mark}`, {
    method: enabled ? 'POST' : 'DELETE',
    signal,
  });
}
/** Загружает ограниченную страницу никнеймов только при раскрытии списка. */
export async function getCommunityVoters(
  fishId: string,
  mark: CommunityMark,
  after?: string,
  signal?: AbortSignal,
): Promise<VotersPage> {
  const query = after ? `?${new URLSearchParams({ after })}` : '';
  const response = record(
    await apiRequest<unknown>(
      `/catalog/fish/${encodeURIComponent(fishId)}/community-marks/${mark}/voters${query}`,
      { signal },
    ),
    ['items', 'nextCursor'],
  );
  if (
    !Array.isArray(response.items) ||
    response.items.length > 50 ||
    (response.nextCursor !== null && typeof response.nextCursor !== 'string')
  )
    throw new Error('Некорректный список участников');
  const items = response.items.map((raw) => {
    const item = record(raw, ['nickname']);
    if (typeof item.nickname !== 'string' || !item.nickname.length)
      throw new Error('Некорректный никнейм');
    return { nickname: item.nickname };
  });
  return { items, nextCursor: response.nextCursor as string | null };
}
