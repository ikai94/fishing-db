import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./api-client', () => ({ apiRequest: mocks.request }));
import {
  COMMUNITY_MARKS,
  getCommunityCounts,
  getCommunityVoters,
  getMyCommunityMarks,
  setCommunityMark,
} from './fish-community-api';
beforeEach(() => vi.resetAllMocks());

test('decodes counts and personal marks, writes only through session identity', async () => {
  const signal = new AbortController().signal;
  mocks.request.mockResolvedValueOnce({
    items: COMMUNITY_MARKS.map((mark) => ({ mark, count: 0 })),
  });
  expect(await getCommunityCounts('fish', signal)).toHaveLength(7);
  mocks.request.mockResolvedValueOnce({ items: [{ mark: 'FLY' }, { mark: 'DAY' }] });
  expect(await getMyCommunityMarks('fish', signal)).toEqual(['FLY', 'DAY']);
  await setCommunityMark('fish', 'DAY', true, signal);
  expect(mocks.request).toHaveBeenLastCalledWith('/me/fish/fish/community-marks/DAY', {
    method: 'POST',
    signal,
  });
  await setCommunityMark('fish', 'DAY', false, signal);
  expect(mocks.request).toHaveBeenLastCalledWith('/me/fish/fish/community-marks/DAY', {
    method: 'DELETE',
    signal,
  });
});

test.each([
  { items: [{ mark: 'DAY', count: -1 }] },
  { items: [{ mark: 'DAY', count: 1.2 }] },
  { items: [{ mark: 'OTHER', count: 1 }] },
  {
    items: [
      { mark: 'DAY', count: 1 },
      { mark: 'DAY', count: 1 },
    ],
  },
  { items: [], userId: 'private' },
])('rejects malformed or incomplete counters', async (value) => {
  mocks.request.mockResolvedValueOnce(value);
  await expect(getCommunityCounts('fish')).rejects.toThrow();
});

test('voters contain nicknames only and support lazy pagination', async () => {
  mocks.request.mockResolvedValueOnce({ items: [{ nickname: 'Рыбак' }], nextCursor: null });
  expect(await getCommunityVoters('fish', 'DAY', 'cursor')).toEqual({
    items: [{ nickname: 'Рыбак' }],
    nextCursor: null,
  });
  expect(mocks.request).toHaveBeenLastCalledWith(
    '/catalog/fish/fish/community-marks/DAY/voters?after=cursor',
    { signal: undefined },
  );
  mocks.request.mockResolvedValueOnce({
    items: [{ nickname: 'Рыбак', email: 'private@example.ru' }],
    nextCursor: null,
  });
  await expect(getCommunityVoters('fish', 'DAY')).rejects.toThrow();
});
