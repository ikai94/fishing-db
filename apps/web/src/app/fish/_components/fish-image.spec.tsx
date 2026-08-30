import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { FishImage } from './fish-image';

describe('FishImage', () => {
  test('uses a quiet, text-free placeholder for a missing list thumbnail', () => {
    const view = render(<FishImage fishName="Сом" image={null} variant="thumbnail" />);

    expect(screen.queryByText('Нет изображения')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-fish-image="thumbnail"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  test('shows the stable detail fallback for a missing image', () => {
    render(<FishImage fishName="Сом" image={null} variant="detail" />);

    expect(screen.getByText('Нет изображения')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('falls back after a load error and accepts a replacement URL', () => {
    const view = render(
      <FishImage fishName="Сом" image={{ url: '/fish-images/fish-1.webp' }} variant="detail" />,
    );

    fireEvent.error(screen.getByRole('img', { name: 'Изображение рыбы «Сом»' }));
    expect(screen.getByText('Нет изображения')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    view.rerender(
      <FishImage fishName="Сом" image={{ url: '/fish-images/fish-1-v2.webp' }} variant="detail" />,
    );
    expect(screen.getByRole('img', { name: 'Изображение рыбы «Сом»' })).toHaveAttribute(
      'src',
      '/fish-images/fish-1-v2.webp',
    );
  });

  test('keeps a failed thumbnail fallback quiet', () => {
    const view = render(
      <FishImage fishName="Сом" image={{ url: '/fish-images/fish-1.webp' }} variant="thumbnail" />,
    );

    const image = view.container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image as HTMLImageElement);
    expect(screen.queryByText('Нет изображения')).not.toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
  });
});
