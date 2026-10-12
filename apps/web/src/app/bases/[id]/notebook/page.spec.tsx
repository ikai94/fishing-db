import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { getBaseFishNotebook } from '@/lib/base-fish-notebook-api';
import { cookies } from 'next/headers';
import Page from './page';

vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('LOGIN_REDIRECT');
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('@/lib/base-fish-notebook-api', () => ({
  getBaseFishNotebook: vi.fn(),
  saveBaseFishNotebookEntry: vi.fn(),
  setBaseFishNotebookVisibility: vi.fn(),
}));
vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: 'session-token' }),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
});
const params = Promise.resolve({ id: 'base' });

test('server blocks a direct guest page request before fetching notebook data', async () => {
  vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as unknown as Awaited<
    ReturnType<typeof cookies>
  >);
  await expect(Page({ params })).rejects.toThrow('LOGIN_REDIRECT');
  expect(getBaseFishNotebook).not.toHaveBeenCalled();
});

test.each([
  [401, 'LOGIN_REDIRECT'],
  [403, 'NOT_FOUND'],
  [404, 'NOT_FOUND'],
])('server denies API status %s without rendering the table', async (status, result) => {
  vi.mocked(getBaseFishNotebook).mockRejectedValue(
    new ApiError(status as number, { message: 'denied' }),
  );
  await expect(Page({ params })).rejects.toThrow(result as string);
});

test('authorized page forwards session and renders read-only facts and personal editors', async () => {
  vi.mocked(getBaseFishNotebook).mockResolvedValue({
    base: { id: 'base', name: 'База' },
    rows: [
      {
        fish: { id: 'fish', name: 'Щука', image: null, isRarest: false, isNightBiting: false },
        minWeightGrams: 123,
        maxWeightGrams: 456,
        noteText: 'Моя заметка',
        totalCatchReports: 9,
        isHidden: false,

        topLocations: [{ id: 'loc', name: 'Затон', number: 1, reportsCount: 9 }],
      },
      {
        fish: { id: 'fish-2', name: 'Сом', image: null, isRarest: false, isNightBiting: false },
        minWeightGrams: null,
        maxWeightGrams: null,
        noteText: null,
        topLocations: [],
        totalCatchReports: 0,
        isHidden: false,
      },
    ],
  });
  render(await Page({ params }));
  expect(getBaseFishNotebook).toHaveBeenCalledWith('base', {
    headers: { Cookie: 'fishing_session=session-token' },
  });
  expect(screen.getByRole('link', { name: '1. Затон — уловов: 9' })).toHaveAttribute(
    'href',
    '/locations/loc',
  );
  expect(screen.getByText('1(9)')).toBeInTheDocument();
  expect(screen.getByText('123 г')).toBeInTheDocument();
  expect(screen.getByText('456 г')).toBeInTheDocument();
  expect(screen.getByText('Нет уловов')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Заметка — Щука' })).toHaveValue('Моя заметка');
});
