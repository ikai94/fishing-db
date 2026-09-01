import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiBaseUrl: 'http://localhost:3001',
  apiRequest: mocks.apiRequest,
}));

import { getCatalogSummary, getFish, listFish, listFishingBases } from './catalog-api';

const IMAGE_HASH = 'a'.repeat(64);
const IMAGE_PATH = `/api/v1/fish-images/101-${IMAGE_HASH}.png`;
const IMAGE_URL = `http://localhost:3001${IMAGE_PATH}`;

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

  test('decodes the exact count-only public catalog summary and forwards the signal', async () => {
    mocks.apiRequest.mockResolvedValue({ catchReportsCount: 31_337, registeredUsersCount: 42 });
    const controller = new AbortController();

    await expect(getCatalogSummary(controller.signal)).resolves.toEqual({
      catchReportsCount: 31_337,
      registeredUsersCount: 42,
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catalog/summary', {
      signal: controller.signal,
    });
  });

  test.each([
    {},
    { catchReportsCount: -1, registeredUsersCount: 2 },
    { catchReportsCount: 1.5, registeredUsersCount: 2 },
    { catchReportsCount: 1, registeredUsersCount: Number.MAX_SAFE_INTEGER + 1 },
    { catchReportsCount: 1, registeredUsersCount: 2, users: [] },
  ])('rejects malformed or expanded catalog summary payloads: %o', async (payload) => {
    mocks.apiRequest.mockResolvedValue(payload);

    await expect(getCatalogSummary()).rejects.toThrow('Сервер вернул некорректный ответ каталога');
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
          { id: 'base-1', name: 'Ахтуба', minWeightGrams: 100, maxWeightGrams: 20_000 },
          { id: 'base-2', name: 'Амазония', minWeightGrams: null, maxWeightGrams: 25_000 },
        ],
      },
    });
    const controller = new AbortController();

    await expect(getFish('fish/id?', controller.signal)).resolves.toEqual({
      id: 'fish-1',
      name: 'Сом',
      image: null,
      bases: [
        { id: 'base-1', name: 'Ахтуба', minWeightGrams: 100, maxWeightGrams: 20_000 },
        { id: 'base-2', name: 'Амазония', minWeightGrams: null, maxWeightGrams: 25_000 },
      ],
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catalog/fish/fish%2Fid%3F', {
      signal: controller.signal,
    });
  });

  test.each([
    {},
    { fish: { id: 'fish-1', name: 'Сом' } },
    {
      fish: {
        id: 'fish-1',
        name: 'Сом',
        image: null,
        bases: [{ id: 1, name: 'Ахтуба', minWeightGrams: 1, maxWeightGrams: 2 }],
      },
    },
    { fish: { id: 'fish-1', name: 'Сом', image: {}, bases: [] } },
  ])('rejects a malformed Fish detail payload: %o', async (payload) => {
    mocks.apiRequest.mockResolvedValue(payload);

    await expect(getFish('fish-1')).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });

  test.each([
    { id: 'base-1', name: 'Ахтуба', minWeightGrams: 100 },
    { id: 'base-1', name: 'Ахтуба', minWeightGrams: 0, maxWeightGrams: 100 },
    { id: 'base-1', name: 'Ахтуба', minWeightGrams: 200, maxWeightGrams: 100 },
  ])('rejects malformed Fish Base weight bounds: %o', async (base) => {
    mocks.apiRequest.mockResolvedValue({
      fish: { id: 'fish-1', name: 'Сом', image: null, bases: [base] },
    });
    await expect(getFish('fish-1')).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });

  test('decodes nullable application-owned Fish images in the public list', async () => {
    mocks.apiRequest.mockResolvedValue({
      items: [
        { id: 'fish-1', name: 'Сом', image: null },
        { id: 'fish-2', name: 'Щука', image: { url: IMAGE_PATH } },
      ],
    });

    await expect(listFish()).resolves.toEqual([
      { id: 'fish-1', name: 'Сом', image: null },
      { id: 'fish-2', name: 'Щука', image: { url: IMAGE_URL } },
    ]);
  });

  test.each([
    undefined,
    '',
    { url: '' },
    { url: 'https://rus-fishsoft.ru/fish/1.png' },
    { url: '//rus-fishsoft.ru/fish/1.png' },
    { url: '/fish-images/fish-1.webp' },
    { url: `/api/v1/fish-images/0-${IMAGE_HASH}.png` },
    { url: `/api/v1/fish-images/101-${IMAGE_HASH.toUpperCase()}.png` },
    { url: `${IMAGE_PATH}?download=1` },
    { url: IMAGE_PATH, officialFishImageKey: 101 },
  ])('rejects malformed or non-application Fish image delivery: %o', async (image) => {
    mocks.apiRequest.mockResolvedValue({ items: [{ id: 'fish-1', name: 'Сом', image }] });

    await expect(listFish()).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });
});
