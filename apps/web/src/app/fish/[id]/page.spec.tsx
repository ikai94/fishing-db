import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getFish: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'fish-1' }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getFish: mocks.getFish,
}));

vi.mock('./_components/fish-explorer', () => ({
  FishExplorer: ({ fish }: { fish: { id: string; bases: Array<{ id: string }> } }) => (
    <div data-base-ids={fish.bases.map((base) => base.id).join(',')} data-testid="fish-explorer">
      {fish.id}
    </div>
  ),
}));

import FishDetailPage from './page';

type TestFish = {
  id: string;
  name: string;
  bases: Array<{ id: string; name: string }>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

const fish: TestFish = {
  id: 'fish-1',
  name: 'Сом',
  bases: [
    { id: 'base-a', name: 'Ахтуба' },
    { id: 'base-b', name: 'Волга' },
  ],
};

describe('FishDetailPage', () => {
  beforeEach(() => mocks.getFish.mockReset());

  test('loads the requested Fish and passes its active Base memberships to the explorer', async () => {
    const pending = deferred<TestFish>();
    mocks.getFish.mockReturnValue(pending.promise);
    render(<FishDetailPage />);

    expect(screen.getByRole('status')).toHaveTextContent('Загружаем рыбу…');
    expect(mocks.getFish).toHaveBeenCalledWith('fish-1', expect.any(AbortSignal));
    await act(async () => {
      pending.resolve(fish);
      await pending.promise;
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Сом' })).toBeVisible();
    expect(screen.getByText('Активных баз обитания: 2')).toBeVisible();
    expect(screen.getByTestId('fish-explorer')).toHaveAttribute('data-base-ids', 'base-a,base-b');
    expect(screen.getByRole('link', { name: '← Все рыбы' })).toHaveAttribute('href', '/fish');
    expect(screen.getByRole('link', { name: 'Базы' })).toHaveAttribute('href', '/bases');
  });

  test('shows a recoverable error and retries the Fish request', async () => {
    const user = userEvent.setup();
    const retry = deferred<TestFish>();
    mocks.getFish.mockRejectedValueOnce(new Error('network')).mockReturnValueOnce(retry.promise);
    render(<FishDetailPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось загрузить рыбу. Попробуйте ещё раз.',
    );
    await user.click(screen.getByRole('button', { name: 'Повторить' }));

    expect(screen.getByRole('status')).toHaveTextContent('Загружаем рыбу…');
    await act(async () => {
      retry.resolve(fish);
      await retry.promise;
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Сом' })).toBeVisible();
    expect(mocks.getFish).toHaveBeenCalledTimes(2);
  });

  test('aborts the Fish detail request when the page unmounts', async () => {
    const pending = deferred<TestFish>();
    mocks.getFish.mockReturnValue(pending.promise);
    const view = render(<FishDetailPage />);
    await waitFor(() => expect(mocks.getFish).toHaveBeenCalledTimes(1));
    const signal = mocks.getFish.mock.calls[0]?.[1] as AbortSignal;

    view.unmount();
    expect(signal.aborted).toBe(true);
    pending.resolve(fish);
    await pending.promise;
  });
});
