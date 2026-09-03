import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { HoleStatistic } from '@/lib/hole-statistics-api';
import { CommonHoleTable, formatCommonHoleDepth, formatCommonHolePlace } from './common-hole-table';

const confirmed: HoleStatistic = {
  fishingBase: { id: 'base-active', name: 'Амур', isActive: true },
  location: {
    id: 'location-active',
    number: 12,
    name: 'Судачий откос',
    isActive: true,
  },
  holeDepthCm: 600,
  spotPosition: 'у блокнота',
  uniqueUsersCount: 7,
  reportsCount: 18,
  latestReportCreatedAt: '2026-08-12T22:30:00.000Z',
};

const single: HoleStatistic = {
  fishingBase: { id: 'base-inactive', name: 'Старая Волга', isActive: false },
  location: {
    id: 'location-under-inactive-base',
    number: 4,
    name: 'Исторический плёс',
    isActive: true,
  },
  holeDepthCm: 763,
  spotPosition: null,
  uniqueUsersCount: 1,
  reportsCount: 100,
  latestReportCreatedAt: '2026-08-11T10:00:00.000Z',
};

describe('CommonHoleTable', () => {
  test('renders the compact columns, one-line place, depth, counts, and missing position', () => {
    render(<CommonHoleTable items={[confirmed, single]} />);

    const table = screen.getByRole('table', {
      name: 'Общие ямы и позиции выбранной рыбы на выбранных базах',
    });
    expect(screen.getByRole('region', { name: 'Таблица общих рыболовных точек' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['№', 'База · Локация', 'Яма', 'Позиция', 'Рыбаков', 'Уловов']);
    expect(within(table).getByTitle('Амур, 12. Судачий откос')).toHaveTextContent(
      'Амур, 12. Судачий откос',
    );
    expect(within(table).getByText('6.00 м')).toBeVisible();
    expect(within(table).getByText('7.63 м')).toBeVisible();
    expect(within(table).getByText('позиция не указана')).toBeVisible();
    expect(within(table).getByTitle('7 разных рыбаков')).toHaveTextContent('7');
    expect(within(table).getByTitle('18 отчётов об уловах')).toHaveTextContent('18');
    expect(within(table).queryByText('Последний отчёт')).not.toBeInTheDocument();
    expect(within(table).queryByRole('time')).not.toBeInTheDocument();
    expect(table.querySelector('article')).toBeNull();
  });

  test('keeps community-confirmed rows ahead of prolific one-user rows and inserts a divider', () => {
    render(<CommonHoleTable items={[single, confirmed]} />);

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(screen.getByRole('table').querySelectorAll('tbody')).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Амур');
    expect(rows[1]).toHaveTextContent('718');
    expect(rows[2]).toHaveTextContent('Одиночные наблюдения');
    expect(rows[3]).toHaveTextContent('Старая Волга');
    expect(rows[3]).toHaveTextContent('1100');
  });

  test('links only active catalog destinations', () => {
    const inactiveLocation: HoleStatistic = {
      ...confirmed,
      fishingBase: { id: 'base-current', name: 'Текущая база', isActive: true },
      location: {
        id: 'location-inactive',
        number: 8,
        name: 'Закрытая локация',
        isActive: false,
      },
      spotPosition: 'левая кромка',
    };

    render(<CommonHoleTable items={[confirmed, inactiveLocation, single]} />);

    expect(screen.getByRole('link', { name: 'Амур' })).toHaveAttribute(
      'href',
      '/bases/base-active',
    );
    expect(screen.getByRole('link', { name: '12. Судачий откос' })).toHaveAttribute(
      'href',
      '/locations/location-active',
    );
    expect(screen.getByRole('link', { name: 'Текущая база' })).toHaveAttribute(
      'href',
      '/bases/base-current',
    );
    expect(screen.queryByRole('link', { name: '8. Закрытая локация' })).not.toBeInTheDocument();
    expect(screen.getByTitle('Текущая база, 8. Закрытая локация')).toHaveTextContent(
      'Текущая база, 8. Закрытая локация',
    );
    expect(screen.queryByRole('link', { name: 'Старая Волга' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '4. Исторический плёс' })).not.toBeInTheDocument();
  });

  test('labels a table containing only single-user observations without hiding the rows', () => {
    render(<CommonHoleTable items={[single]} />);

    expect(screen.getByText('Подтверждённых несколькими рыбаками точек пока нет.')).toBeVisible();
    expect(screen.getByText('Ниже показаны одиночные наблюдения.')).toBeVisible();
    expect(screen.getByText('Одиночные наблюдения')).toBeVisible();
    expect(screen.getByTitle('Старая Волга, 4. Исторический плёс')).toBeVisible();
  });
});

describe('formatCommonHoleDepth', () => {
  test.each([
    [600, '6.00'],
    [763, '7.63'],
    [5, '0.05'],
  ])(
    'formats exact integer centimeters %i without floating-point arithmetic',
    (value, expected) => {
      expect(formatCommonHoleDepth(value)).toBe(expected);
    },
  );
});

test('formats Base and Location as one compact line', () => {
  expect(
    formatCommonHolePlace({
      fishingBase: { id: 'base', name: 'Восточный Крит', isActive: true },
      location: { id: 'location', number: 3, name: 'Порт Ираклион', isActive: true },
    }),
  ).toBe('Восточный Крит, 3. Порт Ираклион');
});
