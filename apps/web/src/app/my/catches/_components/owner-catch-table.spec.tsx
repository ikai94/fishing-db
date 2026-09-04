import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';
import {
  formatHoleAndSpot,
  formatPlace,
  formatSpinningSettings,
  OwnerCatchTable,
} from './owner-catch-table';

const report: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'Амга' },
  location: { id: 'location-1', number: 7, name: 'Лазурный берег' },
  fish: { id: 'fish-1', name: 'Кижуч' },
  bait: { id: 'bait-1', name: 'Vib-rapan' },
  weightGrams: 7_242,
  weightAssessment: {
    classification: 'mutant',
    minWeightGrams: 100,
    maxWeightGrams: 10_000,
  },
  fishingMethod: 'SPINNING',
  holeDepthCm: 763,
  spotPositionRaw: 'левый край рюкзака',
  fishingNote: 'MIDWATER',
  spinningSize: 'MEDIUM',
  spinningSpeed: 'SLOW',
  userNoteRaw: 'Очень длинный комментарий об условиях этого улова после дождя',
  createdAt: '2026-08-12T22:30:00.000Z',
  updatedAt: '2026-08-12T22:30:00.000Z',
};

describe('OwnerCatchTable', () => {
  test('renders every catch in one row with compact comment, detail, edit and delete actions', async () => {
    const tester = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <OwnerCatchTable reports={[report]} isBanned={false} deletingId={null} onDelete={onDelete} />,
    );

    const table = screen.getByRole('table', { name: 'Личный архив уловов' });
    expect(screen.getByRole('region', { name: 'Таблица моих уловов' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Рыба',
      'Вес',
      'База · локация',
      'Снасть',
      'Яма / позиция',
      'Проводка / размер',
      'Комментарий',
      'Добавлено',
      'Действия',
    ]);
    expect(screen.getByRole('link', { name: 'Кижуч' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute(
      'href',
      '/catches/report-1',
    );
    expect(screen.getByRole('link', { name: 'Редактировать' })).toHaveAttribute(
      'href',
      '/catches/report-1/edit',
    );
    expect(screen.getByTitle(report.userNoteRaw as string)).toHaveTextContent(
      report.userNoteRaw as string,
    );
    expect(screen.getByTitle('Амга, 7. Лазурный берег')).toHaveTextContent(
      'Амга, 7. Лазурный берег',
    );
    expect(screen.getByTitle('Vib-rapan')).toHaveTextContent('Vib-rapan');
    expect(screen.getByTitle('медл/ср')).toHaveTextContent('медл/ср');
    expect(within(table).queryByText('Спиннинг')).not.toBeInTheDocument();
    expect(within(table).queryByText('Вполводы')).not.toBeInTheDocument();

    await tester.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDelete).toHaveBeenCalledWith(report);
  });

  test('keeps detail available but disables edit and delete for a banned owner', () => {
    render(<OwnerCatchTable reports={[report]} isBanned deletingId={null} onDelete={vi.fn()} />);

    expect(screen.getByRole('link', { name: 'Открыть' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Изменение недоступно' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Удаление недоступно' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Редактировать' })).not.toBeInTheDocument();
  });

  test('formats optional observation columns without inventing values', () => {
    expect(formatHoleAndSpot({ holeDepthCm: null, spotPositionRaw: null })).toBe('—');
    expect(formatHoleAndSpot({ holeDepthCm: 600, spotPositionRaw: 'справа' })).toBe(
      'Яма 6,00 м · справа',
    );
    expect(formatPlace(report)).toBe('Амга, 7. Лазурный берег');
    expect(
      formatSpinningSettings({
        fishingMethod: 'SPINNING',
        spinningSize: 'SMALL',
        spinningSpeed: 'FAST',
      }),
    ).toBe('быстр/мал');
    expect(
      formatSpinningSettings({
        fishingMethod: 'SPINNING',
        spinningSize: null,
        spinningSpeed: null,
      }),
    ).toBe('—');
    expect(
      formatSpinningSettings({
        fishingMethod: 'SPINNING',
        spinningSize: null,
        spinningSpeed: 'MEDIUM',
      }),
    ).toBe('ср/-');
    expect(
      formatSpinningSettings({
        fishingMethod: 'SPINNING',
        spinningSize: 'LARGE',
        spinningSpeed: null,
      }),
    ).toBe('-/бол');
    expect(
      formatSpinningSettings({
        fishingMethod: 'BAIT_FISHING',
        spinningSize: null,
        spinningSpeed: null,
      }),
    ).toBe('—');
  });
});
