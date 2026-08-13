import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import { getFish, listFishingBases } from './catalog-api';

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
    { fish: { id: 'fish-1', name: 'Сом', bases: [{ id: 1, name: 'Ахтуба' }] } },
  ])('rejects a malformed Fish detail payload: %o', async (payload) => {
    mocks.apiRequest.mockResolvedValue(payload);

    await expect(getFish('fish-1')).rejects.toThrow('Сервер вернул некорректный ответ каталога');
  });
});
