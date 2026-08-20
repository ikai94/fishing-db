import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { FishingConditionStatistic } from '@/lib/fishing-condition-statistics-api';
import { FishingConditionStatisticsTable } from './fishing-condition-statistics-table';

const baitFishing: FishingConditionStatistic = {
  fishingMethod: 'BAIT_FISHING',
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-12T22:30:00.000Z',
};

const baitFishingWithNote: FishingConditionStatistic = {
  ...baitFishing,
  fishingNote: 'FROM_BOTTOM',
  uniqueUsersCount: 4,
  reportsCount: 9,
  latestReportCreatedAt: '2026-08-11T10:00:00.000Z',
};

const spinning: FishingConditionStatistic = {
  fishingMethod: 'SPINNING',
  fishingNote: 'MIDWATER',
  spinningSize: 'MEDIUM',
  spinningSpeed: 'FAST',
  uniqueUsersCount: 3,
  reportsCount: 5,
  latestReportCreatedAt: '2026-08-10T10:00:00.000Z',
};

describe('FishingConditionStatisticsTable', () => {
  test('renders a dense accessible reference table in the server-provided order', () => {
    render(
      <FishingConditionStatisticsTable items={[baitFishing, baitFishingWithNote, spinning]} />,
    );

    const region = screen.getByRole('region', {
      name: 'Таблица статистики условий ловли',
    });
    const table = screen.getByRole('table', {
      name: 'Условия ловли в уловах выбранной рыбы на выбранных базах',
    });

    expect(region).toHaveAttribute('tabindex', '0');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      '№',
      'Способ ловли',
      'Размер спиннинга',
      'Скорость проводки',
      'Условие ловли',
      'Рыбаков',
      'Уловов',
      'Последний отчёт',
    ]);
    expect(screen.getByText(/сначала по числу разных рыбаков/i)).toBeVisible();

    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('1Ловля на наживкуне применяетсяне применяетсяне указано718');
    expect(rows[2]).toHaveTextContent('2Ловля на наживкуне применяетсяне применяетсясо дна49');
    expect(rows[3]).toHaveTextContent('3СпиннингСредняяБыстраявполводы35');
    expect(within(table).getByText('13.08.26').closest('time')).toHaveAttribute(
      'datetime',
      baitFishing.latestReportCreatedAt,
    );
    expect(table.querySelector('article')).toBeNull();
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  test('exposes observation counts without effectiveness or recommendation wording', () => {
    render(<FishingConditionStatisticsTable items={[baitFishing]} />);

    expect(screen.getByTitle('7 разных рыбаков')).toHaveTextContent('7');
    expect(screen.getByTitle('18 отчётов об уловах')).toHaveTextContent('18');
    expect(
      screen.queryByText(/best|лучш|рекоменд|интенсив|оценк|вероятн/i),
    ).not.toBeInTheDocument();
  });
});
