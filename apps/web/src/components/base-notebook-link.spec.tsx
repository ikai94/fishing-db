import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { BaseNotebookLink } from './base-notebook-link';

test('authorized icon has a destination, tooltip and keyboard focus', async () => {
  const user = userEvent.setup();
  render(<BaseNotebookLink baseId="base" allowed />);
  const link = screen.getByRole('link', { name: 'Блокнот рыб базы' });
  expect(link).toHaveAttribute('href', '/bases/base/notebook');
  expect(link).toHaveAttribute('title', 'Блокнот рыб базы');
  expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  await user.tab();
  expect(link).toHaveFocus();
});

test('no icon is rendered without authorized list access', () => {
  render(<BaseNotebookLink baseId="base" allowed={false} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
