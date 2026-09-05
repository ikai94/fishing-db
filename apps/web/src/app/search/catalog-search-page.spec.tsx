import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  search: '',
  searchCatalog: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/catalog-api', () => ({
  searchCatalog: mocks.searchCatalog,
  catalogSearchItemHref: (item: { kind: string; id: string }) => {
    if (item.kind === 'FISHING_BASE') return `/bases/${item.id}`;
    if (item.kind === 'LOCATION') return `/locations/${item.id}`;
    if (item.kind === 'FISH') return `/fish/${item.id}`;
    return `/baits?baitId=${item.id}`;
  },
  catalogSearchItemKindLabel: (item: { kind: string }) => {
    if (item.kind === 'FISHING_BASE') return 'База';
    if (item.kind === 'LOCATION') return 'Локация';
    if (item.kind === 'FISH') return 'Рыба';
    return 'Наживка';
  },
}));

import { CatalogSearchPage } from './catalog-search-page';

const base = { kind: 'FISHING_BASE' as const, id: 'base-amur', name: 'Амур' };
const fish = { kind: 'FISH' as const, id: 'fish-amur', name: 'Белый амур' };
const bait = {
  kind: 'BAIT' as const,
  id: 'bait-live',
  name: 'Живец',
  baitType: 'BAIT' as const,
};

describe('CatalogSearchPage', () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.searchCatalog.mockReset();
    mocks.search = '';
  });

  test('loads the URL query and renders the unchanged server order and deep links', async () => {
    mocks.search = 'q=%D0%B0%D0%BC%D1%83%D1%80';
    mocks.searchCatalog.mockResolvedValue({ items: [base, fish, bait], total: 3 });
    render(<CatalogSearchPage />);

    expect(screen.getByRole('searchbox', { name: 'Поисковый запрос' })).toHaveValue('амур');
    const list = await screen.findByRole('list', { name: 'Результаты поиска по каталогу' });
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['АмурБаза', 'Белый амурРыба', 'ЖивецНаживка']);
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/bases/base-amur', '/fish/fish-amur', '/baits?baitId=bait-live']);
    expect(mocks.searchCatalog).toHaveBeenCalledWith('амур', 100, expect.any(AbortSignal));
    expect(screen.getByText('Найдено: 3')).toBeVisible();
  });

  test('writes submissions to the URL and does not submit during IME composition', () => {
    render(<CatalogSearchPage />);
    const input = screen.getByRole('searchbox', { name: 'Поисковый запрос' });
    const form = input.closest('form');
    if (form === null) throw new Error('Expected search form');

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'белый амур' } });
    fireEvent.submit(form);
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { data: 'белый амур' });
    fireEvent.submit(form);
    expect(mocks.push).toHaveBeenCalledWith(
      '/search?q=%D0%B1%D0%B5%D0%BB%D1%8B%D0%B9+%D0%B0%D0%BC%D1%83%D1%80',
    );
  });

  test('aborts the previous URL query and ignores its late response', async () => {
    let resolveFirst: ((value: { items: [typeof fish]; total: number }) => void) | undefined;
    mocks.search = 'q=амур';
    mocks.searchCatalog
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [bait], total: 1 });
    const view = render(<CatalogSearchPage />);
    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenCalledTimes(1));
    const firstSignal = mocks.searchCatalog.mock.calls[0]?.[2] as AbortSignal;

    mocks.search = 'q=живец';
    view.rerender(<CatalogSearchPage />);
    await waitFor(() => expect(mocks.searchCatalog).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);
    expect(await screen.findByText('Живец')).toBeVisible();

    resolveFirst?.({ items: [fish], total: 1 });
    await waitFor(() => expect(screen.queryByText('Белый амур')).not.toBeInTheDocument());
  });
});
