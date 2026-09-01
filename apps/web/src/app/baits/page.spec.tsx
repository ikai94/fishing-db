import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import styles from './page.module.css';

const mocks = vi.hoisted(() => ({
  listBaits: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  listBaits: mocks.listBaits,
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

import BaitsPage from './page';

const baits = [
  { id: 'bait-worm', name: 'Червь', type: 'BAIT' as const, image: null },
  { id: 'lure-spoon', name: 'Блесна', type: 'LURE' as const, image: null },
  {
    id: 'bait-live',
    name: 'Живец',
    type: 'BAIT' as const,
    image: { url: `http://localhost:3001/api/v1/bait-images/${'a'.repeat(64)}.png` },
  },
  { id: 'lure-amur', name: 'Амурская вертушка', type: 'LURE' as const, image: null },
];

function baitList() {
  return screen.getByRole('list', { name: 'Наживки и приманки каталога' });
}

function visibleBaitNames(): string[] {
  return within(baitList())
    .getAllByRole('listitem')
    .map((item) => item.querySelector(`.${styles.baitName}`)?.textContent ?? '');
}

describe('BaitsPage', () => {
  beforeEach(() => mocks.listBaits.mockReset());

  test('uses the application shell and renders one dense alphabetical non-clickable list', async () => {
    mocks.listBaits.mockResolvedValue(baits);
    render(<BaitsPage />);

    const allButton = await screen.findByRole('button', { name: 'Все' });
    expect(screen.getByTestId('application-shell')).toBeVisible();
    expect(allButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Наживки' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(baitList()).toHaveClass(styles.baitList);
    expect(visibleBaitNames()).toEqual(['Амурская вертушка', 'Блесна', 'Живец', 'Червь']);
    expect(within(baitList()).queryByRole('link')).not.toBeInTheDocument();
    expect(within(baitList()).getAllByText('Наживка')).toHaveLength(2);
    expect(within(baitList()).getAllByText('Приманка')).toHaveLength(2);
    expect(screen.getByTitle('Живец')).toHaveAttribute(
      'src',
      `http://localhost:3001/api/v1/bait-images/${'a'.repeat(64)}.png`,
    );
    expect(screen.getByText('Позиций: 4')).toBeVisible();
    expect(mocks.listBaits).toHaveBeenCalledTimes(1);
    expect(mocks.listBaits.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  test('combines type filtering and token search without refetching', async () => {
    const user = userEvent.setup();
    mocks.listBaits.mockResolvedValue(baits);
    render(<BaitsPage />);

    await user.click(await screen.findByRole('button', { name: 'Искусственные приманки' }));
    expect(visibleBaitNames()).toEqual(['Амурская вертушка', 'Блесна']);
    expect(screen.getByText('Позиций: 2')).toBeVisible();

    const search = screen.getByRole('searchbox', { name: 'Поиск по названию' });
    await user.type(search, '  АМУР  ');
    expect(visibleBaitNames()).toEqual(['Амурская вертушка']);
    expect(screen.getByText('Поиск в выбранном типе')).toBeVisible();
    expect(screen.getByText('Найдено: 1')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Наживки' }));
    expect(screen.getByText('Ничего не найдено.')).toBeVisible();
    expect(screen.getByText('Найдено: 0')).toBeVisible();
    expect(search).toHaveValue('  АМУР  ');

    await user.clear(search);
    expect(visibleBaitNames()).toEqual(['Живец', 'Червь']);
    expect(screen.getByText('Позиций: 2')).toBeVisible();
    expect(mocks.listBaits).toHaveBeenCalledTimes(1);
  });

  test('preserves loading, empty, error, and retry behavior', async () => {
    const user = userEvent.setup();
    let resolveInitial: ((value: typeof baits) => void) | undefined;
    mocks.listBaits
      .mockImplementationOnce(
        () =>
          new Promise<typeof baits>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([]);

    const { unmount } = render(<BaitsPage />);
    expect(screen.getByText('Загружаем наживки и приманки…')).toBeVisible();
    resolveInitial?.(baits);
    expect(await screen.findByRole('list', { name: 'Наживки и приманки каталога' })).toBeVisible();
    unmount();

    render(<BaitsPage />);
    const retry = await screen.findByRole('button', { name: 'Повторить' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Не удалось загрузить наживки и приманки. Попробуйте ещё раз.',
    );
    await user.click(retry);

    await waitFor(() =>
      expect(screen.getByText('В каталоге пока нет активных наживок и приманок.')).toBeVisible(),
    );
    expect(mocks.listBaits).toHaveBeenCalledTimes(3);
  });
});
