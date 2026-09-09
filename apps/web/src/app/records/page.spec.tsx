import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RecordsResponse } from '@/lib/records-api';

const mocks = vi.hoisted(() => ({ search: '', replace: vi.fn(), getRecords: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/records-api', async () => ({
  ...(await vi.importActual('@/lib/records-api')),
  getRecords: mocks.getRecords,
}));

import RecordsPage from './page';

const response: RecordsResponse = {
  week: {
    startsAt: '2026-09-06T19:00:00Z',
    endsAt: '2026-09-13T19:00:00Z',
    timezone: 'Europe/Moscow',
    serverNow: '2026-09-09T12:00:00Z',
  },
  sync: {
    status: 'CURRENT',
    observedAt: '2026-09-09T11:59:00Z',
    lastAttemptAt: '2026-09-09T11:59:00Z',
    lastSuccessAt: '2026-09-09T11:59:00Z',
  },
  items: [
    {
      fish: { id: 'green', name: 'Зелёная' },
      state: 'RECORD',
      record: {
        weightGrams: 800,
        waterbody: 'Волга',
        fishingBase: { id: 'base', name: 'Волга', isActive: true },
        playerName: 'Игрок',
        caughtAt: '2026-09-09T10:00:00Z',
      },
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: 200,
      headroomPercent: 20,
      status: 'CAN_BEAT',
    },
    {
      fish: { id: 'none', name: 'Без рекорда' },
      state: 'NO_RECORD',
      record: null,
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: null,
      headroomPercent: null,
      status: 'NO_RECORD',
    },
    {
      fish: { id: 'yellow', name: 'Жёлтая' },
      state: 'RECORD',
      record: {
        weightGrams: 995,
        waterbody: 'Неизвестная база',
        fishingBase: null,
        playerName: 'Player',
        caughtAt: '2026-09-09T10:00:00Z',
      },
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: 5,
      headroomPercent: 0.5,
      status: 'NEAR_MAX',
    },
    {
      fish: { id: 'red', name: 'Красная' },
      state: 'RECORD',
      record: {
        weightGrams: 1001,
        waterbody: 'Волга',
        fishingBase: { id: 'base', name: 'Волга', isActive: true },
        playerName: 'Player',
        caughtAt: '2026-09-09T10:00:00Z',
      },
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: -1,
      headroomPercent: -0.1,
      status: 'MUTANT',
    },
    {
      fish: { id: 'unknown-max', name: 'Без max' },
      state: 'RECORD',
      record: {
        weightGrams: 500,
        waterbody: 'Волга',
        fishingBase: null,
        playerName: 'Player',
        caughtAt: '2026-09-09T10:00:00Z',
      },
      normalMaxWeightGrams: null,
      maxBases: [],
      headroomGrams: null,
      headroomPercent: null,
      status: 'MAX_UNKNOWN',
    },
  ],
};

describe('RecordsPage', () => {
  beforeEach(() => {
    mocks.search = '';
    mocks.replace.mockReset();
    mocks.getRecords.mockResolvedValue(response);
  });

  test('renders the dense approved columns, default order and record-weight colors without bait', async () => {
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Рыба↕',
      'Рекорд недели↕',
      'Где пойман',
      'Игрок/дата',
      'Наш max',
      'База(ы) max',
      'Запас↕',
      'Статус',
    ]);
    expect(screen.queryByText('Наживка')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Без рекорда');
    expect(screen.getByText('800 г').className).toContain('badgeGreen');
    expect(screen.getByText('995 г').className).toContain('badgeYellow');
    expect(screen.getByText('1.001 кг').className).toContain('badgeRed');
    expect(screen.getByText('500 г').className).toContain('badgeNeutral');
    expect(screen.getByText('Нет данных о max')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Сбросить сортировку' })).toBeDisabled();
  });

  test('writes sorting to the URL and reset restores the exact default URL', async () => {
    mocks.search = 'sort=weight&direction=desc';
    render(<RecordsPage />);
    const reset = await screen.findByRole('button', { name: 'Сбросить сортировку' });
    fireEvent.click(reset);
    expect(mocks.replace).toHaveBeenCalledWith('/records', { scroll: false });
    fireEvent.click(screen.getByRole('button', { name: /Запас/u }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith('/records?sort=headroom&direction=desc', {
        scroll: false,
      }),
    );
  });
});
