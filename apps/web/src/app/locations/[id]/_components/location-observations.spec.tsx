import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type {
  CatchReport,
  LocationObservations as LocationObservationsData,
} from '@/lib/catch-reports-api';
import { LocationObservations } from './location-observations';

const baseReport: CatchReport = {
  id: 'report-beluga',
  author: { id: 'admin-1', nickname: 'Импорт' },
  fishingBase: { id: 'base-1', name: 'Ахтуба' },
  location: { id: 'location-1', number: 7, name: 'Протока' },
  fish: { id: 'fish-beluga', name: 'Белуга' },
  bait: { id: 'bait-1', name: 'Vib-rapan' },
  weightGrams: 7_242,
  fishingMethod: 'SPINNING',
  holeDepthCm: 763,
  spotPositionRaw: 'левый край рюкзака',
  fishingNote: 'MIDWATER',
  spinningSize: 'MEDIUM',
  spinningSpeed: 'SLOW',
  userNoteRaw: 'после дождя',
  createdAt: '2026-08-12T22:30:00.000Z',
  updatedAt: '2026-08-12T22:30:00.000Z',
};

const observations: LocationObservationsData = {
  observedFish: [
    {
      fish: { id: 'fish-som', name: 'Сом', isActive: false },
      contributorCount: 3,
      reportCount: 4,
    },
    {
      fish: { id: 'fish-beluga', name: 'Белуга', isActive: true },
      contributorCount: 2,
      reportCount: 1,
    },
  ],
  reports: [
    baseReport,
    {
      ...baseReport,
      id: 'report-som',
      fish: { id: 'fish-som', name: 'Сом' },
      bait: { id: 'bait-2', name: 'Мотыль' },
      fishingMethod: 'BAIT_FISHING',
      fishingNote: 'FROM_BOTTOM',
      spinningSize: null,
      spinningSpeed: null,
      userNoteRaw: null,
    },
  ],
};

function sectionNamed(name: string): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (section === null) throw new Error(`Не найден раздел «${name}»`);
  return section;
}

describe('LocationObservations', () => {
  test('renders ranked observed Fish and the exact dense Location catch columns', async () => {
    const user = userEvent.setup();
    render(<LocationObservations baseId="base-1" data={observations} />);

    const rankedTable = within(sectionNamed('Пойманные рыбы')).getByRole('table');
    const rankedRows = within(rankedTable).getAllByRole('row');
    expect(rankedRows[1]).toHaveTextContent('1СомИсторическая запись3 рыбаков · 4 уловов');
    expect(rankedRows[2]).toHaveTextContent('2Белуга2 рыбаков · 1 уловов');

    await user.click(screen.getByText('Рыбы: 2 из 2'));
    expect(screen.getByRole('checkbox', { name: 'Сом' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Белуга' })).toBeChecked();

    const catchTable = within(sectionNamed('Уловы на локации')).getByRole('table');
    expect(
      within(catchTable)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      '№',
      'Рыба',
      'Вес',
      'Наживка / приманка',
      'Способ / настройки',
      'Яма / точка',
      'Автор',
      'Дата',
    ]);
    expect(screen.queryByText('Ахтуба')).not.toBeInTheDocument();
    expect(screen.queryByText('7. Протока')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Улов №1: подробнее' })).toHaveAttribute(
      'href',
      '/catches/report-beluga',
    );
    expect(screen.getAllByRole('link', { name: 'Белуга' })).toHaveLength(2);
    for (const link of screen.getAllByRole('link', { name: 'Белуга' })) {
      expect(link).toHaveAttribute('href', '/fish/fish-beluga?baseIds=base-1');
    }
    expect(screen.queryByRole('link', { name: 'Сом' })).not.toBeInTheDocument();

    const belugaRow = screen.getByRole('link', { name: 'Улов №1: подробнее' }).closest('tr');
    expect(belugaRow).not.toBeNull();
    const cells = within(belugaRow as HTMLElement).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('Спиннинг · Средняя · Медленная · вполводы');
    expect(cells[4]).toHaveTextContent('Яма 7,63 м · левый край рюкзака');
    expect(cells[4]).not.toHaveTextContent('вполводы');
    expect(within(catchTable).getByText('Комментарий:')).toBeVisible();
  });

  test('filters both sections while keeping unchecked caught Fish selectable', async () => {
    const user = userEvent.setup();
    render(<LocationObservations baseId="base-1" data={observations} />);
    await user.click(screen.getByText('Рыбы: 2 из 2'));

    const somCheckbox = screen.getByRole('checkbox', { name: 'Сом' });
    await user.click(somCheckbox);

    expect(somCheckbox).not.toBeChecked();
    expect(screen.getByText('Рыбы: 1 из 2')).toBeVisible();
    expect(
      within(sectionNamed('Пойманные рыбы')).queryByRole('cell', { name: /Сом/u }),
    ).not.toBeInTheDocument();
    expect(within(sectionNamed('Уловы на локации')).queryByText('Сом')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Сом' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Снять все' }));
    expect(
      within(sectionNamed('Пойманные рыбы')).getByText('Выберите хотя бы одну рыбу.'),
    ).toBeVisible();
    expect(
      within(sectionNamed('Уловы на локации')).getByText(
        'Выберите хотя бы одну рыбу, чтобы увидеть уловы.',
      ),
    ).toBeVisible();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  test('renders a quiet empty state without inventing selector Fish', () => {
    render(<LocationObservations baseId="base-1" data={{ observedFish: [], reports: [] }} />);

    expect(screen.getByText('На этой локации пока нет опубликованных уловов.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
