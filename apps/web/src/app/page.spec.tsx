import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('@/components/application-shell/application-shell', () => ({
  ApplicationShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="application-shell">{children}</div>
  ),
}));

vi.mock('./_components/home-dashboard', () => ({
  HomeDashboard: () => <h1>Рыбная база</h1>,
}));

import Home from './page';

describe('Home', () => {
  test('renders the homepage dashboard inside ApplicationShell', () => {
    render(<Home />);

    expect(screen.getByTestId('application-shell')).toContainElement(
      screen.getByRole('heading', { name: 'Рыбная база' }),
    );
  });
});
