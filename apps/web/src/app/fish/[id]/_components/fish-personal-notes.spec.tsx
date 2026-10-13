import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { getCurrentUser, type AuthUser } from '@/lib/auth-api';
import { getFishPersonalNotes } from '@/lib/base-fish-notebook-api';
import { ApiError } from '@/lib/api-client';
import { FishPersonalNotes } from './fish-personal-notes';

vi.mock('@/lib/auth-api', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/base-fish-notebook-api', () => ({ getFishPersonalNotes: vi.fn() }));

const admin: AuthUser = {
  id: 'admin',
  email: 'admin@example.ru',
  nickname: 'Admin',
  role: 'ADMIN',
  isBanned: false,
  createdAt: '2026-10-13',
};
const note = '  Первая строка\n\tВторая  ';
const data = {
  rows: [
    { base: { id: 'base-a', name: 'База А' }, noteText: note },
    { base: { id: 'base-b', name: 'База Б' }, noteText: null },
    { base: { id: 'base-c', name: 'База В' }, noteText: '' },
    { base: { id: 'base-d', name: 'База Г' }, noteText: ' \n\t' },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(admin);
  vi.mocked(getFishPersonalNotes).mockResolvedValue(data);
});

/** Моделирует нативное раскрытие details в jsdom, где события toggle доставляются вручную. */
async function expand() {
  const heading = await screen.findByRole('heading', { name: 'Личные заметки' });
  const details = heading.closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  return details;
}

test('starts collapsed, loads all bases on expansion and preserves read-only note formatting', async () => {
  render(<FishPersonalNotes fishId="fish" />);
  const heading = await screen.findByRole('heading', { name: 'Личные заметки' });
  expect(heading.closest('details')).not.toHaveAttribute('open');
  expect(getFishPersonalNotes).not.toHaveBeenCalled();
  const details = await expand();
  await screen.findByRole('table', { name: 'Личные заметки по базам' });
  expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
    'База',
    'Заметка',
  ]);
  expect(screen.getAllByRole('link')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'База А' })).toHaveAttribute('href', '/bases/base-a');
  expect(screen.getByRole('link', { name: 'База Б' })).toHaveAttribute('href', '/bases/base-b');
  expect(screen.getAllByText('Нет заметки')).toHaveLength(3);
  expect(screen.getByText('Первая строка Вторая').textContent).toBe(note);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(getFishPersonalNotes).toHaveBeenCalledWith('fish', expect.any(AbortSignal));
  details.open = false;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
  await expand();
  await waitFor(() => expect(getFishPersonalNotes).toHaveBeenCalledTimes(2));
});

test.each([null, { ...admin, role: 'USER' as const }, { ...admin, isBanned: true }])(
  'hides notes and never fetches them for denied actors: %j',
  async (actor) => {
    if (actor === null) vi.mocked(getCurrentUser).mockRejectedValue(new ApiError(401, {}));
    else vi.mocked(getCurrentUser).mockResolvedValue(actor);
    const view = render(<FishPersonalNotes fishId="fish" />);
    await act(async () => {});
    expect(view.container).toBeEmptyDOMElement();
    expect(getFishPersonalNotes).not.toHaveBeenCalled();
  },
);

test.each([401, 403])(
  'removes the section when protected read rejects access (%s)',
  async (status) => {
    vi.mocked(getFishPersonalNotes).mockRejectedValue(new ApiError(status, {}));
    render(<FishPersonalNotes fishId="fish" />);
    await expand();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Личные заметки' })).not.toBeInTheDocument(),
    );
  },
);

test('aborts a closed request and ignores its late response after reopening or Fish navigation', async () => {
  let resolveOld!: (value: typeof data) => void;
  vi.mocked(getFishPersonalNotes).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve;
    }),
  );
  const view = render(<FishPersonalNotes key="fish" fishId="fish" />);
  const details = await expand();
  await waitFor(() => expect(getFishPersonalNotes).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(getFishPersonalNotes).mock.calls[0]![1]!;
  details.open = false;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(signal.aborted).toBe(true));
  view.rerender(<FishPersonalNotes key="other-fish" fishId="other-fish" />);
  await expand();
  await screen.findByRole('table');
  await act(async () =>
    resolveOld({ rows: [{ base: { id: 'old', name: 'Старая' }, noteText: 'OLD_SECRET' }] }),
  );
  expect(screen.queryByText('OLD_SECRET')).not.toBeInTheDocument();
  expect(getFishPersonalNotes).toHaveBeenLastCalledWith('other-fish', expect.any(AbortSignal));
});

test('shows empty membership and retries a failed private read', async () => {
  vi.mocked(getFishPersonalNotes)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ rows: [] });
  render(<FishPersonalNotes fishId="fish" />);
  await expand();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Нет связанных баз.');
});
