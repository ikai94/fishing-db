import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { apiBaseUrl } from '@/lib/api-client';
import type { CatchReport } from '@/lib/catch-reports-api';

const mocks = vi.hoisted(() => ({
  listCatchReports: vi.fn(),
}));

vi.mock('@/lib/catch-reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catch-reports-api')>();
  return { ...actual, listCatchReports: mocks.listCatchReports };
});

import { HomeDashboard } from './home-dashboard';

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
  userNoteRaw: null,
  createdAt: '2026-08-12T22:30:00.000Z',
  updatedAt: '2026-08-12T22:30:00.000Z',
};

function healthResponse(database: 'up' | 'down') {
  return {
    ok: database === 'up',
    json: () =>
      Promise.resolve({
        status: database === 'up' ? 'ok' : 'error',
        application: 'up',
        database,
        timestamp: '2026-09-04T12:00:00.000Z',
      }),
  } as Response;
}

describe('HomeDashboard', () => {
  beforeEach(() => {
    mocks.listCatchReports.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(healthResponse('up')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('loads exactly ten recent public reports and renders no legacy body actions', async () => {
    mocks.listCatchReports.mockResolvedValue({ items: [report], nextCursor: 'unused' });
    render(<HomeDashboard />);

    expect(await screen.findByRole('link', { name: 'Кижуч' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(mocks.listCatchReports).toHaveBeenCalledWith({
      limit: 10,
      signal: expect.any(AbortSignal),
    });
    expect(fetch).toHaveBeenCalledWith(`${apiBaseUrl}/api/v1/health`, {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });

    const status = screen.getByLabelText('Состояние сервисов');
    expect(within(status).getByText('Frontend').nextElementSibling).toHaveTextContent('работает');
    await waitFor(() => {
      expect(within(status).getByText('API').nextElementSibling).toHaveTextContent('доступен');
      expect(within(status).getByText('PostgreSQL').nextElementSibling).toHaveTextContent(
        'доступна',
      );
    });
    expect(screen.getByText('Лента действий пока недоступна.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /показать ещё/i })).not.toBeInTheDocument();
    for (const name of [
      'Публичные уловы',
      'Добавить улов',
      'Мои уловы',
      'Зарегистрироваться',
      'Войти',
      'Мой аккаунт',
    ]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
  });

  test('reports a reachable API with an unavailable database and an empty CatchReport state', async () => {
    vi.mocked(fetch).mockResolvedValue(healthResponse('down'));
    mocks.listCatchReports.mockResolvedValue({ items: [], nextCursor: null });
    render(<HomeDashboard />);

    expect(await screen.findByText('Публичных уловов пока нет.')).toBeVisible();
    const status = screen.getByLabelText('Состояние сервисов');
    await waitFor(() => {
      expect(within(status).getByText('API').nextElementSibling).toHaveTextContent('доступен');
      expect(within(status).getByText('PostgreSQL').nextElementSibling).toHaveTextContent(
        'недоступна',
      );
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('offers a focused retry when recent CatchReports fail', async () => {
    const user = userEvent.setup();
    mocks.listCatchReports
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<HomeDashboard />);

    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Публичных уловов пока нет.')).toBeVisible();
    expect(mocks.listCatchReports).toHaveBeenCalledTimes(2);
  });
});
