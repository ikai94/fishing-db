import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseCatchReport: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.routerReplace }),
}));

vi.mock('@/lib/catch-reports-api', () => ({
  parseCatchReport: mocks.parseCatchReport,
}));

vi.mock('./catch-report-draft-preview', () => ({
  CatchReportDraftPreview: ({
    draft,
    canSave,
  }: {
    draft: { rawSourceText: string };
    canSave: boolean;
  }) => (
    <div data-testid="draft-preview" data-can-save={String(canSave)}>
      {draft.rawSourceText}
    </div>
  ),
}));

import { NotebookCatchEntry } from './notebook-catch-entry';

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
    mocks.parseCatchReport.mockReset();
    mocks.routerReplace.mockReset();
  });

  test('parses into a preview without creating a report', async () => {
    const user = userEvent.setup();
    mocks.parseCatchReport.mockResolvedValue({ rawSourceText: 'Кижуч 7,242 кг' });
    render(<NotebookCatchEntry canSave />);

    await user.type(screen.getByLabelText('Исходная запись'), 'Кижуч 7,242 кг');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(mocks.parseCatchReport).toHaveBeenCalledWith('Кижуч 7,242 кг', expect.any(AbortSignal));
    expect(await screen.findByTestId('draft-preview')).toHaveTextContent('Кижуч 7,242 кг');
  });

  test('preserves pasted CRLF, lone CR, LF and TAB exactly at the API boundary', async () => {
    const user = userEvent.setup();
    const rawSourceText = 'Первая\r\n\tВторая\rТретья\nЧетвёртая';
    mocks.parseCatchReport.mockResolvedValue({ rawSourceText });
    render(<NotebookCatchEntry canSave />);
    const source = screen.getByLabelText('Исходная запись');

    fireEvent.paste(source, {
      clipboardData: { getData: () => rawSourceText },
    });
    await user.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(mocks.parseCatchReport).toHaveBeenCalledWith(rawSourceText, expect.any(AbortSignal));
    expect(await screen.findByTestId('draft-preview')).toHaveTextContent('Первая');
  });

  test('preserves untouched pasted line endings after a keyboard edit', async () => {
    const user = userEvent.setup();
    const pastedSource = 'Первая\r\n\tВторая\rТретья\nЧетвёртая';
    const editedSource = 'Первая\r\n\tВторая!\rТретья\nЧетвёртая';
    mocks.parseCatchReport.mockResolvedValue({ rawSourceText: editedSource });
    render(<NotebookCatchEntry canSave />);
    const source = screen.getByLabelText('Исходная запись');

    await user.click(source);
    fireEvent.paste(source, {
      clipboardData: { getData: () => pastedSource },
    });
    const insertionOffset = 'Первая\n\tВторая'.length;
    (source as HTMLTextAreaElement).setSelectionRange(insertionOffset, insertionOffset);
    await user.keyboard('!');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));

    expect(mocks.parseCatchReport).toHaveBeenCalledWith(editedSource, expect.any(AbortSignal));
  });

  test('editing raw input invalidates an existing preview', async () => {
    const user = userEvent.setup();
    mocks.parseCatchReport.mockResolvedValue({ rawSourceText: 'текст' });
    render(<NotebookCatchEntry canSave={false} />);
    const source = screen.getByLabelText('Исходная запись');
    await user.type(source, 'текст');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByTestId('draft-preview')).toHaveAttribute('data-can-save', 'false');
    await user.type(source, '!');
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();
  });

  test('does not call the parser for whitespace-only source', async () => {
    const user = userEvent.setup();
    render(<NotebookCatchEntry canSave />);
    await user.type(screen.getByLabelText('Исходная запись'), '   ');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(mocks.parseCatchReport).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('непустую запись');
  });

  test('editing the source aborts the request and ignores its stale success', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ rawSourceText: string }>();
    mocks.parseCatchReport.mockReturnValue(pending.promise);
    render(<NotebookCatchEntry canSave />);

    const source = screen.getByLabelText('Исходная запись');
    await user.type(source, 'Первая запись');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    const signal = mocks.parseCatchReport.mock.calls[0]?.[1] as AbortSignal;

    await user.type(source, '!');
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeEnabled();

    await act(async () => {
      pending.resolve({ rawSourceText: 'Первая запись' });
      await pending.promise;
    });
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();
  });

  test('editing the source ignores a stale parser error', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ rawSourceText: string }>();
    mocks.parseCatchReport.mockReturnValue(pending.promise);
    render(<NotebookCatchEntry canSave />);

    const source = screen.getByLabelText('Исходная запись');
    await user.type(source, 'Первая запись');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    await user.type(source, '!');

    await act(async () => {
      pending.reject(new Error('устаревшая ошибка'));
      await pending.promise.catch(() => undefined);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a stale completion cannot end a newer parse or replace its preview', async () => {
    const user = userEvent.setup();
    const first = deferred<{ rawSourceText: string }>();
    const second = deferred<{ rawSourceText: string }>();
    mocks.parseCatchReport.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<NotebookCatchEntry canSave={false} />);

    const source = screen.getByLabelText('Исходная запись');
    await user.type(source, 'Кижуч 7,242 кг');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    const firstSignal = mocks.parseCatchReport.mock.calls[0]?.[1] as AbortSignal;
    fireEvent.submit(source.closest('form')!);
    const secondSignal = mocks.parseCatchReport.mock.calls[1]?.[1] as AbortSignal;

    expect(firstSignal.aborted).toBe(true);
    expect(secondSignal.aborted).toBe(false);
    await act(async () => {
      first.resolve({ rawSourceText: 'устаревший черновик' });
      await first.promise;
    });
    expect(screen.getByRole('button', { name: 'Проверяем…' })).toBeDisabled();
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();

    await act(async () => {
      second.resolve({ rawSourceText: 'Кижуч 7,242 кг' });
      await second.promise;
    });
    expect(await screen.findByTestId('draft-preview')).toHaveTextContent('Кижуч 7,242 кг');
    expect(screen.getByTestId('draft-preview')).toHaveAttribute('data-can-save', 'false');
  });

  test('aborts an active parse when the component unmounts', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ rawSourceText: string }>();
    mocks.parseCatchReport.mockReturnValue(pending.promise);
    const view = render(<NotebookCatchEntry canSave />);

    await user.type(screen.getByLabelText('Исходная запись'), 'Кижуч');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    const signal = mocks.parseCatchReport.mock.calls[0]?.[1] as AbortSignal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve({ rawSourceText: 'Кижуч' });
    await pending.promise;
  });
});
