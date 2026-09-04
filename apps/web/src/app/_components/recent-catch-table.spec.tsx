import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';
import { formatHoleAndSpot, formatRecentCatchDate, RecentCatchTable } from './recent-catch-table';

const report: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'Амур' },
  location: { id: 'location-1', number: 7, name: 'Судачий откос' },
  fish: { id: 'fish-1', name: 'Белуга' },
  bait: { id: 'bait-1', name: 'Vib-rapan' },
  weightGrams: 7_242,
  weightAssessment: {
    classification: 'ordinary',
    minWeightGrams: 100,
    maxWeightGrams: 10_000,
  },
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

describe('RecentCatchTable', () => {
  test('renders the compact columns and links the Fish name to CatchReport detail', () => {
    render(<RecentCatchTable reports={[report]} />);

    const table = screen.getByRole('table', { name: 'Десять последних публичных уловов' });
    expect(screen.getByRole('region', { name: 'Таблица недавних уловов' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      '№',
      'Рыба',
      'Вес',
      'База · локация',
      'На что',
      'Яма / ориентир',
      'Автор',
      'Добавлено',
    ]);
    expect(screen.getByRole('link', { name: 'Белуга' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(table).toHaveTextContent(
      '1Белуга7.242 кгАмур7. Судачий откосVib-rapanЯма 7,63 м · левый край рюкзакаРыбак13.08.26',
    );
    expect(within(table).queryByText('вполводы')).not.toBeInTheDocument();
    expect(within(table).queryByText('после дождя')).not.toBeInTheDocument();
  });

  test('formats optional hole observations and invalid dates without inventing values', () => {
    expect(formatHoleAndSpot({ holeDepthCm: null, spotPositionRaw: null })).toBe('—');
    expect(formatHoleAndSpot({ holeDepthCm: 600, spotPositionRaw: null })).toBe('Яма 6,00 м');
    expect(formatHoleAndSpot({ holeDepthCm: null, spotPositionRaw: 'справа' })).toBe('справа');
    expect(formatRecentCatchDate('not-a-date')).toBe('not-a-date');
  });
});
