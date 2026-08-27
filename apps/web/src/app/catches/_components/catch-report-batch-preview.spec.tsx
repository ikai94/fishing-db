import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCatchReportsBatch: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh, replace: mocks.routerReplace }),
}));

vi.mock('@/lib/catch-reports-api', () => ({
  createCatchReportsBatch: mocks.createCatchReportsBatch,
}));

vi.mock('./catch-report-draft-preview', () => ({
  CatchReportDraftPreview: ({
    draft,
    onCreateInputChange,
  }: {
    draft: { rawSourceText: string };
    onCreateInputChange: (input: unknown) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onCreateInputChange({
          locationId: 'location',
          fishId: `fish:${draft.rawSourceText}`,
          baitId: 'bait',
          weightGrams: 40,
          rawSourceText: draft.rawSourceText,
        })
      }
    >
      Подтвердить {draft.rawSourceText}
    </button>
  ),
}));

import { CatchReportBatchPreview } from './catch-report-batch-preview';
import { ApiError } from '@/lib/api-client';
import type { ParseCatchReportBatchResult } from '@/lib/catch-reports-api';

function result(duplicate = false): ParseCatchReportBatchResult {
  const draft = (rawSourceText: string) =>
    ({
      rawSourceText,
      canConfirm: true,
      issues: [],
      unresolvedFragments: [],
    }) as unknown as ParseCatchReportBatchResult['rows'][number]['draft'];
  return {
    rows: [
      {
        index: 0,
        sourceLine: 1,
        duplicateIndexes: duplicate ? [1] : [],
        draft: draft('первая'),
      },
      {
        index: 1,
        sourceLine: 3,
        duplicateIndexes: duplicate ? [0] : [],
        draft: draft(duplicate ? 'первая' : 'вторая'),
      },
    ],
  };
}

function attentionResult(): ParseCatchReportBatchResult {
  const draft = (
    rawSourceText: string,
    issues: ParseCatchReportBatchResult['rows'][number]['draft']['issues'] = [],
    canConfirm = true,
  ) =>
    ({
      rawSourceText,
      canConfirm,
      issues,
      unresolvedFragments: [],
    }) as unknown as ParseCatchReportBatchResult['rows'][number]['draft'];
  const warning = (message: string) => ({
    severity: 'WARNING' as const,
    code: 'UNRESOLVED_FRAGMENT',
    message,
  });
  return {
    rows: [
      { index: 0, sourceLine: 1, duplicateIndexes: [], draft: draft('чистая 1') },
      {
        index: 1,
        sourceLine: 2,
        duplicateIndexes: [],
        draft: draft('предупреждение 2', [warning('Проверить строку 2')]),
      },
      {
        index: 2,
        sourceLine: 3,
        duplicateIndexes: [],
        draft: draft(
          'чужая рыба 3',
          [
            {
              severity: 'BLOCKING',
              code: 'FISH_NOT_IN_BASE',
              field: 'fish',
              message: 'Рыба не связана с выбранной рыболовной базой',
            },
          ],
          false,
        ),
      },
      {
        index: 3,
        sourceLine: 5,
        duplicateIndexes: [],
        draft: draft('предупреждение 5', [warning('Проверить строку 5')]),
      },
      { index: 4, sourceLine: 6, duplicateIndexes: [], draft: draft('чистая 6') },
    ],
  };
}

