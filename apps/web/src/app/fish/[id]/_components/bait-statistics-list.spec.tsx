import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { BaitStatistic } from '@/lib/bait-statistics-api';
import { BaitStatisticsList } from './bait-statistics-list';

const items: BaitStatistic[] = [
  {
    bait: { id: 'bait-1', name: 'Мотыль', isActive: false },
    reportsCount: 19,
  },
  {
    bait: { id: 'bait-2', name: 'Блесна', isActive: true },
    reportsCount: 7,
  },
];

describe('BaitStatisticsList', () => {
  test('renders every server-sorted Bait as a compact name/count list item', () => {
    render(<BaitStatisticsList items={items} />);

    const list = screen.getByRole('list', {
      name: 'Наживки и приманки по числу уловов',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(
      'Мотыль (сейчас неактивна) (19)',
    );
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Блесна (7)');
    expect(screen.getByTitle('19 отчётов об уловах')).toHaveTextContent('(19)');
    expect(screen.getByTitle('Сейчас неактивна')).toHaveTextContent('Мотыль');
    expect(within(list).queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать все' })).not.toBeInTheDocument();
  });
});
