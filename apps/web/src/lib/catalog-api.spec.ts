import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import { getFish, listFish, listFishingBases } from './catalog-api';

describe('public catalog API', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('decodes active Location and Fish counts for Base summaries', async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [
        {
          id: 'base-1',
          name: 'Ахтуба',
          locationsCount: 12,
          fishCount: 29,
        },
      ],
    });

    await expect(listFishingBases()).resolves.toEqual([
      {
        id: 'base-1',
        name: 'Ахтуба',
        locationsCount: 12,
        fishCount: 29,
      },
    ]);
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catalog/bases', { signal: undefined });
  });

  test.each([
    { locationsCount: 1.5, fishCount: 3 },
    { locationsCount: 1, fishCount: -1 },
    { locationsCount: 1 },
  ])('rejects malformed Base counts: %o', async (counts) => {
    mocks.apiRequest.mockResolvedValue({
      items: [{ id: 'base-1', name: 'Ахтуба', ...counts }],
    });

    await expect(listFishingBases()).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });

  test('decodes Fish detail and forwards an encoded id with the caller signal', async () => {
    mocks.apiRequest.mockResolvedValue({
      fish: {
        id: 'fish-1',
        name: 'Сом',
        image: null,
        bases: [
          { id: 'base-1', name: 'Ахтуба' },
          { id: 'base-2', name: 'Амазония' },
        ],
      },
    });
    const controller = new AbortController();

    await expect(getFish('fish/id?', controller.signal)).resolves.toEqual({
      id: 'fish-1',
      name: 'Сом',
      image: null,
      bases: [
        { id: 'base-1', name: 'Ахтуба' },
        { id: 'base-2', name: 'Амазония' },
      ],
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catalog/fish/fish%2Fid%3F', {
      signal: controller.signal,
    });
  });

  test.each([
    {},
    { fish: { id: 'fish-1', name: 'Сом' } },
    { fish: { id: 'fish-1', name: 'Сом', image: null, bases: [{ id: 1, name: 'Ахтуба' }] } },
    { fish: { id: 'fish-1', name: 'Сом', image: {}, bases: [] } },
  ])('rejects a malformed Fish detail payload: %o', async (payload) => {
    mocks.apiRequest.mockResolvedValue(payload);

    await expect(getFish('fish-1')).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });

  test('decodes nullable application-owned Fish images in the public list', async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [
        { id: 'fish-1', name: 'Сом', image: null },
        { id: 'fish-2', name: 'Щука', image: { url: '/fish-images/fish-2.webp' } },
      ],
    });

    await expect(listFish()).resolves.toEqual([
      { id: 'fish-1', name: 'Сом', image: null },
      { id: 'fish-2', name: 'Щука', image: { url: '/fish-images/fish-2.webp' } },
    ]);
  });

  test.each([
    undefined,
    '',
    { url: '' },
    { url: 'https://rus-fishsoft.ru/fish/1.png' },
    { url: '//rus-fishsoft.ru/fish/1.png' },
    { url: '/fish-images/fish-1.webp', officialFishImageKey: 1 },
  ])('rejects malformed or non-application Fish image delivery: %o', async (image) => {
    mocks.apiRequest.mockResolvedValue({ items: [{ id: 'fish-1', name: 'Сом', image }] });

    await expect(listFish()).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });
});
