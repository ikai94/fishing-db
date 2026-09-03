import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import styles from '../../../public-catalog.module.css';
import type { FishCatchAggregate } from '@/lib/fish-catch-aggregates-api';
import {
  formatFishCatchHoleSpotSummary,
  formatFishCatchPlace,
  formatFishCatchTextSummary,
  formatObservedAndMaximumWeight,
  formatPublicFishCatchDate,
  formatPublicFishCatchWeight,
  formatSpinningCombination,
  formatSpinningCombinations,
  PublicFishCatchTable,
} from './public-fish-catch-table';

const aggregate: FishCatchAggregate = {
  fish: { id: 'fish-1', name: 'Сом' },
  fishingBase: { id: 'base-1', name: 'Ахтуба' },
  location: { id: 'location-1', number: 7, name: 'Судачий откос' },
  bait: { id: 'bait-1', name: 'Мотыль', isActive: false },
  spinningCombinations: [
    { spinningSpeed: 'MEDIUM', spinningSize: 'MEDIUM' },
    { spinningSpeed: 'MEDIUM', spinningSize: 'LARGE' },
    { spinningSpeed: 'MEDIUM', spinningSize: null },
    { spinningSpeed: null, spinningSize: 'LARGE' },
  ],
  holeSpotSummary: {
    distinctCount: 1,
    value: { holeDepthCm: 603, spotPositionRaw: 'над леской' },
  },
  userNoteRawSummary: { distinctCount: 2, value: null },
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

  test('formats the approved speed/size abbreviations and empty fallback', () => {
    expect(formatSpinningCombination({ spinningSpeed: 'SLOW', spinningSize: 'SMALL' })).toBe(
      'медл/мал',
    );
    expect(formatSpinningCombination({ spinningSpeed: 'FAST', spinningSize: null })).toBe(
      'быстр/-',
    );
    expect(formatSpinningCombination({ spinningSpeed: null, spinningSize: 'LARGE' })).toBe('-/бол');
    expect(formatSpinningCombinations([])).toBe('—');
  });

  test('formats the compact place and exact distinct-text summaries', () => {
    expect(formatFishCatchPlace(aggregate)).toBe('Ахтуба, 7. Судачий откос');
    expect(formatFishCatchTextSummary({ distinctCount: 0, value: null })).toBe('—');
    expect(formatFishCatchTextSummary({ distinctCount: 1, value: '  у блокнота  ' })).toBe(
      '  у блокнота  ',
    );
    expect(formatFishCatchTextSummary({ distinctCount: 3, value: null })).toBe('несколько (3)');
  });

  test('formats every approved hole/landmark summary state', () => {
    expect(
      formatFishCatchHoleSpotSummary({
        distinctCount: 1,
        value: { holeDepthCm: 603, spotPositionRaw: 'над леской' },
      }),
    ).toBe('6.03 м над леской');
    expect(
      formatFishCatchHoleSpotSummary({
        distinctCount: 1,
        value: { holeDepthCm: 603, spotPositionRaw: null },
      }),
    ).toBe('6.03 м');
    expect(
      formatFishCatchHoleSpotSummary({
        distinctCount: 1,
        value: { holeDepthCm: null, spotPositionRaw: 'справа' },
      }),
    ).toBe('справа');
    expect(formatFishCatchHoleSpotSummary({ distinctCount: 0, value: null })).toBe('—');
    expect(formatFishCatchHoleSpotSummary({ distinctCount: 3, value: null })).toBe('несколько (3)');
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
    ).toEqual([
      '№',
      'База · Локация',
      'Яма / ориентир',
      'На что',
      'Проводка / размер',
      'Комментарий',
      'Уловов / рыбаков',
      'Наблюдаемый / максимальный вес',
    ]);
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(
      '1Ахтуба, 7. Судачий откос6.03 м над лескойМотыльСейчас неактивнаср/ср, ср/бол, ср/-, -/болнесколько (2)18 / 71.25 кг / 2 кг',
    );
    expect(rows[2]).toHaveTextContent(
      '2Ахтуба, 7. Судачий откос6.03 м над лескойОпарышср/ср, ср/бол, ср/-, -/болнесколько (2)3 / 21.25 кг / 2 кг',
    );
    expect(within(rows[1]!).getByTitle('Ахтуба, 7. Судачий откос')).toHaveTextContent(
      'Ахтуба, 7. Судачий откос',
    );
    expect(within(rows[1]!).getByTitle('6.03 м над леской')).toHaveTextContent('6.03 м над леской');
    expect(screen.getByTitle('18 уловов / 7 разных рыбаков')).toHaveTextContent('18 / 7');
  });

  test('contains no author, date, private field, or report-detail UI', () => {
    render(<PublicFishCatchTable rows={[aggregate]} />);

    const table = screen.getByRole('table');
    expect(within(table).queryByRole('link')).not.toBeInTheDocument();
    expect(within(table).queryByText(/автор|дата|условия/i)).not.toBeInTheDocument();
    expect(within(table).queryByRole('time')).not.toBeInTheDocument();
  });

  test('keeps a long single raw value in one compact titled cell', () => {
    const longComment = 'Длинный комментарий '.repeat(20).trim();
    render(
      <PublicFishCatchTable
        rows={[
          {
            ...aggregate,
            holeSpotSummary: { distinctCount: 0, value: null },
            userNoteRawSummary: { distinctCount: 1, value: longComment },
          },
        ]}
      />,
    );

    expect(screen.getByText('—')).toHaveClass(styles.aggregateSingleLineCell);
    expect(screen.getByTitle(longComment)).toHaveClass(styles.aggregateSingleLineCell);
    expect(screen.getByTitle(longComment)).toHaveTextContent(longComment);
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
