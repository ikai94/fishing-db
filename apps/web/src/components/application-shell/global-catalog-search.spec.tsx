import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  searchCatalog: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('@/lib/catalog-api', () => ({
  searchCatalog: mocks.searchCatalog,
  catalogSearchItemHref: (item: { kind: string; id: string }) =>
    item.kind === 'BAIT' ? `/baits?baitId=${item.id}` : `/fish/${item.id}`,
  catalogSearchItemKindLabel: (item: { kind: string; baitType?: string }) =>
    item.kind === 'BAIT' && item.baitType === 'LURE' ? 'Приманка' : 'Наживка',
}));

import { GlobalCatalogSearch } from './global-catalog-search';

const fish = { kind: 'FISH' as const, id: 'fish-amur', name: 'Белый амур' };
const bait = {
  kind: 'BAIT' as const,
  id: 'bait-amur',
  name: 'Амурский живец',
  baitType: 'BAIT' as const,
};

async function passDebounce() {
  await act(() => vi.advanceTimersByTimeAsync(200));
}

describe('GlobalCatalogSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.push.mockReset();
    mocks.searchCatalog.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  test('debounces two-character input, orders groups and supports keyboard selection', async () => {
    mocks.searchCatalog.mockResolvedValue({ items: [bait, fish], total: 2 });
    render(<GlobalCatalogSearch />);
    const input = screen.getByRole('combobox', { name: 'Поиск по каталогу' });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'а' } });
    await passDebounce();
    expect(mocks.searchCatalog).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'ам' } });
    await passDebounce();
    expect(mocks.searchCatalog).toHaveBeenCalledWith('ам', 100, expect.any(AbortSignal));
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Белый амур', 'Амурский живецНаживка']);
    expect(screen.getByText('Наживки и приманки').parentElement).toHaveTextContent(
      'Наживки и приманки1',
    );
    expect(screen.getByText('Рыбы').parentElement).toHaveTextContent('Рыбы1');
    expect(input).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-0'));
    fireEvent.submit(input.closest('form')!);
    expect(mocks.push).toHaveBeenCalledWith('/fish/fish-amur');
  });

  test('shows at most three server-ordered items per group with group totals and compact row metadata', async () => {
    const items = [
      { kind: 'BAIT' as const, id: 'bait-live', name: 'Живец', baitType: 'BAIT' as const },
      { kind: 'FISHING_BASE' as const, id: 'base-z', name: 'База Z' },
      { kind: 'FISH' as const, id: 'fish-z', name: 'Рыба Z' },
      {
        kind: 'LOCATION' as const,
        id: 'location-1',
        name: 'Берег',
        number: 7,
        fishingBase: { id: 'base-amur', name: 'Амур' },
      },
      { kind: 'FISH' as const, id: 'fish-a', name: 'Рыба A' },
      { kind: 'FISHING_BASE' as const, id: 'base-a', name: 'База A' },
      { kind: 'BAIT' as const, id: 'bait-lure', name: 'Блесна', baitType: 'LURE' as const },
      { kind: 'FISH' as const, id: 'fish-m', name: 'Рыба M' },
      { kind: 'FISHING_BASE' as const, id: 'base-m', name: 'База M' },
      { kind: 'FISH' as const, id: 'fish-hidden', name: 'Рыба скрытая' },
      { kind: 'FISHING_BASE' as const, id: 'base-hidden', name: 'База скрытая' },
    ];
    mocks.searchCatalog.mockResolvedValue({ items, total: items.length });
    render(<GlobalCatalogSearch />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ры' } });
    await passDebounce();

    const fishGroup = screen.getByText('Рыбы').closest('li');
    const baseGroup = screen.getByText('Базы').closest('li');
    const locationGroup = screen.getByText('Локации').closest('li');
    const baitGroup = screen.getByText('Наживки и приманки').closest('li');
    expect(fishGroup).not.toBeNull();
    expect(baseGroup).not.toBeNull();
    expect(locationGroup).not.toBeNull();
    expect(baitGroup).not.toBeNull();
    if (fishGroup === null || baseGroup === null || locationGroup === null || baitGroup === null) {
      throw new Error('Expected every autocomplete group');
    }

    expect(screen.getByText('Рыбы').parentElement).toHaveTextContent('Рыбы4');
    expect(screen.getByText('Базы').parentElement).toHaveTextContent('Базы4');
    expect(screen.getByText('Локации').parentElement).toHaveTextContent('Локации1');
    expect(screen.getByText('Наживки и приманки').parentElement).toHaveTextContent(
      'Наживки и приманки2',
    );
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('group')
        .map((group) => document.getElementById(group.getAttribute('aria-labelledby') ?? ''))
        .map((header) => header?.textContent),
    ).toEqual(['Рыбы4', 'Базы4', 'Локации1', 'Наживки и приманки2']);
    expect(
      within(fishGroup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Рыба Z', 'Рыба A', 'Рыба M']);
    expect(
      within(baseGroup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['База Z', 'База A', 'База M']);
    expect(screen.queryByText('Рыба скрытая')).not.toBeInTheDocument();
    expect(screen.queryByText('База скрытая')).not.toBeInTheDocument();
    expect(within(locationGroup).getByRole('option')).toHaveTextContent('БерегАмур · № 7');
    expect(
      within(baitGroup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['ЖивецНаживка', 'БлеснаПриманка']);
    expect(within(fishGroup).queryByText('Рыба', { exact: true })).not.toBeInTheDocument();
    expect(within(baseGroup).queryByText('База', { exact: true })).not.toBeInTheDocument();
    expect(within(locationGroup).queryByText('Локация', { exact: true })).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-8'));
    fireEvent.submit(input.closest('form')!);
    expect(mocks.push).toHaveBeenCalledWith('/baits?baitId=bait-lure');
  });

  test('aborts superseded work and ignores a late stale response', async () => {
    let resolveFirst: ((value: { items: [typeof fish]; total: number }) => void) | undefined;
    mocks.searchCatalog
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ items: [bait], total: 1 });
    render(<GlobalCatalogSearch />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ам' } });
    await passDebounce();
    const firstSignal = mocks.searchCatalog.mock.calls[0]?.[2] as AbortSignal;

    fireEvent.change(input, { target: { value: 'жив' } });
    expect(firstSignal.aborted).toBe(true);
    await passDebounce();
    expect(screen.getByText('Амурский живец')).toBeVisible();
    resolveFirst?.({ items: [fish], total: 1 });
    await act(() => Promise.resolve());
    expect(screen.queryByText('Белый амур')).not.toBeInTheDocument();
  });

  test('does not request or submit while an IME composition is active and submits to URL search', async () => {
    mocks.searchCatalog.mockResolvedValue({ items: [], total: 0 });
    render(<GlobalCatalogSearch />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'ка' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await passDebounce();
    expect(mocks.searchCatalog).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { data: 'ка' });
    await passDebounce();
    fireEvent.submit(input.closest('form')!);
    expect(mocks.push).toHaveBeenCalledWith('/search?q=%D0%BA%D0%B0');
  });
});
