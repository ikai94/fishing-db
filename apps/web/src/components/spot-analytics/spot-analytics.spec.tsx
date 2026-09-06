import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';
import type { SpotStatisticsPage } from '@/lib/spot-statistics-api';

const mocks = vi.hoisted(() => ({
  listSpotEvidence: vi.fn(),
  listSpotStatistics: vi.fn(),
}));

vi.mock('@/lib/spot-statistics-api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/spot-statistics-api')>();
  return {
    ...original,
    listSpotEvidence: mocks.listSpotEvidence,
    listSpotStatistics: mocks.listSpotStatistics,
  };
});

import { SpotAnalytics } from './spot-analytics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const page: SpotStatisticsPage = {
  items: [
    {
      groupKey: 'group-1',
      fishingBase: { id: 'base-1', name: 'База', isActive: true },
      location: { id: 'location-1', number: 2, name: 'Локация', isActive: true },
      holeDepthCm: null,
      spotPosition: 'у блокнота',
      contributorCount: 2,
      reportsCount: 3,
      fishCount: 2,
      topBaits: [
        {
          bait: { id: 'bait-1', name: 'Мотыль', isActive: true },
          contributorCount: 2,
          reportsCount: 3,
        },
      ],
      latestReportCreatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  totalGroups: 1,
  scopedReportsCount: 4,
  unlocatedReportsCount: 1,
};

const evidenceReport: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'База' },
  location: { id: 'location-1', number: 2, name: 'Локация' },
  fish: { id: 'fish-1', name: 'Сом' },
  bait: { id: 'bait-1', name: 'Мотыль' },
  weightGrams: 1_200,
  weightAssessment: { classification: 'ordinary', minWeightGrams: null, maxWeightGrams: null },
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: null,
  spotPositionRaw: 'у блокнота',
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('SpotAnalytics', () => {
  beforeEach(() => {
    mocks.listSpotEvidence.mockReset();
    mocks.listSpotStatistics.mockReset();
  });

  test('renders dense Location metrics and expands public evidence', async () => {
    const user = userEvent.setup();
    mocks.listSpotStatistics.mockResolvedValue(page);
    mocks.listSpotEvidence.mockResolvedValue({ items: [evidenceReport], nextCursor: null });
    render(
      <SpotAnalytics
        scope={{ kind: 'location', locationId: 'location-1' }}
        showFishCount
        showPlace={false}
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Ямы и точки' });
    const disclosure = heading.closest('details');
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute('open');

    await user.click(heading);
    expect(disclosure).toHaveAttribute('open');
    expect(await screen.findByText('у блокнота')).toBeVisible();
    expect(screen.getByText(/Отчётов в выборке: 4/u)).toHaveTextContent('без глубины и позиции: 1');
    const table = screen.getByRole('table', { name: 'Таблица ям и точек' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((item) => item.textContent),
    ).toEqual([
      '№',
      'Глубина',
      'Позиция',
      'Рыбаков',
      'Уловов',
      'Рыб',
      'Топ наживок / приманок',
      'Добавлено',
    ]);
    expect(within(table).getByText('Мотыль — 2/3')).toBeVisible();

    await user.click(within(table).getByRole('button', { name: '3' }));
    const evidenceLink = await within(table).findByRole('link', { name: 'Открыть' });
    expect(evidenceLink).toHaveAttribute('href', '/catches/report-1');
    expect(disclosure).toContainElement(evidenceLink);
    expect(mocks.listSpotEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        groupKey: 'group-1',
        scope: { kind: 'location', locationId: 'location-1' },
      }),
    );
  });

  test('uses the shared table-link treatment for Fish place links', async () => {
    const user = userEvent.setup();
    mocks.listSpotStatistics.mockResolvedValue(page);
    render(
      <SpotAnalytics
        scope={{ kind: 'fish', fishId: 'fish-1', baseIds: ['base-1'] }}
        showFishCount={false}
        showPlace
      />,
    );

    const heading = screen.getByRole('heading', { name: 'Ямы и точки' });
    expect(heading.closest('details')).not.toHaveAttribute('open');
    await user.click(heading);

    const baseLink = await screen.findByRole('link', { name: 'База' });
    const locationLink = screen.getByRole('link', { name: '2. Локация' });
    expect(baseLink.className).not.toBe('');
    expect(locationLink.className).toBe(baseLink.className);
  });

  test('aborts stale requests and clears old rows when Fish scope changes', async () => {
    const user = userEvent.setup();
    const first = deferred<SpotStatisticsPage>();
    const second = deferred<SpotStatisticsPage>();
    mocks.listSpotStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(
      <SpotAnalytics
        scope={{ kind: 'fish', fishId: 'fish-1', baseIds: ['base-1'] }}
        showFishCount={false}
        showPlace
      />,
    );
    await waitFor(() => expect(mocks.listSpotStatistics).toHaveBeenCalledTimes(1));
    await user.click(screen.getByText('Ямы и точки'));
    const firstSignal = mocks.listSpotStatistics.mock.calls[0]?.[0].signal as AbortSignal;

    view.rerender(
      <SpotAnalytics
        scope={{ kind: 'fish', fishId: 'fish-1', baseIds: ['base-2'] }}
        showFishCount={false}
        showPlace
      />,
    );
    await waitFor(() => expect(mocks.listSpotStatistics).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Загружаем статистику ям и точек');

    await act(async () => {
      first.resolve(page);
      await first.promise;
    });
    expect(screen.queryByText('у блокнота')).not.toBeInTheDocument();
    await act(async () => {
      second.resolve({ ...page, items: [] });
      await second.promise;
    });
    expect(await screen.findByText(/нет наблюдений с глубиной или позицией/u)).toBeVisible();
  });

  test('does not request analytics for an empty Location fish selection', async () => {
    const user = userEvent.setup();
    render(
      <SpotAnalytics
        disabled
        scope={{ kind: 'location', locationId: 'location-1', fishIds: [] }}
        showFishCount
        showPlace={false}
      />,
    );
    const status = screen.getByText('Выберите хотя бы одну рыбу.');
    expect(status.closest('section')).toHaveAttribute('aria-busy', 'false');
    expect(status).not.toBeVisible();
    await user.click(screen.getByText('Ямы и точки'));
    expect(screen.getByText('Выберите хотя бы одну рыбу.')).toBeVisible();
    expect(mocks.listSpotStatistics).not.toHaveBeenCalled();
  });
});
