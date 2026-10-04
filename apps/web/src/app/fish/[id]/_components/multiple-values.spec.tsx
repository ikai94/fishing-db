import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ values: vi.fn() }));
vi.mock('@/lib/fish-catch-aggregates-api', () => ({ listFishCatchValues: mocks.values }));
import { formatVariantsCount, LazyCatchValues, MultipleValues } from './multiple-values';
import type { FishCatchAggregate } from '@/lib/fish-catch-aggregates-api';

beforeEach(() => mocks.values.mockReset());

const row = {
  fish: { id: 'fish' },
  location: { id: 'location' },
  bait: { id: 'bait' },
  userNoteRawSummary: { distinctCount: 3, value: null },
  holeSpotSummary: { distinctCount: 2, value: null },
} as FishCatchAggregate;

test('none and one display directly; multiple values use keyboard-accessible disclosure', async () => {
  const { rerender } = render(<MultipleValues values={[]} label="Комментарии" />);
  expect(screen.getByText('—')).toBeVisible();
  rerender(<MultipleValues values={['  точно как было  ']} label="Комментарии" />);
  expect(screen.getByText('точно как было')).toHaveTextContent('точно как было');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  rerender(<MultipleValues values={['Первый', 'Второй']} label="Комментарии" />);
  const summary = screen.getByText('2 варианта');
  summary.focus();
  expect(summary).toHaveFocus();
  await userEvent.click(summary);
  expect(summary.closest('details')).toHaveAttribute('open');
  expect(screen.getByRole('list', { name: 'Комментарии' })).toBeVisible();
});

test('lazy comments preserve raw input and paginate only on explicit click', async () => {
  mocks.values
    .mockResolvedValueOnce({ items: ['  Комментарий  ', 'Другой'], nextOffset: 25 })
    .mockResolvedValueOnce({ items: ['Третий'], nextOffset: null });
  render(<LazyCatchValues row={row} field="comment" />);
  expect(mocks.values).not.toHaveBeenCalled();
  const details = screen.getByText('3 варианта').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(screen.getByText('Комментарий').textContent).toBe('  Комментарий  '));
  fireEvent.click(screen.getByRole('button', { name: 'Ещё варианты' }));
  expect(await screen.findByText('Третий')).toBeVisible();
  expect(mocks.values).toHaveBeenLastCalledWith(row, 'comment', 25, expect.any(AbortSignal));
  details.open = false;
  fireEvent(details, new Event('toggle'));
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(mocks.values).toHaveBeenCalledTimes(2));
  expect(screen.getAllByText('Третий')).toHaveLength(1);
});

test('hole values show exact centimeters and landmark, without fishing condition', async () => {
  mocks.values.mockResolvedValue({
    items: [
      { holeDepthCm: 763, spotPositionRaw: 'Правее ёлки' },
      { holeDepthCm: null, spotPositionRaw: 'слева' },
    ],
    nextOffset: null,
  });
  render(<LazyCatchValues row={row} field="hole" />);
  const details = screen.getByText('2 варианта').closest('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  expect(await screen.findByText('7.63 м Правее ёлки')).toBeVisible();
});

test.each([
  [3, '3 варианта'],
  [11, '11 вариантов'],
  [21, '21 вариант'],
  [25, '25 вариантов'],
] as const)('declines %i variants', (count, expected) => {
  expect(formatVariantsCount(count)).toBe(expected);
});
