import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  counts: vi.fn(),
  mine: vi.fn(),
  write: vi.fn(),
  voters: vi.fn(),
}));
vi.mock('@/lib/auth-api', () => ({ getCurrentUser: mocks.user }));
vi.mock('@/lib/fish-community-api', () => ({
  getCommunityCounts: mocks.counts,
  getMyCommunityMarks: mocks.mine,
  setCommunityMark: mocks.write,
  getCommunityVoters: mocks.voters,
}));
import { ApiError } from '@/lib/api-client';
import { CommunityMarks } from './community-marks';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 'actor', nickname: 'Рыбак', isBanned: false });
  mocks.counts.mockResolvedValue([
    { mark: 'BOTTOM', count: 2 },
    { mark: 'NIGHT', count: 1 },
  ]);
  mocks.mine.mockResolvedValue(['BOTTOM']);
  mocks.write.mockResolvedValue(undefined);
  mocks.voters.mockResolvedValue({ items: [{ nickname: 'Другой рыбак' }], nextCursor: null });
});

test('independent chips highlight own vote, add/remove and lazily show voters', async () => {
  render(<CommunityMarks fishId="fish-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Дно' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Дно' })).toHaveAttribute('aria-pressed', 'true');
  expect(mocks.voters).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Нахлыст' }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith('fish-1', 'FLY', true, expect.any(AbortSignal)),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Нахлыст' })).toHaveAttribute('aria-pressed', 'true'),
  );
  expect(screen.getByRole('button', { name: 'Дно' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Дно' }));
  await waitFor(() =>
    expect(mocks.write).toHaveBeenCalledWith('fish-1', 'BOTTOM', false, expect.any(AbortSignal)),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Дно' })).toHaveAttribute('aria-pressed', 'false'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ночь' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ночь' })).toHaveAttribute('aria-pressed', 'true'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Кто отметил «Дно»' }));
  expect(await screen.findByText('Другой рыбак')).toBeVisible();
  expect(mocks.voters).toHaveBeenCalledWith('fish-1', 'BOTTOM', undefined, expect.any(AbortSignal));
});

test('banned participants can view voters but cannot mutate', async () => {
  mocks.user.mockResolvedValue({ id: 'actor', isBanned: true });
  render(<CommunityMarks fishId="fish-1" />);
  await screen.findByText('Заблокированный аккаунт может только просматривать отметки.');
  expect(screen.getByRole('button', { name: 'Дно' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Кто отметил «Ночь»' }));
  expect(await screen.findByText('Другой рыбак')).toBeVisible();
  expect(mocks.write).not.toHaveBeenCalled();
});

test('failed mutation preserves own vote and shows error', async () => {
  mocks.write.mockRejectedValue(new Error('failed'));
  render(<CommunityMarks fishId="fish-1" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Дно' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Дно' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось изменить отметку.');
  expect(screen.getByRole('button', { name: 'Дно' })).toHaveAttribute('aria-pressed', 'true');
});

test('closing voters aborts pending response', async () => {
  let resolve!: (value: unknown) => void;
  mocks.voters.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<CommunityMarks fishId="fish-1" />);
  await screen.findByRole('button', { name: 'Кто отметил «Дно»' });
  fireEvent.click(screen.getByRole('button', { name: 'Кто отметил «Дно»' }));
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
  expect(mocks.voters.mock.calls[0][3].aborted).toBe(true);
  await act(async () => resolve({ items: [{ nickname: 'Устаревший' }], nextCursor: null }));
  expect(screen.queryByText('Устаревший')).not.toBeInTheDocument();
});

test('anonymous readers see counters and voters with a login link for voting', async () => {
  mocks.user.mockRejectedValue(new ApiError(401, { code: 'AUTH_REQUIRED' }));
  render(<CommunityMarks fishId="fish-1" />);
  expect(await screen.findByRole('link', { name: 'Войдите' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('button', { name: 'Дно' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Кто отметил «Дно»' }));
  expect(await screen.findByText('Другой рыбак')).toBeVisible();
  expect(mocks.mine).not.toHaveBeenCalled();
});
