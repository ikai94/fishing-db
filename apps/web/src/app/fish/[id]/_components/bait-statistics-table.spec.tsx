import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { BaitStatistic } from '@/lib/bait-statistics-api';
import { BaitStatisticsTable } from './bait-statistics-table';

const baitFishing: BaitStatistic = {
  bait: { id: 'bait-shared', name: 'Историческая наживка', isActive: true },
  fishingMethod: 'BAIT_FISHING',
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-12T22:30:00.000Z',
};

const spinning: BaitStatistic = {
  ...baitFishing,
  fishingMethod: 'SPINNING',
  uniqueUsersCount: 3,
  reportsCount: 5,
  latestReportCreatedAt: '2026-08-11T10:00:00.000Z',
};

const inactive: BaitStatistic = {
  bait: { id: 'bait-inactive', name: 'Старая приманка', isActive: false },
  fishingMethod: 'SPINNING',
  uniqueUsersCount: 1,
  reportsCount: 100,
  latestReportCreatedAt: '2026-08-10T10:00:00.000Z',
};

describe('BaitStatisticsTable', () => {
  test('renders a dense accessible reference table in the server-provided order', () => {
    render(<BaitStatisticsTable items={[baitFishing, spinning, inactive]} />);

    const region = screen.getByRole('region', {
      name: 'Таблица статистики наживок и приманок',
    });
    const table = screen.getByRole('table', {
      name: 'Наживки и приманки в уловах выбранной рыбы на выбранных базах',
    });

    expect(region).toHaveAttribute('tabindex', '0');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      '№',
      'Наживка / приманка',
      'Способ ловли в отчётах',
      'Рыбаков',
      'Уловов',
      'Последний отчёт',
    ]);
    expect(screen.getByText(/сначала по числу разных рыбаков/i)).toBeVisible();

    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveTextContent('1Историческая наживкаЛовля на наживку718');
    expect(rows[2]).toHaveTextContent('2Историческая наживкаСпиннинг35');
    expect(rows[3]).toHaveTextContent('3Старая приманкаСейчас неактивнаСпиннинг1100');
    expect(within(table).getByText('13.08.26').closest('time')).toHaveAttribute(
      'datetime',
      baitFishing.latestReportCreatedAt,
    );
    expect(table.querySelector('article')).toBeNull();
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
  });

  test('exposes transparent raw counts without recommendation or score wording', () => {
    render(<BaitStatisticsTable items={[baitFishing]} />);

    expect(screen.getByTitle('7 разных рыбаков')).toHaveTextContent('7');
    expect(screen.getByTitle('18 отчётов об уловах')).toHaveTextContent('18');
    expect(screen.queryByText(/best|лучш|рекоменд|интенсив|скор/i)).not.toBeInTheDocument();
  });
});
