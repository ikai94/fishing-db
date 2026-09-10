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
      fish: { id: 'green', name: 'Зелёная', isRarest: true },
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
      fish: { id: 'none', name: 'Без рекорда', isRarest: false },
      state: 'NO_RECORD',
      record: null,
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: null,
      headroomPercent: null,
      status: 'NO_RECORD',
    },
    {
      fish: { id: 'yellow', name: 'Жёлтая', isRarest: false },
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
      fish: { id: 'red', name: 'Красная', isRarest: false },
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
      fish: { id: 'maximum', name: 'Максимальная', isRarest: false },
      state: 'RECORD',
      record: {
        weightGrams: 1000,
        waterbody: 'Волга',
        fishingBase: { id: 'base', name: 'Волга', isActive: true },
        playerName: 'Player',
        caughtAt: '2026-09-09T10:00:00Z',
      },
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: 0,
      headroomPercent: 0,
      status: 'MAXIMUM',
    },
    {
      fish: { id: 'unknown-max', name: 'Без max', isRarest: false },
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
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Рыба↕',
      'Рекорд недели↕',
      'Наш max',
      'Запас↕',
      'Где пойман↕',
      'База(ы) max↕',
      'Игрок/дата',
      'Статус',
    ]);
    expect(screen.queryByText('Наживка')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Без рекорда');
    expect(screen.getByText('800 г').className).toContain('badgeGreen');
    expect(screen.getByText('995 г').className).toContain('badgeYellow');
    expect(screen.getByText('1.001 кг').className).toContain('badgeRed');
    expect(within(table).getByText('1 кг', { selector: 'span' }).className).toContain(
      'badgeYellow',
    );
    expect(screen.getByText('500 г').className).toContain('badgeNeutral');
    expect(screen.getByText('Нет данных о max')).toBeVisible();
    expect(within(table).getByText('Можно побить').className).toContain('statusGreen');
    expect(within(table).getByText('Почти максимум').className).toContain('statusYellow');
    expect(within(table).getByText('Мутант').className).toContain('statusRed');
    expect(within(table).getByText('Максимал').className).toContain('statusYellow');
    const rareFishLink = screen.getByRole('link', { name: 'Зелёная' });
    expect(rareFishLink.className).toContain('rarestFishLink');
    expect(within(rareFishLink).getByTitle('Редчайший вид').className).toContain('rarestDot');
    expect(rareFishLink.closest('tr')?.className).not.toContain('rarest');
    const baseFilter = screen.getByRole('combobox', { name: 'Где пойман' });
    expect(baseFilter).toHaveValue('');
    expect(
      within(baseFilter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Все базы', 'Волга']);
    fireEvent.change(baseFilter, { target: { value: 'base' } });
    expect(mocks.replace).toHaveBeenCalledWith('/records?baseId=base', { scroll: false });
    expect(screen.getByRole('button', { name: 'Сбросить сортировку' })).toBeDisabled();
    const statusCheckboxes = within(screen.getByRole('group', { name: 'Статус' })).getAllByRole(
      'checkbox',
    );
    expect(statusCheckboxes.map((checkbox) => checkbox.parentElement?.textContent)).toEqual([
      'Мутант',
      'Почти максимум',
      'Можно побить',
      'Максимал',
    ]);
    for (const checkbox of statusCheckboxes) expect(checkbox).not.toBeChecked();
    const hideRarest = screen.getByRole('checkbox', { name: 'Скрыть редчайших' });
    expect(hideRarest).not.toBeChecked();
    fireEvent.click(hideRarest);
    expect(mocks.replace).toHaveBeenCalledWith('/records?hideRarest=true', { scroll: false });
  });

  test('filters by any selected status and stores selections canonically in the URL', async () => {
    mocks.search = 'status=MUTANT';
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).queryByText('Без рекорда')).not.toBeInTheDocument();

    expect(screen.getByRole('checkbox', { name: 'Мутант' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Почти максимум' }));
    expect(mocks.replace).toHaveBeenCalledWith('/records?status=MUTANT&status=NEAR_MAX', {
      scroll: false,
    });
  });

  test('filters by two statuses and can add the third selection', async () => {
    mocks.search = 'status=MUTANT&status=NEAR_MAX';
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('Жёлтая')).toBeVisible();
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).queryByText('Зелёная')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Можно побить' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?status=MUTANT&status=NEAR_MAX&status=CAN_BEAT',
      { scroll: false },
    );
  });

  test('all four selections exclude non-selectable statuses', async () => {
    mocks.search = 'status=MUTANT&status=NEAR_MAX&status=CAN_BEAT&status=MAXIMUM';
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Зелёная')).toBeVisible();
    expect(within(table).getByText('Жёлтая')).toBeVisible();
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).getByText('Максимальная')).toBeVisible();
    expect(within(table).queryByText('Без рекорда')).not.toBeInTheDocument();
    expect(within(table).queryByText('Без max')).not.toBeInTheDocument();
    for (const checkbox of within(screen.getByRole('group', { name: 'Статус' })).getAllByRole(
      'checkbox',
    )) {
      expect(checkbox).toBeChecked();
    }
    expect(screen.getByRole('checkbox', { name: 'Скрыть редчайших' })).not.toBeChecked();
  });

  test('hides rarest Fish only when the URL-backed toggle is enabled', async () => {
    mocks.search = 'hideRarest=true';
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).queryByText('Зелёная')).not.toBeInTheDocument();
    expect(within(table).getByText('Без рекорда')).toBeVisible();

    const toggle = screen.getByRole('checkbox', { name: 'Скрыть редчайших' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(mocks.replace).toHaveBeenCalledWith('/records', { scroll: false });
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
    fireEvent.click(screen.getByRole('button', { name: 'База(ы) max' }));
    expect(mocks.replace).toHaveBeenCalledWith('/records?sort=maxBase&direction=asc', {
      scroll: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Где пойман' }));
    expect(mocks.replace).toHaveBeenCalledWith('/records?sort=fishingBase&direction=asc', {
      scroll: false,
    });
  });

  test('toggles max-Base sorting from the URL to descending', async () => {
    mocks.search = 'sort=maxBase&direction=asc';
    render(<RecordsPage />);
    const sortButton = await screen.findByRole('button', { name: 'База(ы) max' });
    expect(sortButton.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(sortButton);
    expect(mocks.replace).toHaveBeenCalledWith('/records?sort=maxBase&direction=desc', {
      scroll: false,
    });
  });

  test('toggles caught-at Base sorting from the URL to descending', async () => {
    mocks.search = 'sort=fishingBase&direction=asc';
    render(<RecordsPage />);
    const sortButton = await screen.findByRole('button', { name: 'Где пойман' });
    expect(sortButton.closest('th')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(sortButton);
    expect(mocks.replace).toHaveBeenCalledWith('/records?sort=fishingBase&direction=desc', {
      scroll: false,
    });
  });

  test('filters by caught-at Base and preserves it while sorting and resetting sort', async () => {
    mocks.search =
      'baseId=base&sort=weight&direction=desc&status=MUTANT&status=CAN_BEAT&hideRarest=true';
    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).queryByText('Зелёная')).not.toBeInTheDocument();
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).queryByText('Без рекорда')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Скрыть редчайших' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Рыба' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=name&direction=asc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Рекорд недели' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=weight&direction=asc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить сортировку' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: /Запас/u }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=headroom&direction=desc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: 'База(ы) max' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=maxBase&direction=asc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Где пойман' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=fishingBase&direction=asc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Почти максимум' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=weight&direction=desc&hideRarest=true&status=MUTANT&status=NEAR_MAX&status=CAN_BEAT',
      { scroll: false },
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Где пойман' }), {
      target: { value: '' },
    });
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?sort=weight&direction=desc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Скрыть редчайших' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=weight&direction=desc&status=MUTANT&status=CAN_BEAT',
      { scroll: false },
    );
  });
});
