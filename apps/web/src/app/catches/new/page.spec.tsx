import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  state: { kind: 'ready', user: { isBanned: false } } as
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; user: { isBanned: boolean } },
}));

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

vi.mock('@/components/application-shell/shell-icon', () => ({
  ShellIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock('@/lib/use-required-user', () => ({
  useRequiredUser: () => ({ reload: mocks.reload, state: mocks.state }),
}));

vi.mock('../_components/notebook-catch-entry', () => ({
  NotebookCatchEntry: ({ canSave }: { canSave: boolean }) => (
    <label>
      Исходник блокнота
      <input data-can-save={String(canSave)} />
    </label>
  ),
}));

vi.mock('../_components/catch-report-form', () => ({
  CatchReportForm: () => (
    <label>
      Ручной ввод
      <input />
    </label>
  ),
}));

import NewCatchReportPage from './page';

describe('NewCatchReportPage', () => {
  beforeEach(() => {
    mocks.reload.mockReset();
    mocks.state = { kind: 'ready', user: { isBanned: false } };
  });

  test('renders in ApplicationShell with the approved title and catch navigation', () => {
    render(<NewCatchReportPage />);

    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { level: 1, name: 'Добавить рыбу' }),
    );
    expect(screen.getByRole('link', { name: 'Все уловы' })).toHaveAttribute('href', '/catches');
    expect(screen.getByRole('link', { name: 'Мои уловы' })).toHaveAttribute('href', '/my/catches');
  });

  test('defaults to notebook and preserves both mounted pane states while switching', async () => {
    const user = userEvent.setup();
    render(<NewCatchReportPage />);

    const notebookButton = screen.getByRole('button', { name: 'Из блокнота' });
    const manualButton = screen.getByRole('button', { name: 'Вручную' });
    const notebookPane = document.getElementById('notebook-entry-pane');
    const manualPane = document.getElementById('manual-entry-pane');
    const notebookInput = screen.getByLabelText('Исходник блокнота');
    const manualInput = screen.getByLabelText('Ручной ввод');

    expect(notebookButton).toHaveAttribute('aria-pressed', 'true');
    expect(manualButton).toHaveAttribute('aria-pressed', 'false');
    expect(notebookPane).not.toHaveAttribute('hidden');
    expect(manualPane).toHaveAttribute('hidden');
    expect(screen.queryByRole('textbox', { name: 'Ручной ввод' })).not.toBeInTheDocument();

    await user.type(notebookInput, 'Налим 15,88 кг');
    await user.click(manualButton);

    expect(notebookPane).toHaveAttribute('hidden');
    expect(manualPane).not.toHaveAttribute('hidden');
    expect(screen.queryByRole('textbox', { name: 'Исходник блокнота' })).not.toBeInTheDocument();
    await user.type(manualInput, 'ручное состояние');

    await user.click(notebookButton);
    expect(notebookInput).toHaveValue('Налим 15,88 кг');
    expect(manualInput).toHaveValue('ручное состояние');
  });

  test('keeps notebook preview available but manual creation unavailable for a banned user', () => {
    mocks.state = { kind: 'ready', user: { isBanned: true } };
    render(<NewCatchReportPage />);

    expect(screen.getByText('Публикация недоступна')).toBeVisible();
    expect(screen.getByLabelText('Исходник блокнота')).toHaveAttribute('data-can-save', 'false');
    expect(screen.queryByRole('button', { name: 'Вручную' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ручной ввод')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть мои уловы' })).toHaveAttribute(
      'href',
      '/my/catches',
    );
  });

  test('preserves the account error retry flow', async () => {
    const user = userEvent.setup();
    mocks.state = { kind: 'error', message: 'Не удалось проверить аккаунт.' };
    render(<NewCatchReportPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить аккаунт.');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });
});
