import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseCatchReportBatch: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/lib/catch-reports-api', () => ({
  parseCatchReportBatch: mocks.parseCatchReportBatch,
}));

vi.mock('./catch-report-batch-preview', () => ({
  CatchReportBatchPreview: ({
    result,
    canSave,
  }: {
    result: { rows: Array<{ draft: { rawSourceText: string } }> };
    canSave: boolean;
  }) => (
    <div data-testid="batch-preview" data-can-save={String(canSave)}>
      {result.rows.map((row) => row.draft.rawSourceText).join('|')}
    </div>
  ),
}));

vi.mock('./catch-report-form-catalog-context', () => ({
  CatchReportFormCatalogProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { NotebookCatchEntry } from './notebook-catch-entry';

type BatchResult = { rows: Array<{ draft: { rawSourceText: string } }> };

function batch(...rawSourceTexts: string[]): BatchResult {
  return { rows: rawSourceTexts.map((rawSourceText) => ({ draft: { rawSourceText } })) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

describe('NotebookCatchEntry', () => {
  beforeEach(() => {
    mocks.parseCatchReportBatch.mockReset();
    mocks.routerReplace.mockReset();
  });

  test('parses into a batch preview without creating a report', async () => {
    const user = userEvent.setup();
    mocks.parseCatchReportBatch.mockResolvedValue(batch('Кижуч 7,242 кг'));
    render(<NotebookCatchEntry canSave />);

    await user.type(screen.getByLabelText('Исходные записи'), 'Кижуч 7,242 кг');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));

    expect(mocks.parseCatchReportBatch).toHaveBeenCalledWith(
      'Кижуч 7,242 кг',
      expect.any(AbortSignal),
    );
    expect(await screen.findByTestId('batch-preview')).toHaveTextContent('Кижуч 7,242 кг');
  });

  test('preserves pasted CRLF, lone CR, LF and TAB exactly at the API boundary', async () => {
    const user = userEvent.setup();
    const rawSourceText = 'Первая\r\n\tВторая\rТретья\nЧетвёртая';
    mocks.parseCatchReportBatch.mockResolvedValue(
      batch('Первая', '\tВторая', 'Третья', 'Четвёртая'),
    );
    render(<NotebookCatchEntry canSave />);
    const source = screen.getByLabelText('Исходные записи');

    fireEvent.paste(source, { clipboardData: { getData: () => rawSourceText } });
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));

    expect(mocks.parseCatchReportBatch).toHaveBeenCalledWith(
      rawSourceText,
      expect.any(AbortSignal),
    );
    expect(await screen.findByTestId('batch-preview')).toHaveTextContent('Первая');
  });

  test('preserves untouched pasted line endings after a keyboard edit', async () => {
    const user = userEvent.setup();
    const pastedSource = 'Первая\r\n\tВторая\rТретья\nЧетвёртая';
    const editedSource = 'Первая\r\n\tВторая!\rТретья\nЧетвёртая';
    mocks.parseCatchReportBatch.mockResolvedValue(batch(editedSource));
    render(<NotebookCatchEntry canSave />);
    const source = screen.getByLabelText('Исходные записи');

    await user.click(source);
    fireEvent.paste(source, { clipboardData: { getData: () => pastedSource } });
    const insertionOffset = 'Первая\n\tВторая'.length;
    (source as HTMLTextAreaElement).setSelectionRange(insertionOffset, insertionOffset);
    await user.keyboard('!');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));

    expect(mocks.parseCatchReportBatch).toHaveBeenCalledWith(editedSource, expect.any(AbortSignal));
  });

  test('editing raw input invalidates an existing preview', async () => {
    const user = userEvent.setup();
    mocks.parseCatchReportBatch.mockResolvedValue(batch('текст'));
    render(<NotebookCatchEntry canSave={false} />);
    const source = screen.getByLabelText('Исходные записи');
    await user.type(source, 'текст');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    expect(await screen.findByTestId('batch-preview')).toHaveAttribute('data-can-save', 'false');
    await user.type(source, '!');
    expect(screen.queryByTestId('batch-preview')).not.toBeInTheDocument();
  });

  test('does not call the parser for whitespace-only source', async () => {
    const user = userEvent.setup();
    render(<NotebookCatchEntry canSave />);
    await user.type(screen.getByLabelText('Исходные записи'), '   ');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    expect(mocks.parseCatchReportBatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('непустую запись');
  });

  test('editing the source aborts the request and ignores its stale success', async () => {
    const user = userEvent.setup();
    const pending = deferred<BatchResult>();
    mocks.parseCatchReportBatch.mockReturnValue(pending.promise);
    render(<NotebookCatchEntry canSave />);

    const source = screen.getByLabelText('Исходные записи');
    await user.type(source, 'Первая запись');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    const signal = mocks.parseCatchReportBatch.mock.calls[0]?.[1] as AbortSignal;

    await user.type(source, '!');
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Разобрать' })).toBeEnabled();

    await act(async () => {
      pending.resolve(batch('Первая запись'));
      await pending.promise;
    });
    expect(screen.queryByTestId('batch-preview')).not.toBeInTheDocument();
  });

  test('editing the source ignores a stale parser error', async () => {
    const user = userEvent.setup();
    const pending = deferred<BatchResult>();
    mocks.parseCatchReportBatch.mockReturnValue(pending.promise);
    render(<NotebookCatchEntry canSave />);

    const source = screen.getByLabelText('Исходные записи');
    await user.type(source, 'Первая запись');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    await user.type(source, '!');

    await act(async () => {
      pending.reject(new Error('устаревшая ошибка'));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a stale completion cannot end a newer parse or replace its preview', async () => {
    const user = userEvent.setup();
    const first = deferred<BatchResult>();
    const second = deferred<BatchResult>();
    mocks.parseCatchReportBatch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<NotebookCatchEntry canSave={false} />);

    const source = screen.getByLabelText('Исходные записи');
    await user.type(source, 'Кижуч 7,242 кг');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    const firstSignal = mocks.parseCatchReportBatch.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.submit(source.closest('form')!);
    const secondSignal = mocks.parseCatchReportBatch.mock.calls[1]?.[1] as AbortSignal;

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    await act(async () => {
      first.resolve(batch('устаревший черновик'));
      await first.promise;
    });
    expect(screen.getByRole('button', { name: 'Разбираем…' })).toBeDisabled();
    expect(screen.queryByTestId('batch-preview')).not.toBeInTheDocument();

    await act(async () => {
      second.resolve(batch('Кижуч 7,242 кг'));
      await second.promise;
    });
    expect(await screen.findByTestId('batch-preview')).toHaveTextContent('Кижуч 7,242 кг');
    expect(screen.getByTestId('batch-preview')).toHaveAttribute('data-can-save', 'false');
  });

  test('aborts an active parse when the component unmounts', async () => {
    const user = userEvent.setup();
    const pending = deferred<BatchResult>();
    mocks.parseCatchReportBatch.mockReturnValue(pending.promise);
    const view = render(<NotebookCatchEntry canSave />);

    await user.type(screen.getByLabelText('Исходные записи'), 'Кижуч');
    await user.click(screen.getByRole('button', { name: 'Разобрать' }));
    const signal = mocks.parseCatchReportBatch.mock.calls[0]?.[1] as AbortSignal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(batch('Кижуч'));
    await pending.promise;
  });
});
