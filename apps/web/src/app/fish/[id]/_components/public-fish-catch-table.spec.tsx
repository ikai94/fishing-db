import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';
import {
  formatPublicFishCatchCondition,
  formatPublicFishCatchDate,
  formatPublicFishCatchWeight,
  PublicFishCatchTable,
} from './public-fish-catch-table';

const baseReport: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Arina' },
  fishingBase: { id: 'base-1', name: 'Ахтуба' },
  location: { id: 'location-1', number: 7, name: 'Судачий откос' },
  fish: { id: 'fish-1', name: 'Сом' },
  bait: { id: 'bait-1', name: 'Мотыль' },
  weightGrams: 1_250,
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: 763,
  spotPositionRaw: 'левый край рюкзака',
  fishingNote: 'FROM_BOTTOM',
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: null,
  createdAt: '2026-08-12T22:30:00.000Z',
  updatedAt: '2026-08-12T22:30:00.000Z',
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

  test('formats bait-fishing observations from only their persisted fields', () => {
    expect(formatPublicFishCatchCondition(baseReport)).toBe('Яма 7.63 м · со дна');
    expect(
      formatPublicFishCatchCondition({
        ...baseReport,
        fishingNote: null,
        holeDepthCm: 600,
      }),
    ).toBe('Яма 6.00 м');
  });

  test('uses historical SPINNING and skips optional fields that are absent', () => {
    expect(
      formatPublicFishCatchCondition({
        ...baseReport,
        fishingMethod: 'SPINNING',
        fishingNote: null,
        holeDepthCm: 340,
        spinningSize: 'MEDIUM',
        spinningSpeed: 'SLOW',
      }),
    ).toBe('Спиннинг · средняя · медленная · яма 3.40 м');
    expect(
      formatPublicFishCatchCondition({
        ...baseReport,
        fishingMethod: 'SPINNING',
        fishingNote: 'MIDWATER',
        holeDepthCm: null,
        spinningSize: null,
        spinningSpeed: null,
      }),
    ).toBe('Спиннинг · вполводы');
  });

  test('formats createdAt as a compact Moscow calendar date', () => {
    expect(formatPublicFishCatchDate('2026-08-12T22:30:00.000Z')).toBe('13.08.26');
    expect(formatPublicFishCatchDate('not-a-date')).toBe('not-a-date');
  });
});

describe('PublicFishCatchTable', () => {
  test('renders the public projection as a semantic compact table', () => {
    render(<PublicFishCatchTable reports={[baseReport, { ...baseReport, id: 'report-2' }]} />);

    const table = screen.getByRole('table', {
      name: 'Публичные уловы выбранной рыбы на выбранных базах',
    });
    expect(screen.getByRole('region', { name: 'Таблица публичных уловов' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      '№',
      'Вес',
      'База · Локация',
      'На что',
      'Условия ловли',
      'Точка / позиция',
      'Автор',
      'Дата',
    ]);
    expect(within(table).getAllByText('Ахтуба')).toHaveLength(2);
    expect(within(table).getAllByText('7. Судачий откос')).toHaveLength(2);
    expect(within(table).getAllByText('Мотыль')).toHaveLength(2);
    expect(within(table).getAllByText('Яма 7.63 м · со дна')).toHaveLength(2);
    expect(within(table).getAllByText('левый край рюкзака')).toHaveLength(2);
    expect(within(table).getAllByText('Arina')).toHaveLength(2);
    expect(within(table).getAllByText('13.08.26')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Улов №1: подробнее' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(screen.getByRole('link', { name: 'Улов №2: подробнее' })).toHaveAttribute(
      'href',
      '/catches/report-2',
    );
    expect(within(table).getAllByText('13.08.26')[0]?.closest('time')).toHaveAttribute(
      'datetime',
      baseReport.createdAt,
    );
    expect(table.querySelector('article')).toBeNull();
    expect(within(table).queryByRole('heading')).not.toBeInTheDocument();
  });

  test('renders a quiet missing-position dash and only public comments as secondary rows', () => {
    const reportWithPrivateSource = {
      ...baseReport,
      spotPositionRaw: null,
      userNoteRaw: 'возле коряги, после дождя',
      rawSourceText: 'СЕКРЕТНАЯ СТРОКА БЛОКНОТА',
    } satisfies CatchReport & { rawSourceText: string };

    render(<PublicFishCatchTable reports={[reportWithPrivateSource]} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('—')).toBeVisible();
    expect(within(table).getByText('Комментарий:')).toBeVisible();
    expect(within(table).getByText('возле коряги, после дождя')).toBeVisible();
    expect(within(table).getByText('Отчёт № 1.').className).toMatch(/visuallyHidden/u);
    expect(within(table).queryByText('СЕКРЕТНАЯ СТРОКА БЛОКНОТА')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  test('continues visual numbering when reports are appended', () => {
    const view = render(<PublicFishCatchTable reports={[baseReport]} />);

    expect(screen.getByRole('link', { name: 'Улов №1: подробнее' })).toBeVisible();
    view.rerender(
      <PublicFishCatchTable reports={[baseReport, { ...baseReport, id: 'report-2' }]} />,
    );

    expect(screen.getByRole('link', { name: 'Улов №2: подробнее' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: /Улов №/u })).toHaveLength(2);
  });
});
