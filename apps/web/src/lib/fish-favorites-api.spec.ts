import { describe, expect, test } from 'vitest';
import { decodeFavoriteFishList } from './fish-favorites-api';

describe('favorite Fish API decoder', () => {
  test('accepts the exact compact ID list', () => {
    expect(decodeFavoriteFishList({ items: [{ fishId: 'fish-a' }, { fishId: 'fish-b' }] })).toEqual(
      { items: [{ fishId: 'fish-a' }, { fishId: 'fish-b' }] },
    );
  });

  test('rejects extra fields and malformed items', () => {
    expect(() =>
      decodeFavoriteFishList({ items: [{ fishId: 'fish-a', userId: 'private' }] }),
    ).toThrow(/Некорректный элемент избранного/u);
    expect(() => decodeFavoriteFishList({ items: [{ fishId: '' }] })).toThrow(
      /Некорректный ID избранной рыбы/u,
    );
    expect(() => decodeFavoriteFishList({ items: [], userId: 'private' })).toThrow(
      /Некорректный ответ избранного/u,
    );
  });
});
