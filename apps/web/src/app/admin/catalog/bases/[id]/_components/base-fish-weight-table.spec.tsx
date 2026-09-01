import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  updateFishingBaseFish: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/lib/admin-catalog-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/admin-catalog-api')>();
  return { ...original, updateFishingBaseFish: mocks.updateFishingBaseFish };
});

import { BaseFishWeightTable } from './base-fish-weight-table';

const fish = [
  {
    id: 'fish-1',
    name: 'Амурский сом',
    isActive: true,
    relationCreatedAt: '2026-08-08T12:00:00.000Z',
    minWeightGrams: 100,
    maxWeightGrams: 2_000,
  },
  {
    id: 'fish-2',
    name: 'Щука',
    isActive: false,
    relationCreatedAt: '2026-08-08T12:00:00.000Z',
    minWeightGrams: null,
    maxWeightGrams: null,
  },
];

describe('BaseFishWeightTable', () => {
  beforeEach(() => {
    mocks.routerReplace.mockReset();
    mocks.updateFishingBaseFish.mockReset();
  });

  test('filters memberships and submits only the independently changed bound', async () => {
    const user = userEvent.setup();
    mocks.updateFishingBaseFish.mockResolvedValue({
      fishingBaseId: 'base-1',
      fishId: 'fish-1',
      minWeightGrams: 150,
      maxWeightGrams: 2_000,
      createdAt: '2026-08-08T12:00:00.000Z',
    });
    render(
      <BaseFishWeightTable baseId="base-1" fish={fish} removingFishId={null} onRemove={vi.fn()} />,
    );

    await user.type(screen.getByRole('searchbox', { name: 'Найти рыбу на базе' }), 'сом');
    expect(screen.getByRole('rowheader', { name: /Амурский сом/u })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: /Щука/u })).not.toBeInTheDocument();

    const minInput = screen.getByRole('spinbutton', { name: 'Минимальный вес, Амурский сом' });
    await user.clear(minInput);
    await user.type(minInput, '150');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(mocks.updateFishingBaseFish).toHaveBeenCalledWith('base-1', 'fish-1', {
        minWeightGrams: 150,
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено.');
  });

  test('maps an empty input to null and blocks a reversed merged pair locally', async () => {
    const user = userEvent.setup();
    mocks.updateFishingBaseFish.mockResolvedValue({
      fishingBaseId: 'base-1',
      fishId: 'fish-1',
      minWeightGrams: null,
      maxWeightGrams: 2_000,
      createdAt: '2026-08-08T12:00:00.000Z',
    });
    render(
      <BaseFishWeightTable
        baseId="base-1"
        fish={[fish[0]]}
        removingFishId={null}
        onRemove={vi.fn()}
      />,
    );

    const minInput = screen.getByRole('spinbutton', { name: 'Минимальный вес, Амурский сом' });
    await user.clear(minInput);
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(mocks.updateFishingBaseFish).toHaveBeenCalledWith('base-1', 'fish-1', {
        minWeightGrams: null,
      }),
    );

    mocks.updateFishingBaseFish.mockClear();
    await user.type(minInput, '2001');
    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Минимальный вес не должен превышать максимальный.',
    );
    expect(mocks.updateFishingBaseFish).not.toHaveBeenCalled();
  });
});
