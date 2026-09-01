import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('./api-client', () => ({ apiRequest: mocks.apiRequest }));

import { getAdminFishingBase, updateFishingBaseFish } from './admin-catalog-api';

const BASE_PAYLOAD = {
  base: {
    id: 'base-1',
    name: 'Ахтуба',
    isActive: true,
    createdAt: '2026-08-08T12:00:00.000Z',
    updatedAt: '2026-08-08T12:00:00.000Z',
    locations: [],
    fish: [
      {
        id: 'fish-1',
        name: 'Сом',
        isActive: true,
        relationCreatedAt: '2026-08-08T12:00:00.000Z',
        minWeightGrams: 100,
        maxWeightGrams: null,
      },
    ],
  },
};

describe('ADMIN catalog BaseFish weights API', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('decodes nullable bounds in the ADMIN Base detail', async () => {
    mocks.apiRequest.mockResolvedValue(BASE_PAYLOAD);

    await expect(getAdminFishingBase('base-1')).resolves.toMatchObject({
      fish: [{ id: 'fish-1', minWeightGrams: 100, maxWeightGrams: null }],
    });
  });

  test('sends a partial PATCH and decodes the merged relation', async () => {
    mocks.apiRequest.mockResolvedValue({
      fishingBaseFish: {
        fishingBaseId: 'base/1',
        fishId: 'fish?1',
        minWeightGrams: null,
        maxWeightGrams: 2_000,
        createdAt: '2026-08-08T12:00:00.000Z',
      },
    });

    await expect(
      updateFishingBaseFish('base/1', 'fish?1', { minWeightGrams: null }),
    ).resolves.toMatchObject({ minWeightGrams: null, maxWeightGrams: 2_000 });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/admin/catalog/bases/base%2F1/fish/fish%3F1', {
      method: 'PATCH',
      body: JSON.stringify({ minWeightGrams: null }),
    });
  });

  test.each([
    { minWeightGrams: 0, maxWeightGrams: null },
    { minWeightGrams: 1.5, maxWeightGrams: null },
    { minWeightGrams: 200, maxWeightGrams: 100 },
    { minWeightGrams: null, maxWeightGrams: undefined },
  ])('rejects malformed ADMIN membership bounds: %o', async (bounds) => {
    mocks.apiRequest.mockResolvedValue({
      ...BASE_PAYLOAD,
      base: {
        ...BASE_PAYLOAD.base,
        fish: [{ ...BASE_PAYLOAD.base.fish[0], ...bounds }],
      },
    });

    await expect(getAdminFishingBase('base-1')).rejects.toThrow(
      'Сервер вернул некорректный ответ административного каталога',
    );
  });
});
