import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import type { BaitStatistic } from '@/lib/bait-statistics-api';
import { BaitStatisticsTable } from './bait-statistics-table';

function statistic(index: number): BaitStatistic {
  return {
    bait: { id: `bait-${index}`, name: `Наживка ${index}`, isActive: index !== 1 },
    reportsCount: 20 - index,
  };
}

describe('BaitStatisticsTable', () => {
  test('renders the first five server-sorted Baits and expands locally', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 7 }, (_, index) => statistic(index + 1));
    render(<BaitStatisticsTable items={items} />);

    const table = screen.getByRole('table', {
      name: 'На что ловится выбранная рыба на выбранной базе',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['№', 'Наживка / приманка', 'Уловов']);
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(screen.getByText('Наживка 1').parentElement).toHaveTextContent('Сейчас неактивна');
    expect(screen.queryByText('Наживка 6')).not.toBeInTheDocument();

    const showAll = screen.getByRole('button', { name: 'Показать все' });
    expect(showAll).toHaveAttribute('aria-expanded', 'false');
    await user.click(showAll);
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(screen.getByText('Наживка 7')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  test('shows raw report counts and no expansion control for five items', () => {
    render(
      <BaitStatisticsTable items={Array.from({ length: 5 }, (_, index) => statistic(index + 1))} />,
    );

    expect(screen.getByTitle('19 отчётов об уловах')).toHaveTextContent('19');
    expect(screen.queryByRole('button', { name: 'Показать все' })).not.toBeInTheDocument();
    expect(screen.queryByText(/рыбаков|способ ловли|последний отчёт/i)).not.toBeInTheDocument();
  });
});
