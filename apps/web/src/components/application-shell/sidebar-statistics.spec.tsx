import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCatalogSummary: vi.fn(),
}));

vi.mock('@/lib/catalog-api', () => ({
  getCatalogSummary: mocks.getCatalogSummary,
}));

import { SidebarStatistics } from './sidebar-statistics';

describe('SidebarStatistics', () => {
  beforeEach(() => mocks.getCatalogSummary.mockReset());

  test('renders only real summary counts and forwards an AbortSignal', async () => {
    mocks.getCatalogSummary.mockResolvedValue({
      catchReportsCount: 31_337,
      registeredUsersCount: 42,
    });
    render(<SidebarStatistics />);

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(
      await screen.findByText((_, element) => element?.textContent === '31 337'),
    ).toBeVisible();
    expect(screen.getByText('42')).toBeVisible();
    expect(screen.getByText('Рыб внесено')).toBeVisible();
    expect(screen.getByText('Пользователей')).toBeVisible();
    expect(mocks.getCatalogSummary).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  test('keeps placeholders on failure and retries without inventing values', async () => {
    const user = userEvent.setup();
    mocks.getCatalogSummary
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ catchReportsCount: 7, registeredUsersCount: 3 });
    render(<SidebarStatistics />);

    await user.click(await screen.findByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(mocks.getCatalogSummary).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('7')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
  });
});
