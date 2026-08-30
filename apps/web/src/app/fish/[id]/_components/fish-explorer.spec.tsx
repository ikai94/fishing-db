import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listBaitStatistics: vi.fn(),
  listCatchReports: vi.fn(),
  listFishingConditionStatistics: vi.fn(),
  listHoleStatistics: vi.fn(),
  routerReplace: vi.fn(),
  search: '',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/lib/fish-catch-aggregates-api', () => ({
  listFishCatchAggregates: mocks.listCatchReports,
}));

vi.mock('@/lib/bait-statistics-api', () => ({
  listBaitStatistics: mocks.listBaitStatistics,
}));

vi.mock('@/lib/fishing-condition-statistics-api', () => ({
  listFishingConditionStatistics: mocks.listFishingConditionStatistics,
}));

vi.mock('@/lib/hole-statistics-api', () => ({
  listHoleStatistics: mocks.listHoleStatistics,
}));

vi.mock('./bait-statistics-table', () => ({
  BaitStatisticsTable: ({ items }: { items: Array<{ bait: { id: string; name: string } }> }) => (
    <table aria-label="Статистика наживок и приманок">
      <tbody>
        {items.map((item, index) => (
          <tr key={item.bait.id}>
            <th scope="row">{index + 1}</th>
            <td>{item.bait.name}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('./common-hole-table', () => ({
  CommonHoleTable: ({ items }: { items: Array<{ spotPosition: string | null }> }) => (
    <table aria-label="Общие рыболовные точки">
      <tbody>
        {items.map((item, index) => (
          <tr key={`${item.spotPosition ?? 'missing'}-${index}`}>
            <th scope="row">{index + 1}</th>
            <td>{item.spotPosition ?? 'позиция не указана'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('./fishing-condition-statistics-table', () => ({
  FishingConditionStatisticsTable: ({
    items,
  }: {
    items: Array<{ fishingMethod: string; fishingNote: string | null }>;
  }) => (
    <table aria-label="Статистика условий ловли">
      <tbody>
        {items.map((item, index) => (
          <tr key={`${item.fishingMethod}-${item.fishingNote ?? 'missing'}-${index}`}>
            <th scope="row">{index + 1}</th>
            <td>{item.fishingMethod}</td>
            <td>{item.fishingNote ?? 'условие не указано'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

vi.mock('./public-fish-catch-table', () => ({
  PublicFishCatchTable: ({ rows }: { rows: Array<{ id: string }> }) => (
    <table aria-label="Агрегированные уловы рыбы">
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id}>
            <th scope="row">{index + 1}</th>
            <td>{row.id}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ),
}));

import { FishExplorer } from './fish-explorer';

type TestPage = {
  items: TestAggregate[];
  nextCursor: string | null;
};

type TestAggregate = {
  id: string;
  fish: { id: string; name: string };
  fishingBase: { id: string; name: string };
  location: { id: string; number: number; name: string };
  bait: { id: string; name: string; isActive: boolean };
  intensity: number;
  contributorCount: number;
  maxObservedWeightGrams: number;
};

type TestBaitStatistic = {
  bait: { id: string; name: string; isActive: boolean };
  reportsCount: number;
};

type TestFishingConditionStatistic = {
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
  fishingNote: 'MIDWATER' | 'FROM_BOTTOM' | 'SURFACE' | null;
  spinningSize: 'SMALL' | 'MEDIUM' | 'LARGE' | null;
  spinningSpeed: 'SLOW' | 'MEDIUM' | 'FAST' | null;
  uniqueUsersCount: number;
  reportsCount: number;
  latestReportCreatedAt: string;
};

const fish = {
  id: 'fish-1',
  name: 'Сом',
  image: null,
  bases: [
    { id: 'base-b', name: 'Волга' },
    { id: 'base-a', name: 'Ахтуба' },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function emptyPage(): TestPage {
  return { items: [], nextCursor: null };
}

function testAggregate(id: string): TestAggregate {
  return {
    id,
    fish: { id: 'fish-1', name: 'Сом' },
    fishingBase: { id: 'base-a', name: 'Ахтуба' },
    location: { id: 'location-a', number: 1, name: 'Локация' },
    bait: { id, name: id, isActive: true },
    intensity: 1,
    contributorCount: 1,
    maxObservedWeightGrams: 40,
  };
}

function requestAt(index: number) {
  return mocks.listCatchReports.mock.calls[index]?.[0] as {
    fishId: string;
    baseIds: string[];
    cursor?: string;
    limit: number;
    signal: AbortSignal;
  };
}

function statisticsRequestAt(index: number) {
  return mocks.listHoleStatistics.mock.calls[index]?.[0] as {
    fishId: string;
    baseIds: string[];
    signal: AbortSignal;
  };
}

function baitStatisticsRequestAt(index: number) {
  return mocks.listBaitStatistics.mock.calls[index]?.[0] as {
    fishId: string;
    baseId: string;
    signal: AbortSignal;
  };
}

function fishingConditionStatisticsRequestAt(index: number) {
  return mocks.listFishingConditionStatistics.mock.calls[index]?.[0] as {
    fishId: string;
    baseIds: string[];
    signal: AbortSignal;
  };
}

function baitStatistic({ id, name }: { id: string; name: string }): TestBaitStatistic {
  return {
    bait: { id, name, isActive: true },
    reportsCount: 3,
  };
}

function fishingConditionStatistic(
  fishingNote: TestFishingConditionStatistic['fishingNote'],
): TestFishingConditionStatistic {
  return {
    fishingMethod: 'BAIT_FISHING',
    fishingNote,
    spinningSize: null,
    spinningSpeed: null,
    uniqueUsersCount: 2,
    reportsCount: 3,
    latestReportCreatedAt: '2026-08-20T10:00:00.000Z',
  };
}

function sectionNamed(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (section === null) throw new Error(`Не найден раздел «${name}»`);
  return section;
}

describe('FishExplorer', () => {
  beforeEach(() => {
    mocks.listBaitStatistics.mockReset();
    mocks.listBaitStatistics.mockResolvedValue([]);
    mocks.listCatchReports.mockReset();
    mocks.listCatchReports.mockResolvedValue(emptyPage());
    mocks.listFishingConditionStatistics.mockReset();
    mocks.listFishingConditionStatistics.mockResolvedValue([]);
    mocks.listHoleStatistics.mockReset();
    mocks.listHoleStatistics.mockResolvedValue([]);
    mocks.routerReplace.mockReset();
    mocks.search = '';
  });

  test('starts with every membership selected and keeps Base links independent from checkboxes', async () => {
    render(<FishExplorer fish={fish} />);

    const group = screen.getByRole('group', { name: 'Базы обитания' });
    const volgaCheckbox = screen.getByRole('checkbox', {
      name: 'Учитывать базу «Волга»',
    });
    const akhtubaCheckbox = screen.getByRole('checkbox', {
      name: 'Учитывать базу «Ахтуба»',
    });
    const volgaLink = screen.getByRole('link', { name: 'Волга' });
    const akhtubaLink = screen.getByRole('link', { name: 'Ахтуба' });

    expect(group).toContainElement(volgaCheckbox);
    expect(volgaCheckbox).toBeChecked();
    expect(akhtubaCheckbox).toBeChecked();
    expect(screen.getByText('Выбрано 2 из 2')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Снять все' })).toBeEnabled();
    expect(volgaLink).toHaveAttribute('href', '/bases/base-b');
    expect(akhtubaLink).toHaveAttribute('href', '/bases/base-a');
    expect(volgaLink.closest('label')).toBeNull();
    expect(volgaCheckbox.closest('a')).toBeNull();

    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));
    expect(mocks.listBaitStatistics).not.toHaveBeenCalled();
    expect(requestAt(0)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
      limit: 20,
    });
    expect(statisticsRequestAt(0)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
    });
    expect(fishingConditionStatisticsRequestAt(0)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
    });
    expect(
      sectionNamed('Условия ловли в уловах').compareDocumentPosition(
        sectionNamed('На что ловится'),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      sectionNamed('На что ловится').compareDocumentPosition(sectionNamed('Общие ямы и точки')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sectionNamed('Общие ямы и точки').compareDocumentPosition(sectionNamed('Уловы'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test('supports keyboard toggling, clear-all without a request, and select-all restoration', async () => {
    const user = userEvent.setup();
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));
    expect(mocks.listBaitStatistics).not.toHaveBeenCalled();

    const akhtubaCheckbox = screen.getByRole('checkbox', {
      name: 'Учитывать базу «Ахтуба»',
    });
    akhtubaCheckbox.focus();
    await user.keyboard(' ');

    expect(akhtubaCheckbox).not.toBeChecked();
    expect(mocks.routerReplace).toHaveBeenLastCalledWith('/fish/fish-1?baseIds=base-b', {
      scroll: false,
    });
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2));
    expect(requestAt(1)).toMatchObject({ fishId: 'fish-1', baseIds: ['base-b'], limit: 20 });
    expect(baitStatisticsRequestAt(0)).toMatchObject({ fishId: 'fish-1', baseId: 'base-b' });
    expect(fishingConditionStatisticsRequestAt(1)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-b'],
    });
    expect(statisticsRequestAt(1)).toMatchObject({ fishId: 'fish-1', baseIds: ['base-b'] });

    await user.click(screen.getByRole('button', { name: 'Снять все' }));
    expect(mocks.routerReplace).toHaveBeenLastCalledWith('/fish/fish-1?scope=none', {
      scroll: false,
    });
    expect(screen.getByText('Выберите хотя бы одну базу, чтобы увидеть уловы.')).toBeVisible();
    expect(screen.getByText('Выберите одну базу, чтобы увидеть статистику.')).toBeVisible();
    expect(
      screen.getByText('Выберите хотя бы одну базу, чтобы увидеть статистику условий ловли.'),
    ).toBeVisible();
    expect(screen.getByText('Выберите хотя бы одну базу, чтобы увидеть статистику.')).toBeVisible();
    expect(screen.getByText('Выбрано 0 из 2')).toBeVisible();
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));
    expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Выбрать все' }));
    expect(mocks.routerReplace).toHaveBeenLastCalledWith('/fish/fish-1', { scroll: false });
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(3));
    expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(3));
    expect(requestAt(2)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
      limit: 20,
    });
    expect(statisticsRequestAt(2)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
    });
    expect(
      within(sectionNamed('На что ловится')).getByText(
        'Оставьте выбранной одну базу: статистика разных баз не объединяется.',
      ),
    ).toBeVisible();
    expect(fishingConditionStatisticsRequestAt(2)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
    });
    expect(screen.getByRole('button', { name: 'Выбрать все' })).toBeDisabled();
  });

  test('hydrates an exclusion URL and preserves unrelated URL state when returning to all', async () => {
    const user = userEvent.setup();
    mocks.search = 'excludeBaseIds=base-b&view=compact';
    render(<FishExplorer fish={fish} />);

    expect(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Учитывать базу «Волга»' })).not.toBeChecked();
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));
    expect(requestAt(0)).toMatchObject({ fishId: 'fish-1', baseIds: ['base-a'] });
    expect(baitStatisticsRequestAt(0)).toMatchObject({ fishId: 'fish-1', baseId: 'base-a' });
    expect(fishingConditionStatisticsRequestAt(0)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a'],
    });
    expect(statisticsRequestAt(0)).toMatchObject({ fishId: 'fish-1', baseIds: ['base-a'] });

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Волга»' }));
    expect(mocks.routerReplace).toHaveBeenLastCalledWith('/fish/fish-1?view=compact', {
      scroll: false,
    });
  });

  test('does not refetch when the URL commits the same locally selected scope', async () => {
    const user = userEvent.setup();
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));
    expect(mocks.listBaitStatistics).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2));
    expect(mocks.routerReplace).toHaveBeenLastCalledWith('/fish/fish-1?baseIds=base-b', {
      scroll: false,
    });

    mocks.search = 'baseIds=base-b';
    view.rerender(<FishExplorer fish={fish} />);

    expect(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Учитывать базу «Волга»' })).toBeChecked();
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.listCatchReports).toHaveBeenCalledTimes(2);
    expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1);
    expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2);
    expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2);
  });

  test('uses the initial loading message and renders recoverable error, retry, and exact empty state', async () => {
    const user = userEvent.setup();
    const first = deferred<TestPage>();
    const retry = deferred<TestPage>();
    mocks.listCatchReports.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(<FishExplorer fish={fish} />);

    expect(within(sectionNamed('Уловы')).getByRole('status')).toHaveTextContent('Загружаем уловы…');
    await act(async () => {
      first.reject(new Error('network'));
      await first.promise.catch(() => undefined);
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить уловы этой рыбы. Попробуйте ещё раз.',
    );
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(within(sectionNamed('Уловы')).getByRole('status')).toHaveTextContent('Загружаем уловы…');
    await act(async () => {
      retry.resolve(emptyPage());
      await retry.promise;
    });
    expect(await screen.findByText('Для выбранных баз уловов пока нет.')).toBeVisible();
    expect(mocks.listCatchReports).toHaveBeenCalledTimes(2);
  });

  test('renders fishing conditions loading, recoverable error/retry, and exact no-data states', async () => {
    const user = userEvent.setup();
    const first = deferred<TestFishingConditionStatistic[]>();
    const retry = deferred<TestFishingConditionStatistic[]>();
    mocks.listFishingConditionStatistics
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    render(<FishExplorer fish={fish} />);

    const conditionsSection = sectionNamed('Условия ловли в уловах');
    expect(within(conditionsSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику условий ловли…',
    );
    expect(conditionsSection).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      first.reject(new Error('network'));
      await first.promise.catch(() => undefined);
    });

    expect(within(conditionsSection).getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить статистику условий ловли. Попробуйте ещё раз.',
    );
    await user.click(
      within(conditionsSection).getByRole('button', {
        name: 'Повторить загрузку статистики условий ловли',
      }),
    );
    expect(within(conditionsSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику условий ловли…',
    );

    await act(async () => {
      retry.resolve([]);
      await retry.promise;
    });
    expect(
      await within(conditionsSection).findByText(
        'Для выбранных баз данных об условиях ловли пока нет.',
      ),
    ).toBeVisible();
    expect(conditionsSection).toHaveAttribute('aria-busy', 'false');
    expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2);
  });

  test('removes old fishing conditions immediately when the shared selection scope changes', async () => {
    const user = userEvent.setup();
    const replacement = deferred<TestFishingConditionStatistic[]>();
    mocks.listFishingConditionStatistics
      .mockResolvedValueOnce([fishingConditionStatistic('MIDWATER')])
      .mockReturnValueOnce(replacement.promise);
    render(<FishExplorer fish={fish} />);

    expect(await screen.findByText('MIDWATER')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));

    expect(screen.queryByText('MIDWATER')).not.toBeInTheDocument();
    expect(within(sectionNamed('Условия ловли в уловах')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику условий ловли…',
    );

    await act(async () => {
      replacement.resolve([fishingConditionStatistic('FROM_BOTTOM')]);
      await replacement.promise;
    });
    expect(await screen.findByText('FROM_BOTTOM')).toBeVisible();
  });

  test('aborts and ignores stale fishing conditions success and finally for a replacement scope', async () => {
    const user = userEvent.setup();
    const first = deferred<TestFishingConditionStatistic[]>();
    const second = deferred<TestFishingConditionStatistic[]>();
    mocks.listFishingConditionStatistics
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2));
    expect(fishingConditionStatisticsRequestAt(0).signal.aborted).toBe(true);
    expect(fishingConditionStatisticsRequestAt(1).signal.aborted).toBe(false);

    await act(async () => {
      first.resolve([fishingConditionStatistic('SURFACE')]);
      await first.promise;
    });
    expect(screen.queryByText('SURFACE')).not.toBeInTheDocument();
    expect(within(sectionNamed('Условия ловли в уловах')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику условий ловли…',
    );

    await act(async () => {
      second.resolve([fishingConditionStatistic(null)]);
      await second.promise;
    });
    expect(await screen.findByText('условие не указано')).toBeVisible();
  });

  test('ignores stale fishing conditions error and finally while replacement is pending', async () => {
    const user = userEvent.setup();
    const first = deferred<TestFishingConditionStatistic[]>();
    const second = deferred<TestFishingConditionStatistic[]>();
    mocks.listFishingConditionStatistics
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.reject(new Error('stale failure'));
      await first.promise.catch(() => undefined);
    });
    const conditionsSection = sectionNamed('Условия ловли в уловах');
    expect(within(conditionsSection).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(conditionsSection).getByRole('status')).toHaveTextContent(
      'Обновляем статистику условий ловли…',
    );

    await act(async () => {
      second.resolve([]);
      await second.promise;
    });
    expect(
      await within(conditionsSection).findByText(
        'Для выбранных баз данных об условиях ловли пока нет.',
      ),
    ).toBeVisible();
  });

  test('renders bait statistics loading, recoverable error/retry, and exact no-data states', async () => {
    const user = userEvent.setup();
    const first = deferred<TestBaitStatistic[]>();
    const retry = deferred<TestBaitStatistic[]>();
    mocks.listBaitStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    mocks.search = 'baseIds=base-a';
    render(<FishExplorer fish={fish} />);

    const baitSection = sectionNamed('На что ловится');
    expect(within(baitSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику наживок и приманок…',
    );
    expect(baitSection).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      first.reject(new Error('network'));
      await first.promise.catch(() => undefined);
    });

    expect(within(baitSection).getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить статистику наживок и приманок. Попробуйте ещё раз.',
    );
    await user.click(
      within(baitSection).getByRole('button', {
        name: 'Повторить загрузку статистики наживок и приманок',
      }),
    );
    expect(within(baitSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику наживок и приманок…',
    );

    await act(async () => {
      retry.resolve([]);
      await retry.promise;
    });
    expect(
      await within(baitSection).findByText(
        'Для выбранной базы данных о наживках и приманках пока нет.',
      ),
    ).toBeVisible();
    expect(baitSection).toHaveAttribute('aria-busy', 'false');
    expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(2);
  });

  test('removes old bait statistics immediately when the shared selection scope changes', async () => {
    const replacement = deferred<TestBaitStatistic[]>();
    mocks.listBaitStatistics
      .mockResolvedValueOnce([baitStatistic({ id: 'bait-old', name: 'старая наживка' })])
      .mockReturnValueOnce(replacement.promise);
    mocks.search = 'baseIds=base-a';
    const view = render(<FishExplorer fish={fish} />);

    expect(await screen.findByText('старая наживка')).toBeVisible();
    mocks.search = 'baseIds=base-b';
    view.rerender(<FishExplorer fish={fish} />);

    expect(screen.queryByText('старая наживка')).not.toBeInTheDocument();
    expect(within(sectionNamed('На что ловится')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику наживок и приманок…',
    );

    await act(async () => {
      replacement.resolve([baitStatistic({ id: 'bait-current', name: 'текущая наживка' })]);
      await replacement.promise;
    });
    expect(await screen.findByText('текущая наживка')).toBeVisible();
  });

  test('aborts and ignores stale bait statistics success and finally for a replacement scope', async () => {
    const first = deferred<TestBaitStatistic[]>();
    const second = deferred<TestBaitStatistic[]>();
    mocks.listBaitStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mocks.search = 'baseIds=base-a';
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));

    mocks.search = 'baseIds=base-b';
    view.rerender(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(2));
    expect(baitStatisticsRequestAt(0).signal.aborted).toBe(true);
    expect(baitStatisticsRequestAt(1).signal.aborted).toBe(false);

    await act(async () => {
      first.resolve([baitStatistic({ id: 'bait-stale', name: 'устаревшая наживка' })]);
      await first.promise;
    });
    expect(screen.queryByText('устаревшая наживка')).not.toBeInTheDocument();
    expect(within(sectionNamed('На что ловится')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику наживок и приманок…',
    );

    await act(async () => {
      second.resolve([
        baitStatistic({
          id: 'bait-current',
          name: 'актуальная приманка',
        }),
      ]);
      await second.promise;
    });
    expect(await screen.findByText('актуальная приманка')).toBeVisible();
  });

  test('ignores stale bait statistics error and finally while the replacement request is pending', async () => {
    const first = deferred<TestBaitStatistic[]>();
    const second = deferred<TestBaitStatistic[]>();
    mocks.listBaitStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mocks.search = 'baseIds=base-a';
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));

    mocks.search = 'baseIds=base-b';
    view.rerender(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.reject(new Error('stale failure'));
      await first.promise.catch(() => undefined);
    });
    const baitSection = sectionNamed('На что ловится');
    expect(within(baitSection).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(baitSection).getByRole('status')).toHaveTextContent(
      'Обновляем статистику наживок и приманок…',
    );

    await act(async () => {
      second.resolve([]);
      await second.promise;
    });
    expect(
      await within(baitSection).findByText(
        'Для выбранной базы данных о наживках и приманках пока нет.',
      ),
    ).toBeVisible();
  });

  test('renders dedicated statistics loading, recoverable error/retry, and exact no-data states', async () => {
    const user = userEvent.setup();
    const first = deferred<Array<{ spotPosition: string | null }>>();
    const retry = deferred<Array<{ spotPosition: string | null }>>();
    mocks.listHoleStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(<FishExplorer fish={fish} />);

    const statisticsSection = sectionNamed('Общие ямы и точки');
    expect(within(statisticsSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику…',
    );
    expect(statisticsSection).toHaveAttribute('aria-busy', 'true');

    await act(async () => {
      first.reject(new Error('network'));
      await first.promise.catch(() => undefined);
    });

    expect(within(statisticsSection).getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить статистику точек. Попробуйте ещё раз.',
    );
    await user.click(
      within(statisticsSection).getByRole('button', {
        name: 'Повторить загрузку статистики',
      }),
    );
    expect(within(statisticsSection).getByRole('status')).toHaveTextContent(
      'Загружаем статистику…',
    );

    await act(async () => {
      retry.resolve([]);
      await retry.promise;
    });
    expect(
      await within(statisticsSection).findByText('Для выбранных баз пока недостаточно данных.'),
    ).toBeVisible();
    expect(statisticsSection).toHaveAttribute('aria-busy', 'false');
    expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2);
  });

  test('removes old statistics immediately when the shared selection scope changes', async () => {
    const user = userEvent.setup();
    const replacement = deferred<Array<{ spotPosition: string | null }>>();
    mocks.listHoleStatistics
      .mockResolvedValueOnce([{ spotPosition: 'старая точка' }])
      .mockReturnValueOnce(replacement.promise);
    render(<FishExplorer fish={fish} />);

    expect(await screen.findByText('старая точка')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));

    expect(screen.queryByText('старая точка')).not.toBeInTheDocument();
    expect(within(sectionNamed('Общие ямы и точки')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику…',
    );

    await act(async () => {
      replacement.resolve([{ spotPosition: 'текущая точка' }]);
      await replacement.promise;
    });
    expect(await screen.findByText('текущая точка')).toBeVisible();
  });

  test('aborts and ignores stale statistics success and finally for a replacement scope', async () => {
    const user = userEvent.setup();
    const first = deferred<Array<{ spotPosition: string | null }>>();
    const second = deferred<Array<{ spotPosition: string | null }>>();
    mocks.listHoleStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2));
    expect(statisticsRequestAt(0).signal.aborted).toBe(true);
    expect(statisticsRequestAt(1).signal.aborted).toBe(false);

    await act(async () => {
      first.resolve([{ spotPosition: 'устаревшая точка' }]);
      await first.promise;
    });
    expect(screen.queryByText('устаревшая точка')).not.toBeInTheDocument();
    expect(within(sectionNamed('Общие ямы и точки')).getByRole('status')).toHaveTextContent(
      'Обновляем статистику…',
    );

    await act(async () => {
      second.resolve([{ spotPosition: 'актуальная точка' }]);
      await second.promise;
    });
    expect(await screen.findByText('актуальная точка')).toBeVisible();
  });

  test('ignores stale statistics error and finally while the replacement request is pending', async () => {
    const user = userEvent.setup();
    const first = deferred<Array<{ spotPosition: string | null }>>();
    const second = deferred<Array<{ spotPosition: string | null }>>();
    mocks.listHoleStatistics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.reject(new Error('stale failure'));
      await first.promise.catch(() => undefined);
    });
    const statisticsSection = sectionNamed('Общие ямы и точки');
    expect(within(statisticsSection).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(statisticsSection).getByRole('status')).toHaveTextContent(
      'Обновляем статистику…',
    );

    await act(async () => {
      second.resolve([]);
      await second.promise;
    });
    expect(
      await within(statisticsSection).findByText('Для выбранных баз пока недостаточно данных.'),
    ).toBeVisible();
  });

  test('retains scope, continues visual numbering, and avoids report-card headings across pages', async () => {
    const user = userEvent.setup();
    mocks.listCatchReports
      .mockResolvedValueOnce({ items: [testAggregate('report-1')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({
        items: [testAggregate('report-1'), testAggregate('report-2')],
        nextCursor: null,
      });
    render(<FishExplorer fish={fish} />);

    expect(await screen.findByText('report-1')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));

    expect(await screen.findByText('report-2')).toBeVisible();
    const catchTable = screen.getByRole('table', { name: 'Агрегированные уловы рыбы' });
    const catchRows = within(catchTable).getAllByRole('row');
    expect(catchRows).toHaveLength(2);
    expect(catchRows[0]).toHaveTextContent('1report-1');
    expect(catchRows[1]).toHaveTextContent('2report-2');
    expect(within(catchTable).queryByRole('heading')).not.toBeInTheDocument();
    expect(requestAt(1)).toMatchObject({
      fishId: 'fish-1',
      baseIds: ['base-a', 'base-b'],
      cursor: 'cursor-1',
      limit: 20,
    });
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  test('uses the refresh message and ignores stale initial success/finally for a replacement scope', async () => {
    const user = userEvent.setup();
    const first = deferred<TestPage>();
    const second = deferred<TestPage>();
    mocks.listCatchReports.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));
    expect(requestAt(0).signal.aborted).toBe(true);
    expect(requestAt(1).signal.aborted).toBe(false);

    await act(async () => {
      first.resolve({ items: [testAggregate('stale-report')], nextCursor: null });
      await first.promise;
    });
    expect(screen.queryByText('stale-report')).not.toBeInTheDocument();
    expect(within(sectionNamed('Уловы')).getByRole('status')).toHaveTextContent('Обновляем уловы…');

    await act(async () => {
      second.resolve({ items: [testAggregate('current-report')], nextCursor: null });
      await second.promise;
    });
    expect(await screen.findByText('current-report')).toBeVisible();
  });

  test('ignores stale initial errors and their finally while the replacement request is pending', async () => {
    const user = userEvent.setup();
    const first = deferred<TestPage>();
    const second = deferred<TestPage>();
    mocks.listCatchReports.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.reject(new Error('stale failure'));
      await first.promise.catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(within(sectionNamed('Уловы')).getByRole('status')).toHaveTextContent('Обновляем уловы…');

    await act(async () => {
      second.resolve(emptyPage());
      await second.promise;
    });
    expect(await screen.findByText('Для выбранных баз уловов пока нет.')).toBeVisible();
  });

  test('aborts and ignores a stale next page after the selection scope changes', async () => {
    const user = userEvent.setup();
    const stalePage = deferred<TestPage>();
    const replacement = deferred<TestPage>();
    mocks.listCatchReports
      .mockResolvedValueOnce({
        items: [testAggregate('old-first-page')],
        nextCursor: 'old-cursor',
      })
      .mockReturnValueOnce(stalePage.promise)
      .mockReturnValueOnce(replacement.promise);
    render(<FishExplorer fish={fish} />);

    expect(await screen.findByText('old-first-page')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Показать ещё' }));
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('checkbox', { name: 'Учитывать базу «Ахтуба»' }));
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(3));

    expect(requestAt(1)).toMatchObject({ cursor: 'old-cursor' });
    expect(requestAt(1).signal.aborted).toBe(true);
    expect(screen.queryByText('old-first-page')).not.toBeInTheDocument();

    await act(async () => {
      stalePage.resolve({ items: [testAggregate('stale-next-page')], nextCursor: null });
      await stalePage.promise;
    });
    expect(screen.queryByText('stale-next-page')).not.toBeInTheDocument();
    expect(within(sectionNamed('Уловы')).getByRole('status')).toHaveTextContent('Обновляем уловы…');

    await act(async () => {
      replacement.resolve({ items: [testAggregate('new-scope-report')], nextCursor: null });
      await replacement.promise;
    });
    expect(await screen.findByText('new-scope-report')).toBeVisible();
    expect(screen.queryByText('old-first-page')).not.toBeInTheDocument();
  });

  test('aborts the active request when unmounted', async () => {
    const pending = deferred<TestPage>();
    mocks.listCatchReports.mockReturnValue(pending.promise);
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listCatchReports).toHaveBeenCalledTimes(1));
    const signal = requestAt(0).signal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(emptyPage());
    await pending.promise;
  });

  test('aborts the dedicated bait statistics request when unmounted', async () => {
    const pending = deferred<TestBaitStatistic[]>();
    mocks.listBaitStatistics.mockReturnValue(pending.promise);
    mocks.search = 'baseIds=base-a';
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listBaitStatistics).toHaveBeenCalledTimes(1));
    const signal = baitStatisticsRequestAt(0).signal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve([]);
    await pending.promise;
  });

  test('aborts the dedicated fishing conditions request when unmounted', async () => {
    const pending = deferred<TestFishingConditionStatistic[]>();
    mocks.listFishingConditionStatistics.mockReturnValue(pending.promise);
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listFishingConditionStatistics).toHaveBeenCalledTimes(1));
    const signal = fishingConditionStatisticsRequestAt(0).signal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve([]);
    await pending.promise;
  });

  test('aborts the dedicated statistics request when unmounted', async () => {
    const pending = deferred<Array<{ spotPosition: string | null }>>();
    mocks.listHoleStatistics.mockReturnValue(pending.promise);
    const view = render(<FishExplorer fish={fish} />);
    await waitFor(() => expect(mocks.listHoleStatistics).toHaveBeenCalledTimes(1));
    const signal = statisticsRequestAt(0).signal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve([]);
    await pending.promise;
  });

  test('does not request catches when the fish has no active Base memberships', () => {
    render(<FishExplorer fish={{ ...fish, bases: [] }} />);

    expect(screen.getByRole('group', { name: 'Базы обитания' })).toBeVisible();
    expect(screen.getByText('Активных баз обитания пока нет.')).toBeVisible();
    expect(screen.getByText('Выберите хотя бы одну базу, чтобы увидеть уловы.')).toBeVisible();
    expect(screen.getByText('Выберите одну базу, чтобы увидеть статистику.')).toBeVisible();
    expect(
      screen.getByText('Выберите хотя бы одну базу, чтобы увидеть статистику условий ловли.'),
    ).toBeVisible();
    expect(screen.getByText('Выберите хотя бы одну базу, чтобы увидеть статистику.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mocks.listCatchReports).not.toHaveBeenCalled();
    expect(mocks.listBaitStatistics).not.toHaveBeenCalled();
    expect(mocks.listFishingConditionStatistics).not.toHaveBeenCalled();
    expect(mocks.listHoleStatistics).not.toHaveBeenCalled();
  });
});