describe('CatchReportBatchPreview', () => {
  beforeEach(() => {
    mocks.createCatchReportsBatch.mockReset();
    mocks.routerRefresh.mockReset();
    mocks.routerReplace.mockReset();
  });

  test('requires every selected row to be valid but allows explicit exclusion', async () => {
    const user = userEvent.setup();
    mocks.createCatchReportsBatch.mockResolvedValue({ createdCount: 1, reportIds: ['report'] });
    render(<CatchReportBatchPreview result={result()} canSave />);

    const save = screen.getAllByRole('button', { name: 'Сохранить 2 улова' })[0]!;
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Подтвердить первая' }));
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Сохранить строку 3' }));

    const saveOne = screen.getAllByRole('button', { name: 'Сохранить 1 улов' })[0]!;
    expect(saveOne).toBeEnabled();
    await user.click(saveOne);

    await waitFor(() => expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1));
    expect(mocks.createCatchReportsBatch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ fishId: 'fish:первая', rawSourceText: 'первая' }),
    ]);
    expect(await screen.findByText('Создано отчётов: 1')).toBeInTheDocument();
  });

  test('warns but saves exact duplicate rows separately and protects against double submit', async () => {
    let resolve!: (value: unknown) => void;
    mocks.createCatchReportsBatch.mockReturnValue(
      new Promise((promiseResolve) => {
        resolve = promiseResolve;
      }),
    );
    render(<CatchReportBatchPreview result={result(true)} canSave />);

    expect(screen.getAllByText(/Строка не объединена/iu)).toHaveLength(2);
    const confirm = screen.getAllByRole('button', { name: 'Подтвердить первая' });
    await userEvent.click(confirm[0]!);
    await userEvent.click(confirm[1]!);
    const save = screen.getAllByRole('button', { name: 'Сохранить 2 улова' })[0]!;
    fireEvent.click(save);
    fireEvent.click(save);

    expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1);
    expect(mocks.createCatchReportsBatch.mock.calls[0]?.[0]).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Сохраняем пакет…' })[0]).toBeDisabled();

    resolve({ createdCount: 2, reportIds: ['one', 'two'] });
    expect(await screen.findByText('Создано отчётов: 2')).toBeInTheDocument();
  });

  test('keeps parsing/editing visible but disables creation for a banned user', async () => {
    render(<CatchReportBatchPreview result={result()} canSave={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить первая' }));
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить вторая' }));

    expect(screen.getByText(/сохранение заблокировано/iu)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Сохранить 2 улова' })[0]).toBeDisabled();
    expect(mocks.createCatchReportsBatch).not.toHaveBeenCalled();
  });

  test('maps server request indexes back to the selected original row', async () => {
    const user = userEvent.setup();
    mocks.createCatchReportsBatch.mockRejectedValue(
      new ApiError(409, {
        code: 'CATCH_REPORT_BATCH_INVALID',
        message: 'Пакет не прошёл проверку',
        errors: { 'reports.0.fishId': ['Рыба больше недоступна'] },
      }),
    );
    render(<CatchReportBatchPreview result={result()} canSave />);

    await user.click(screen.getByRole('checkbox', { name: 'Сохранить строку 1' }));
    await user.click(screen.getByRole('button', { name: 'Подтвердить вторая' }));
    await user.click(screen.getAllByRole('button', { name: 'Сохранить 1 улов' })[0]!);

    expect(await screen.findByText('Рыба больше недоступна')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Сохранить строку 3' })).toBeChecked();
  });

  test('orders blocking, warning, and clean rows for attention without changing payload order', async () => {
    const user = userEvent.setup();
    mocks.createCatchReportsBatch.mockResolvedValue({
      createdCount: 4,
      reportIds: ['one', 'two', 'three', 'four'],
    });
    render(<CatchReportBatchPreview result={attentionResult()} canSave />);

    for (const raw of ['чистая 1', 'предупреждение 2', 'предупреждение 5', 'чистая 6']) {
      await user.click(screen.getByRole('button', { name: `Подтвердить ${raw}` }));
    }

    expect(
      screen
        .getAllByRole('checkbox', { name: /Сохранить строку/u })
        .map((checkbox) => checkbox.parentElement?.textContent?.trim()),
    ).toEqual([
      'Сохранить строку 3',
      'Сохранить строку 2',
      'Сохранить строку 5',
      'Сохранить строку 1',
      'Сохранить строку 6',
    ]);
    expect(screen.getAllByRole('button', { name: 'Сохранить 5 уловов' })[0]).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Сохранить строку 3' }));
    await user.click(screen.getAllByRole('button', { name: 'Сохранить 4 улова' })[0]!);

    await waitFor(() => expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1));
    expect(
      mocks.createCatchReportsBatch.mock.calls[0]?.[0].map(
        (input: { rawSourceText: string }) => input.rawSourceText,
      ),
    ).toEqual(['чистая 1', 'предупреждение 2', 'предупреждение 5', 'чистая 6']);
  });
});
