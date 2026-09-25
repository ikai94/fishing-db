import { apiRequest } from './api-client';

export type FavoriteFish = { fishId: string };
export type FavoriteFishListResponse = { items: FavoriteFish[] };

function exactObject(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Некорректный ${label}.`);
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Некорректный ${label}.`);
  }
  return object;
}

function decodeFavorite(value: unknown): FavoriteFish {
  const item = exactObject(value, 'элемент избранного', ['fishId']);
  if (typeof item.fishId !== 'string' || item.fishId.length === 0) {
    throw new Error('Некорректный ID избранной рыбы.');
  }
  return { fishId: item.fishId };
}

/** Строго декодирует персональный список Fish ID. */
export function decodeFavoriteFishList(value: unknown): FavoriteFishListResponse {
  const root = exactObject(value, 'ответ избранного', ['items']);
  if (!Array.isArray(root.items)) throw new Error('Некорректный список избранного.');
  return { items: root.items.map(decodeFavorite) };
}

/** Загружает все избранные Fish одним запросом. */
export async function getFavoriteFish(signal?: AbortSignal): Promise<FavoriteFishListResponse> {
  return decodeFavoriteFishList(await apiRequest<unknown>('/me/favorite-fish', { signal }));
}

/** Идемпотентно добавляет Fish в избранное. */
export async function addFavoriteFish(fishId: string): Promise<FavoriteFish> {
  const root = exactObject(
    await apiRequest<unknown>(`/me/favorite-fish/${fishId}`, { method: 'POST' }),
    'ответ добавления в избранное',
    ['favorite'],
  );
  const favorite = decodeFavorite(root.favorite);
  if (favorite.fishId !== fishId) throw new Error('Сервер вернул другую избранную рыбу.');
  return favorite;
}

/** Идемпотентно удаляет Fish из избранного. */
export async function removeFavoriteFish(fishId: string): Promise<void> {
  await apiRequest<void>(`/me/favorite-fish/${fishId}`, { method: 'DELETE' });
}
