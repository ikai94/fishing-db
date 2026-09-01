import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { FishCatchAggregate } from '@/lib/fish-catch-aggregates-api';
import {
  formatObservedAndMaximumWeight,
  formatPublicFishCatchDate,
  formatPublicFishCatchWeight,
  PublicFishCatchTable,
} from './public-fish-catch-table';

const aggregate: FishCatchAggregate = {
  fish: { id: 'fish-1', name: 'Сом' },
  fishingBase: { id: 'base-1', name: 'Ахтуба' },
  location: { id: 'location-1', number: 7, name: 'Судачий откос' },
  bait: { id: 'bait-1', name: 'Мотыль', isActive: false },
  intensity: 18,
  contributorCount: 7,
  maxObservedWeightGrams: 1_250,
  maxObservedWeightAssessment: {
    classification: 'ordinary',
    minWeightGrams: 100,
    maxWeightGrams: 2_000,
  },
};

describe('public Fish catch formatters', () => {
  test.each([
    [40, '40 г'],
    [950, '950 г'],
    [1_000, '1 кг'],
    [1_250, '1.25 кг'],
    [22_779, '22.779 кг'],
  ])('formats %i integer grams as %s', (grams, expected) => {
    expect(formatPublicFishCatchWeight(grams)).toBe(expected);
  });

  test.each([
    [11_296, 16_000, '11.296 кг / 16 кг'],
    [11_296, null, '11.296 кг / —'],
    [16_500, 16_000, '16.5 кг / 16 кг'],
  ])('formats observed %i grams against BaseFish maximum %s', (observed, maximum, expected) => {
    expect(formatObservedAndMaximumWeight(observed, maximum)).toBe(expected);
  });

  test('keeps the shared compact Moscow date formatter for statistics tables', () => {
    expect(formatPublicFishCatchDate('2026-08-12T22:30:00.000Z')).toBe('13.08.26');
    expect(formatPublicFishCatchDate('not-a-date')).toBe('not-a-date');
  });
});

describe('PublicFishCatchTable', () => {
  test('renders one compact row per aggregate identity with observed/BaseFish maximum wording', () => {
    render(
      <PublicFishCatchTable
        rows={[
          aggregate,
          {
            ...aggregate,
            bait: { id: 'bait-2', name: 'Опарыш', isActive: true },
            intensity: 3,
            contributorCount: 2,
          },
        ]}
      />,
    );

    const table = screen.getByRole('table', {
      name: 'Агрегированные уловы выбранной рыбы на выбранных базах',
    });
    expect(screen.getByRole('region', { name: 'Таблица агрегированных уловов' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['№', 'База · Локация', 'На что', 'Интенсивность', 'Наблюдаемый / максимальный вес']);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(
      '1Ахтуба7. Судачий откосМотыльСейчас неактивна18участников: 71.25 кг / 2 кг',
    );
    expect(rows[2]).toHaveTextContent('2Ахтуба7. Судачий откосОпарыш3участников: 21.25 кг / 2 кг');
    expect(screen.getByTitle('18 отчётов об уловах')).toHaveTextContent('18');
    expect(screen.getByTitle('7 разных участников')).toHaveTextContent('участников: 7');
  });

  test('contains no individual observation, author, date, or report-detail UI', () => {
    render(<PublicFishCatchTable rows={[aggregate]} />);

    const table = screen.getByRole('table');
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(table).queryByText(/автор|дата|яма|точка|условия|комментарий/i),
    ).not.toBeInTheDocument();
    expect(within(table).queryByRole('time')).not.toBeInTheDocument();
  });

  test('shows only anomaly classifications and an unknown BaseFish maximum fallback', () => {
    const { rerender } = render(
      <PublicFishCatchTable
        rows={[
          {
            ...aggregate,
            maxObservedWeightAssessment: {
              ...aggregate.maxObservedWeightAssessment,
              classification: 'mutant',
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('1.25 кг / 2 кг')).toBeInTheDocument();
    expect(screen.getByText('Мутант')).toBeInTheDocument();

    rerender(
      <PublicFishCatchTable
        rows={[
          {
            ...aggregate,
            maxObservedWeightAssessment: {
              classification: 'unclassified',
              minWeightGrams: null,
              maxWeightGrams: null,
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('1.25 кг / —')).toBeInTheDocument();
    expect(screen.queryByText('Без классификации')).not.toBeInTheDocument();

    rerender(<PublicFishCatchTable rows={[aggregate]} />);
    expect(screen.queryByText('Обычный')).not.toBeInTheDocument();
  });
});
