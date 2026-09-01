import { render, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { WeightStatisticsTable } from './weight-statistics-table';

test('renders only useful non-zero classification rows in a compact table', () => {
  render(
    <WeightStatisticsTable
      counts={{
        'suspicious-low': 0,
        ordinary: 12,
        mutant: 2,
        'suspicious-high': 0,
        unclassified: 1,
      }}
    />,
  );

  const table = screen.getByRole('table', {
    name: 'Классификация веса уловов на выбранных базах',
  });
  expect(within(table).getByText('Обычный')).toBeInTheDocument();
  expect(within(table).getByText('Мутант')).toBeInTheDocument();
  expect(within(table).getByText('Без классификации')).toBeInTheDocument();
  expect(within(table).queryByText('Подозрительно низкий')).not.toBeInTheDocument();
});
