import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import styles from './page.module.css';

const mocks = vi.hoisted(() => ({
  listFish: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  listFish: mocks.listFish,
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

import FishPage from './page';

const fish = [
  { id: 'fish-som', name: 'Сом' },
  { id: 'fish-other', name: 'Salmon' },
  { id: 'fish-ya', name: 'Язь' },
  { id: 'fish-amur-osetr', name: 'Амурский Осетр' },
  { id: 'fish-yozh', name: 'Ёрш' },
  { id: 'fish-tsikhlida', name: 'Цихлида' },
  { id: 'fish-beluga', name: 'Белуга' },
  { id: 'fish-yorsh', name: 'Йорш' },
  { id: 'fish-amur-shchuka', name: 'Амурская Щука' },
  { id: 'fish-shchuka', name: 'Щука' },
  { id: 'fish-harius', name: 'Хариус' },
  { id: 'fish-ekhinus', name: 'Энтехинус' },
  { id: 'fish-chavicha', name: 'Чавыча' },
  { id: 'fish-yuzhnaya', name: 'Южная мальма' },
].map((item) => ({ ...item, image: null }));

function fishList() {
  return screen.getByRole('list', { name: 'Рыбы каталога' });
}

function visibleFishNames(): string[] {
  return within(fishList())
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
}

describe('FishPage alphabet navigation', () => {
  beforeEach(() => mocks.listFish.mockReset());

  test('defaults to All and renders one unnumbered, alphabetical list of direct links', async () => {
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    const allButton = await screen.findByRole('button', { name: 'Все' });
    expect(screen.getByTestId('application-shell')).toBeVisible();
    expect(allButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'А–Б' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(14);
    expect(screen.getAllByRole('list', { name: 'Рыбы каталога' })).toHaveLength(1);
    expect(fishList().tagName).toBe('UL');
    expect(fishList()).toHaveClass(styles.fishReferenceList);
    expect(visibleFishNames()).toEqual([
      'Амурская Щука',
      'Амурский Осетр',
      'Белуга',
      'Ёрш',
      'Йорш',
      'Сом',
      'Хариус',
      'Цихлида',
      'Чавыча',
      'Щука',
      'Энтехинус',
      'Южная мальма',
      'Язь',
      'Salmon',
    ]);
    const listItems = within(fishList()).getAllByRole('listitem');
    expect(fishList().querySelectorAll('[data-fish-image="thumbnail"]')).toHaveLength(fish.length);
    expect(screen.queryByText('Нет изображения')).not.toBeInTheDocument();
    for (const item of listItems) {
      const row = item.firstElementChild;
      expect(item).not.toHaveAttribute('value');
      expect(row?.children).toHaveLength(2);
      expect(row?.children[0]).toHaveAttribute('data-fish-image', 'thumbnail');
      expect(row?.children[1]?.tagName).toBe('A');
    }
    expect(
      within(fishList())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/fish/fish-amur-shchuka',
      '/fish/fish-amur-osetr',
      '/fish/fish-beluga',
      '/fish/fish-yozh',
      '/fish/fish-yorsh',
      '/fish/fish-som',
      '/fish/fish-harius',
      '/fish/fish-tsikhlida',
      '/fish/fish-chavicha',
      '/fish/fish-shchuka',
      '/fish/fish-ekhinus',
      '/fish/fish-yuzhnaya',
      '/fish/fish-ya',
      '/fish/fish-other',
    ]);
    expect(screen.getByText(`Рыб: ${fish.length}`)).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(mocks.listFish).toHaveBeenCalledTimes(1);
  });

  test('filters explicit letter groups, switches them, and never refetches', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);
    await screen.findByRole('button', { name: 'Все' });

    await user.click(screen.getByRole('button', { name: 'А–Б' }));
    expect(visibleFishNames()).toEqual(['Амурская Щука', 'Амурский Осетр', 'Белуга']);
    expect(screen.getByText('Рыб: 3')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'С' }));
    expect(visibleFishNames()).toEqual(['Сом']);
    expect(screen.getByRole('button', { name: 'С' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'А–Б' }));
    expect(visibleFishNames()).toEqual(['Амурская Щука', 'Амурский Осетр', 'Белуга']);
    expect(mocks.listFish).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['Д–Е', ['Ёрш']],
    ['И–К', ['Йорш']],
    ['Ф–Ч', ['Хариус', 'Цихлида', 'Чавыча']],
    ['Ш–Я', ['Щука', 'Энтехинус', 'Южная мальма', 'Язь']],
    ['Прочие', ['Salmon']],
  ])('uses the explicit %s membership', async (buttonName, expected) => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    await user.click(await screen.findByRole('button', { name: buttonName }));
    expect(visibleFishNames()).toEqual(expected);
  });

  test('searches globally, explains scope, and restores the selected group when cleared', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    await user.click(await screen.findByRole('button', { name: 'С' }));
    expect(visibleFishNames()).toEqual(['Сом']);
    const search = screen.getByRole('searchbox', { name: 'Поиск по названию' });
    await user.type(search, '  АМУР  ');

    expect(visibleFishNames()).toEqual(['Амурская Щука', 'Амурский Осетр']);
    expect(screen.getByText('Поиск по всему каталогу')).toBeVisible();
    expect(screen.getByText('Найдено: 2')).toBeVisible();
    expect(screen.getByRole('button', { name: 'С' })).toHaveAttribute('aria-pressed', 'true');

    await user.clear(search);
    expect(visibleFishNames()).toEqual(['Сом']);
    expect(screen.getByText('Рыб: 1')).toBeVisible();
    expect(screen.queryByText('Поиск по всему каталогу')).not.toBeInTheDocument();
    expect(mocks.listFish).toHaveBeenCalledTimes(1);
  });

  test('clicking an alphabet group during search clears search and shows that group', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    const search = await screen.findByRole('searchbox');
    await user.type(search, 'сом');
    expect(visibleFishNames()).toEqual(['Сом']);
    await user.click(screen.getByRole('button', { name: 'А–Б' }));

    expect(search).toHaveValue('');
    expect(screen.getByRole('button', { name: 'А–Б' })).toHaveAttribute('aria-pressed', 'true');
    expect(visibleFishNames()).toEqual(['Амурская Щука', 'Амурский Осетр', 'Белуга']);
  });

  test('distinguishes group and search empty states while keeping controls visible', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    await user.click(await screen.findByRole('button', { name: 'В–Г' }));
    expect(screen.getByText('В этой группе рыб пока нет.')).toBeVisible();
    expect(screen.getByText('Рыб: 0')).toBeVisible();

    const search = screen.getByRole('searchbox');
    await user.type(search, 'карась');
    expect(screen.getByText('Ничего не найдено.')).toBeVisible();
    expect(screen.getByText('Найдено: 0')).toBeVisible();
    expect(search).toBeVisible();
    expect(screen.getByRole('button', { name: 'Все' })).toBeVisible();
  });

  test('supports native keyboard activation and exposes the pressed state', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    const sButton = await screen.findByRole('button', { name: 'С' });
    sButton.focus();
    await user.keyboard('{Enter}');
    expect(sButton).toHaveAttribute('aria-pressed', 'true');
    expect(visibleFishNames()).toEqual(['Сом']);

    const abButton = screen.getByRole('button', { name: 'А–Б' });
    abButton.focus();
    await user.keyboard(' ');
    expect(abButton).toHaveAttribute('aria-pressed', 'true');
    expect(sButton).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(mocks.listFish).toHaveBeenCalledTimes(1));
  });

  test('keeps Fish link tab order aligned with the alphabetical DOM sequence', async () => {
    const user = userEvent.setup();
    mocks.listFish.mockResolvedValue(fish);
    render(<FishPage />);

    const search = await screen.findByRole('searchbox');
    const links = within(fishList()).getAllByRole('link');
    search.focus();

    for (const link of links) {
      await user.tab();
      expect(link).toHaveFocus();
    }

    expect(mocks.listFish).toHaveBeenCalledTimes(1);
  });
});
