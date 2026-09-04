import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';

const mocks = vi.hoisted(() => ({
  deleteCatchReport: vi.fn(),
  listMyCatchReports: vi.fn(),
  reload: vi.fn(),
  replace: vi.fn(),
  state: {
    kind: 'ready',
    user: {
      id: 'user-1',
      email: 'angler@example.ru',
      nickname: 'Рыбак',
      role: 'USER',
      isBanned: false,
      createdAt: '2026-08-08T12:00:00.000Z',
    },
  } as
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | {
        kind: 'ready';
        user: {
          id: string;
          email: string;
          nickname: string;
          role: 'USER' | 'ADMIN';
          isBanned: boolean;
          createdAt: string;
        };
      },
}));

vi.mock('next/navigation', () => {
  const router = { replace: mocks.replace };
  return { useRouter: () => router };
});

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

vi.mock('@/lib/use-required-user', () => ({
  useRequiredUser: () => ({ reload: mocks.reload, state: mocks.state }),
}));

vi.mock('@/lib/catch-reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catch-reports-api')>();
  return {
    ...actual,
    deleteCatchReport: mocks.deleteCatchReport,
    listMyCatchReports: mocks.listMyCatchReports,
  };
});

import MyCatchReportsPage from './page';

const report: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'Амур' },
  location: { id: 'location-1', number: 7, name: 'Протока' },
  fish: { id: 'fish-1', name: 'Кижуч' },
  bait: { id: 'bait-1', name: 'Мотыль' },
  weightGrams: 950,
  weightAssessment: {
    classification: 'ordinary',
    minWeightGrams: 100,
    maxWeightGrams: 1_000,
  },
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: null,
  spotPositionRaw: null,
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: 'После дождя',
  createdAt: '2026-08-12T22:30:00.000Z',
  updatedAt: '2026-08-12T22:30:00.000Z',
};

const activeUser = {
  id: 'user-1',
  email: 'angler@example.ru',
  nickname: 'Рыбак',
  role: 'USER' as const,
  isBanned: false,
  createdAt: '2026-08-08T12:00:00.000Z',
};

describe('MyCatchReportsPage', () => {
  beforeEach(() => {
    mocks.deleteCatchReport.mockReset();
    mocks.listMyCatchReports.mockReset();
    mocks.reload.mockReset();
    mocks.replace.mockReset();
    mocks.state = { kind: 'ready', user: activeUser };
  });

  test('renders the owner table inside ApplicationShell and preserves detail/edit/delete', async () => {
    const tester = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.listMyCatchReports.mockResolvedValue({ items: [report], nextCursor: null });
    mocks.deleteCatchReport.mockResolvedValue(undefined);
    render(<MyCatchReportsPage />);

    const table = await screen.findByRole('table', { name: 'Личный архив уловов' });
    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Мои уловы' }),
    );
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(screen.getByRole('link', { name: 'Редактировать' })).toHaveAttribute(
      'href',
      '/catches/report-1/edit',
    );

    await tester.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(confirm).toHaveBeenCalledWith(
      'Удалить отчёт об улове «Кижуч»? Это действие необратимо.',
    );
    await waitFor(() => expect(mocks.deleteCatchReport).toHaveBeenCalledWith('report-1'));
    expect(await screen.findByText('У вас пока нет опубликованных уловов.')).toBeVisible();
    confirm.mockRestore();
  });

  test('preserves cursor pagination and deduplicates loaded rows', async () => {
    const tester = userEvent.setup();
    const secondReport = { ...report, id: 'report-2', fish: { id: 'fish-2', name: 'Белуга' } };
    mocks.listMyCatchReports
      .mockResolvedValueOnce({ items: [report], nextCursor: 'owner-cursor' })
      .mockResolvedValueOnce({ items: [report, secondReport], nextCursor: null });
    render(<MyCatchReportsPage />);

    await tester.click(await screen.findByRole('button', { name: 'Показать ещё' }));

    expect(await screen.findByRole('link', { name: 'Белуга' })).toBeVisible();
    expect(mocks.listMyCatchReports).toHaveBeenNthCalledWith(1, {
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.listMyCatchReports).toHaveBeenNthCalledWith(2, {
      cursor: 'owner-cursor',
      limit: 20,
      signal: expect.any(AbortSignal),
    });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  test('keeps archive reads and detail available while mutations stay disabled for a banned user', async () => {
    mocks.state = { kind: 'ready', user: { ...activeUser, isBanned: true } };
    mocks.listMyCatchReports.mockResolvedValue({ items: [report], nextCursor: null });
    render(<MyCatchReportsPage />);

    expect(await screen.findByRole('status')).toHaveTextContent('доступны для чтения');
    expect(screen.getByRole('link', { name: 'Открыть' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Добавление недоступно' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Изменение недоступно' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Удаление недоступно' })).toBeDisabled();
  });

  test('preserves account-loading and retry states', async () => {
    const tester = userEvent.setup();
    mocks.state = { kind: 'error', message: 'Не удалось проверить аккаунт.' };
    render(<MyCatchReportsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить аккаунт.');
    await tester.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    expect(mocks.listMyCatchReports).not.toHaveBeenCalled();
  });
});
