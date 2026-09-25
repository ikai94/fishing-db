import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RecordsResponse } from '@/lib/records-api';

const mocks = vi.hoisted(() => ({
  search: '',
  replace: vi.fn(),
  getRecords: vi.fn(),
  getCurrentUser: vi.fn(),
  getAdminRecordNotes: vi.fn(),
  updateAdminRecordNote: vi.fn(),
  getAdminWrongMaxIssues: vi.fn(),
  updateAdminNightMark: vi.fn(),
  updateAdminWrongMaxIssue: vi.fn(),
  clearAdminWrongMaxIssue: vi.fn(),
  getFavoriteFish: vi.fn(),
  addFavoriteFish: vi.fn(),
  removeFavoriteFish: vi.fn(),
}));
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
  getAdminRecordNotes: mocks.getAdminRecordNotes,
  updateAdminRecordNote: mocks.updateAdminRecordNote,
  getAdminWrongMaxIssues: mocks.getAdminWrongMaxIssues,
  updateAdminNightMark: mocks.updateAdminNightMark,
  updateAdminWrongMaxIssue: mocks.updateAdminWrongMaxIssue,
  clearAdminWrongMaxIssue: mocks.clearAdminWrongMaxIssue,
}));
vi.mock('@/lib/fish-favorites-api', () => ({
  getFavoriteFish: mocks.getFavoriteFish,
  addFavoriteFish: mocks.addFavoriteFish,
  removeFavoriteFish: mocks.removeFavoriteFish,
}));
vi.mock('@/lib/auth-api', async () => ({
  ...(await vi.importActual('@/lib/auth-api')),
  getCurrentUser: mocks.getCurrentUser,
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
      fish: { id: 'green', name: 'Зелёная', isRarest: true, isNightBiting: true },
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
      fish: { id: 'none', name: 'Без рекорда', isRarest: false, isNightBiting: false },
      state: 'NO_RECORD',
      record: null,
      normalMaxWeightGrams: 1000,
      maxBases: [{ id: 'base', name: 'Волга', isActive: true }],
      headroomGrams: null,
      headroomPercent: null,
      status: 'NO_RECORD',
    },
    {
      fish: { id: 'yellow', name: 'Жёлтая', isRarest: false, isNightBiting: false },
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
      fish: { id: 'red', name: 'Красная', isRarest: false, isNightBiting: true },
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
      fish: { id: 'maximum', name: 'Максимальная', isRarest: false, isNightBiting: false },
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
      fish: { id: 'unknown-max', name: 'Без max', isRarest: false, isNightBiting: false },
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
    mocks.getCurrentUser.mockReset();
    mocks.getCurrentUser.mockResolvedValue({
      id: 'user',
      email: 'user@example.ru',
      nickname: 'User',
      role: 'USER',
      isBanned: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    mocks.getAdminRecordNotes.mockReset();
    mocks.getAdminRecordNotes.mockResolvedValue({ items: [] });
    mocks.updateAdminRecordNote.mockReset();
    mocks.getAdminWrongMaxIssues.mockReset();
    mocks.getAdminWrongMaxIssues.mockResolvedValue({ items: [] });
    mocks.updateAdminNightMark.mockReset();
    mocks.updateAdminNightMark.mockImplementation((fishId: string, isNightBiting: boolean) =>
      Promise.resolve({ fish: { fishId, isNightBiting } }),
    );
    mocks.updateAdminWrongMaxIssue.mockReset();
    mocks.clearAdminWrongMaxIssue.mockReset();
    mocks.clearAdminWrongMaxIssue.mockResolvedValue(undefined);
    mocks.getFavoriteFish.mockReset();
    mocks.getFavoriteFish.mockResolvedValue({ items: [] });
    mocks.addFavoriteFish.mockReset();
    mocks.addFavoriteFish.mockResolvedValue({ fishId: 'green' });
    mocks.removeFavoriteFish.mockReset();
    mocks.removeFavoriteFish.mockResolvedValue(undefined);
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
    expect(screen.queryByRole('columnheader', { name: 'Заметка' })).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Без рекорда');
    expect(screen.getByText('800 г').className).toContain('badgeGreen');
    expect(screen.getByText('995 г').className).toContain('badgeYellow');
    expect(screen.getByText('1.001 кг').className).toContain('badgeRed');
    expect(
      within(table)
        .getAllByText('1 кг', { selector: 'span' })
        .some((element) => element.className.includes('badgeYellow')),
    ).toBe(true);
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
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalledOnce());
    expect(mocks.getAdminRecordNotes).not.toHaveBeenCalled();
  });

  test('ADMIN sees the note column after max Bases and edits, cancels and clears inline', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'admin',
      email: 'admin@example.ru',
      nickname: 'Admin',
      role: 'ADMIN',
      isBanned: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    mocks.getAdminRecordNotes.mockResolvedValue({
      items: [{ fishId: 'green', note: 'Старая заметка' }],
    });
    let resolveSave: (value: { note: { fishId: string; note: string | null } }) => void = () => {
      throw new Error('Save resolver was not initialized');
    };
    mocks.updateAdminRecordNote
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          }),
      )
      .mockResolvedValueOnce({ note: { fishId: 'green', note: null } });

    render(<RecordsPage />);
    const table = await screen.findByRole('table');
    await screen.findByText('Старая заметка');
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
      'Заметка',
      'Игрок/дата',
      'Статус',
    ]);
    const adminRow = screen.getByRole('link', { name: 'Зелёная' }).closest('tr');
    expect(adminRow).not.toBeNull();
    expect(within(adminRow!).getAllByRole('cell')[4]).toHaveTextContent('Волга');
    expect(within(adminRow!).getAllByRole('cell')[5]).toHaveTextContent('Старая заметка');

    const editButton = screen.getByRole('button', { name: 'Изменить заметку' });
    expect(editButton).toHaveAttribute('title', 'Изменить заметку');
    expect(editButton).toHaveTextContent('');
    fireEvent.click(editButton);
    const input = screen.getByRole('textbox', { name: 'Заметка для Зелёная' });
    const saveButton = screen.getByRole('button', { name: 'Сохранить заметку' });
    const cancelButton = screen.getByRole('button', { name: 'Отменить редактирование' });
    expect(saveButton).toHaveAttribute('title', 'Сохранить заметку');
    expect(cancelButton).toHaveAttribute('title', 'Отменить редактирование');
    expect(saveButton).toHaveTextContent('');
    expect(cancelButton).toHaveTextContent('');
    fireEvent.change(input, { target: { value: 'Не сохранять' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('Старая заметка')).toBeVisible();
    expect(mocks.updateAdminRecordNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Изменить заметку' }));
    const savingInput = screen.getByRole('textbox', { name: 'Заметка для Зелёная' });
    fireEvent.change(savingInput, { target: { value: 'Новая заметка' } });
    fireEvent.keyDown(savingInput, { key: 'Enter' });
    expect(mocks.updateAdminRecordNote).toHaveBeenCalledTimes(1);
    expect(mocks.updateAdminRecordNote).toHaveBeenCalledWith('green', 'Новая заметка');
    expect(savingInput).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Сохранить заметку' })).toBeDisabled();
    fireEvent.keyDown(savingInput, { key: 'Enter' });
    expect(mocks.updateAdminRecordNote).toHaveBeenCalledTimes(1);
    resolveSave({ note: { fishId: 'green', note: 'Новая заметка' } });
    await screen.findByText('Новая заметка');

    fireEvent.click(screen.getByRole('button', { name: 'Изменить заметку' }));
    const clearingInput = screen.getByRole('textbox', { name: 'Заметка для Зелёная' });
    fireEvent.change(clearingInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заметку' }));
    await waitFor(() => expect(mocks.updateAdminRecordNote).toHaveBeenCalledTimes(2));
    expect(mocks.updateAdminRecordNote).toHaveBeenLastCalledWith('green', '');
    const addButton = await within(adminRow!).findByRole('button', { name: 'Добавить заметку' });
    expect(addButton).toHaveAttribute('title', 'Добавить заметку');
    expect(addButton).toHaveTextContent('');
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

  test('filters favorites from one list request and preserves all existing URL filters and sorting', async () => {
    mocks.search =
      'baseId=base&sort=weight&direction=desc&status=MUTANT&status=CAN_BEAT&hideRarest=true&favorites=true';
    mocks.getFavoriteFish.mockResolvedValue({
      items: [{ fishId: 'green' }, { fishId: 'red' }],
    });

    render(<RecordsPage />);
    fireEvent.click(await screen.findByText(/^Метки/u));
    const favoritesFilter = screen.getByRole('checkbox', { name: '★ Избранные' });
    expect(favoritesFilter).toBeChecked();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).queryByText('Зелёная')).not.toBeInTheDocument();
    expect(mocks.getFavoriteFish).toHaveBeenCalledTimes(1);
    expect(mocks.getFavoriteFish).toHaveBeenCalledWith(expect.any(AbortSignal));

    fireEvent.click(favoritesFilter);
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?baseId=base&sort=weight&direction=desc&status=MUTANT&status=CAN_BEAT&hideRarest=true',
      { scroll: false },
    );
  });

  test('does not expose favorite controls or load favorites for a guest', async () => {
    mocks.getCurrentUser.mockRejectedValue(new Error('unauthorized'));

    render(<RecordsPage />);
    await screen.findByRole('table');
    await waitFor(() => expect(mocks.getCurrentUser).toHaveBeenCalledOnce());
    expect(mocks.getFavoriteFish).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox', { name: '★ Избранные' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /избранное/u })).not.toBeInTheDocument();
  });

  test('optimistically adds a favorite, blocks duplicate mutation and rolls back on failure', async () => {
    let rejectAdd: (reason?: unknown) => void = () => {
      throw new Error('Add rejecter was not initialized');
    };
    mocks.addFavoriteFish.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectAdd = reject;
        }),
    );

    render(<RecordsPage />);
    const addButton = await screen.findByRole('button', {
      name: 'Добавить Зелёная в избранное',
    });
    fireEvent.click(addButton);
    const optimisticButton = screen.getByRole('button', {
      name: 'Удалить Зелёная из избранного',
    });
    expect(optimisticButton).toBeDisabled();
    fireEvent.click(optimisticButton);
    expect(mocks.addFavoriteFish).toHaveBeenCalledTimes(1);
    expect(mocks.addFavoriteFish).toHaveBeenCalledWith('green');

    rejectAdd(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить избранное.');
    expect(screen.getByRole('button', { name: 'Добавить Зелёная в избранное' })).toBeEnabled();
  });

  test('optimistically removes an existing favorite', async () => {
    mocks.getFavoriteFish.mockResolvedValue({ items: [{ fishId: 'green' }] });
    let resolveRemove: () => void = () => {
      throw new Error('Remove resolver was not initialized');
    };
    mocks.removeFavoriteFish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );

    render(<RecordsPage />);
    const removeButton = await screen.findByRole('button', {
      name: 'Удалить Зелёная из избранного',
    });
    fireEvent.click(removeButton);
    expect(screen.getByRole('button', { name: 'Добавить Зелёная в избранное' })).toBeDisabled();
    expect(mocks.removeFavoriteFish).toHaveBeenCalledOnce();
    expect(mocks.removeFavoriteFish).toHaveBeenCalledWith('green');
    resolveRemove();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Добавить Зелёная в избранное' })).toBeEnabled(),
    );
  });

  test('shows public night marks and only authenticated non-admin mark choices', async () => {
    render(<RecordsPage />);
    await screen.findByRole('button', { name: 'Добавить Зелёная в избранное' });

    expect(screen.getByLabelText('Ночная рыба: Зелёная')).toBeVisible();
    expect(screen.getByLabelText('Ночная рыба: Красная')).toBeVisible();
    expect(screen.queryByRole('button', { name: /ночную метку/u })).not.toBeInTheDocument();
    expect(mocks.getAdminWrongMaxIssues).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/^Метки/u));
    const marks = within(screen.getByRole('group', { name: 'Метки' }));
    expect(marks.getByRole('checkbox', { name: '★ Избранные' })).not.toBeChecked();
    expect(marks.getByRole('checkbox', { name: '🌙 Ночные' })).not.toBeChecked();
    expect(marks.queryByRole('checkbox', { name: '⚠ Неверный наш max' })).not.toBeInTheDocument();
  });

  test('ADMIN toggles a moon optimistically, blocks duplicates and rolls back on failure', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'admin',
      email: 'admin@example.ru',
      nickname: 'Admin',
      role: 'ADMIN',
      isBanned: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    let rejectUpdate: (reason?: unknown) => void = () => {
      throw new Error('Night rejecter was not initialized');
    };
    mocks.updateAdminNightMark.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject;
        }),
    );

    render(<RecordsPage />);
    const activeMoon = await screen.findByRole('button', {
      name: 'Снять ночную метку с Зелёная',
    });
    fireEvent.click(activeMoon);
    const optimisticMoon = screen.getByRole('button', {
      name: 'Отметить как ночную Зелёная',
    });
    expect(optimisticMoon).toBeDisabled();
    fireEvent.click(optimisticMoon);
    expect(mocks.updateAdminNightMark).toHaveBeenCalledTimes(1);
    expect(mocks.updateAdminNightMark).toHaveBeenCalledWith('green', false);

    rejectUpdate(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось обновить ночную метку.');
    expect(screen.getByRole('button', { name: 'Снять ночную метку с Зелёная' })).toBeEnabled();
  });

  test('ADMIN edits and clears a wrong-max issue without replacing the displayed max', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: 'admin',
      email: 'admin@example.ru',
      nickname: 'Admin',
      role: 'ADMIN',
      isBanned: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    mocks.getAdminWrongMaxIssues.mockResolvedValue({
      items: [
        {
          fishId: 'green',
          expectedWeightGrams: 1200,
          note: 'Проверить каталог',
          createdAt: '2026-09-20T00:00:00Z',
          updatedAt: '2026-09-20T00:00:00Z',
        },
      ],
    });
    mocks.updateAdminWrongMaxIssue.mockResolvedValue({
      issue: {
        fishId: 'green',
        expectedWeightGrams: 1300,
        note: 'Исправить вручную',
        createdAt: '2026-09-20T00:00:00Z',
        updatedAt: '2026-09-25T00:00:00Z',
      },
    });

    render(<RecordsPage />);
    const issueButton = await screen.findByRole('button', {
      name: 'Изменить проблему Наш max для Зелёная',
    });
    const greenRow = screen.getByRole('link', { name: 'Зелёная' }).closest('tr');
    expect(greenRow).not.toBeNull();
    expect(within(greenRow!).getByText('1 кг')).toBeVisible();
    expect(issueButton).toHaveAttribute('title', expect.stringContaining('1.2 кг'));

    fireEvent.click(issueButton);
    const weight = screen.getByRole('spinbutton', {
      name: 'Ожидаемый правильный вес для Зелёная',
    });
    const note = screen.getByRole('textbox', {
      name: 'Пояснение проблемы max для Зелёная',
    });
    expect(weight).toHaveValue(1200);
    expect(note).toHaveValue('Проверить каталог');
    fireEvent.change(weight, { target: { value: '1300' } });
    fireEvent.change(note, { target: { value: 'Исправить вручную' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить проблему max' }));
    await waitFor(() =>
      expect(mocks.updateAdminWrongMaxIssue).toHaveBeenCalledWith(
        'green',
        1300,
        'Исправить вручную',
      ),
    );
    expect(within(greenRow!).getByText('1 кг')).toBeVisible();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Изменить проблему Наш max для Зелёная' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Снять проблему max' }));
    await waitFor(() => expect(mocks.clearAdminWrongMaxIssue).toHaveBeenCalledWith('green'));
    expect(
      await screen.findByRole('button', { name: 'Отметить неверный Наш max для Зелёная' }),
    ).toBeVisible();
    expect(within(greenRow!).getByText('1 кг')).toBeVisible();
  });

  test('combines all ADMIN marks with AND semantics and preserves URL state', async () => {
    mocks.search = 'sort=weight&direction=desc&favorites=true&night=true&wrongMax=true';
    mocks.getCurrentUser.mockResolvedValue({
      id: 'admin',
      email: 'admin@example.ru',
      nickname: 'Admin',
      role: 'ADMIN',
      isBanned: false,
      createdAt: '2026-09-01T00:00:00Z',
    });
    mocks.getFavoriteFish.mockResolvedValue({
      items: [{ fishId: 'green' }, { fishId: 'red' }],
    });
    mocks.getAdminWrongMaxIssues.mockResolvedValue({
      items: [
        {
          fishId: 'red',
          expectedWeightGrams: null,
          note: null,
          createdAt: '2026-09-20T00:00:00Z',
          updatedAt: '2026-09-20T00:00:00Z',
        },
      ],
    });

    render(<RecordsPage />);
    fireEvent.click(await screen.findByText(/^Метки/u));
    const marks = within(screen.getByRole('group', { name: 'Метки' }));
    expect(marks.getByRole('checkbox', { name: '★ Избранные' })).toBeChecked();
    expect(marks.getByRole('checkbox', { name: '🌙 Ночные' })).toBeChecked();
    expect(marks.getByRole('checkbox', { name: '⚠ Неверный наш max' })).toBeChecked();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('Красная')).toBeVisible();
    expect(within(table).queryByText('Зелёная')).not.toBeInTheDocument();

    fireEvent.click(marks.getByRole('checkbox', { name: '🌙 Ночные' }));
    expect(mocks.replace).toHaveBeenCalledWith(
      '/records?sort=weight&direction=desc&favorites=true&wrongMax=true',
      { scroll: false },
    );
  });
});
