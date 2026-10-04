import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { LocationObservations as LocationObservationsData } from '@/lib/catch-reports-api';
import { LocationObservations } from './location-observations';

const mocks = vi.hoisted(() => ({ renderSpotAnalytics: vi.fn() }));

vi.mock('@/components/spot-analytics/spot-analytics', () => ({
  SpotAnalytics: (props: unknown) => {
    mocks.renderSpotAnalytics(props);
    return (
      <section>
        <h2>Ямы и точки</h2>
      </section>
    );
  },
}));

const observations: LocationObservationsData = {
  locationId: 'location-1',
  observedFish: [
    {
      fish: { id: 'fish-som', name: 'Сом', isActive: false, image: null },
      reportCount: 4,
      topBaits: [
        {
          id: 'bait-2',
          name: 'Мотыль',
          reportCount: 4,
          image: { url: 'http://localhost:3001/api/v1/bait-images/test.png' },
        },
      ],
      holes: [{ holeDepthCm: 763, spotPositionRaw: 'левый край рюкзака' }],
      spinning: [],
      comments: [],
      maxObservedWeightGrams: 7242,
      maxObservedWeightAssessment: {
        classification: 'mutant',
        minWeightGrams: 100,
        maxWeightGrams: 7000,
      },
    },
    {
      fish: { id: 'fish-beluga', name: 'Белуга', isActive: true, image: null },
      reportCount: 1,
      topBaits: [{ id: 'bait-1', name: 'Vib-rapan', reportCount: 1, image: null }],
      holes: [{ holeDepthCm: 763, spotPositionRaw: 'левый край рюкзака' }],
      spinning: [{ spinningSize: 'MEDIUM', spinningSpeed: 'SLOW' }],
      comments: ['после дождя'],
      maxObservedWeightGrams: 7242,
      maxObservedWeightAssessment: {
        classification: 'ordinary',
        minWeightGrams: 100,
        maxWeightGrams: 10000,
      },
    },
  ],
};

function sectionNamed(name: string): HTMLElement {
  const section = screen.getByRole('heading', { name }).closest('section');
  if (section === null) throw new Error(`Не найден раздел «${name}»`);
  return section;
}

describe('LocationObservations', () => {
  test('renders compact aggregate rows and existing bait images without any detailed catch section', async () => {
    const user = userEvent.setup();
    render(<LocationObservations baseId="base-1" data={observations} />);

    const rankedTable = within(sectionNamed('Пойманные рыбы')).getByRole('table');
    const rankedRows = within(rankedTable).getAllByRole('row');
    const somCells = within(rankedRows[1]).getAllByRole('cell');
    const belugaCells = within(rankedRows[2]).getAllByRole('cell');
    expect(somCells[0]).toHaveTextContent(/^Сом$/u);
    expect(belugaCells[0]).toHaveTextContent(/^Белуга$/u);
    expect(somCells[5]).toHaveTextContent(/^4$/u);
    expect(belugaCells[5]).toHaveTextContent(/^1$/u);
    expect(somCells[6]).toHaveTextContent('7.242 кг / 7 кг');
    expect(belugaCells[6]).toHaveTextContent('7.242 кг / 10 кг');
    expect(within(rankedTable).queryByText(/рыбаков/u)).not.toBeInTheDocument();
    expect(
      within(rankedTable)
        .getAllByRole('columnheader')
        .map((header) =>
          header.textContent
            ?.replace(/[↑↓↕]/g, '')
            .replace('Все наживкиМотыльVib-rapan', '')
            .trim(),
        ),
    ).toEqual([
      '№',
      'Рыба',
      'Яма / ориентир',
      'На что',
      'Размер / проводка',
      'Комментарий',
      'Уловы',
      'Наблюдаемый / максимальный вес',
    ]);
    expect(rankedTable.querySelectorAll('[data-fish-image=thumbnail]')).toHaveLength(2);

    await user.click(screen.getByText('Рыбы: 2 из 2'));
    expect(screen.getByRole('checkbox', { name: 'Сом' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Белуга' })).toBeChecked();

    expect(screen.queryByText('Уловы на локации')).not.toBeInTheDocument();
    expect(screen.queryByText(/Подробные уловы/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Белуга' })).toHaveAttribute(
      'href',
      '/fish/fish-beluga?baseIds=base-1',
    );
    expect(screen.queryByRole('link', { name: 'Сом' })).not.toBeInTheDocument();
    expect(rankedTable.querySelector('img[title="Мотыль"]')).toHaveAttribute(
      'src',
      observations.observedFish[0].topBaits[0].image?.url,
    );
    expect(within(rankedTable).getAllByText('7.63 м левый край рюкзака')).toHaveLength(2);
    expect(within(rankedTable).getByText('после дождя')).toBeVisible();
    expect(within(rankedTable).getByText('Мутант')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Ямы и точки' })).not.toBeInTheDocument();
    expect(mocks.renderSpotAnalytics).not.toHaveBeenCalled();
  });

  test('filters aggregate rows while keeping unchecked Fish selectable', async () => {
    const user = userEvent.setup();
    render(<LocationObservations baseId="base-1" data={observations} />);
    await user.click(screen.getByText('Рыбы: 2 из 2'));

    const somCheckbox = screen.getByRole('checkbox', { name: 'Сом' });
    await user.click(somCheckbox);

    expect(somCheckbox).not.toBeChecked();
    expect(screen.getByText('Рыбы: 1 из 2')).toBeVisible();
    expect(
      within(sectionNamed('Пойманные рыбы')).queryByRole('cell', { name: /Сом/u }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Сом' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Снять все' }));
    expect(
      within(sectionNamed('Пойманные рыбы')).getByText('Выберите хотя бы одну рыбу.'),
    ).toBeVisible();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(mocks.renderSpotAnalytics).not.toHaveBeenCalled();
  });

  test('sorts fish, bait and global counts and combines presence filters without hiding controls', async () => {
    const user = userEvent.setup();
    const data = {
      ...observations,
      observedFish: observations.observedFish.map((item) =>
        item.fish.id === 'fish-som' ? { ...item, holes: [] } : item,
      ),
    };
    render(<LocationObservations baseId="base-1" data={data} />);
    const table = within(sectionNamed('Пойманные рыбы')).getByRole('table');
    const names = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(names()[0]).toContain('Сом');
    await user.click(within(table).getByRole('button', { name: 'Рыба' }));
    expect(names()[0]).toContain('Белуга');
    await user.click(within(table).getByRole('button', { name: 'Рыба' }));
    expect(names()[0]).toContain('Сом');
    await user.click(within(table).getByRole('button', { name: 'Уловы' }));
    expect(names()[0]).toContain('Сом');
    await user.click(within(table).getByRole('button', { name: 'Уловы' }));
    expect(names()[0]).toContain('Белуга');
    await user.click(within(table).getByRole('button', { name: 'На что' }));
    expect(names()[0]).toContain('Сом');
    await user.click(within(table).getByRole('button', { name: 'На что' }));
    expect(names()[0]).toContain('Белуга');
    await user.selectOptions(within(table).getByRole('combobox'), 'bait-2');
    expect(names()).toHaveLength(1);
    await user.click(within(table).getByRole('button', { name: 'Яма / ориентир' }));
    expect(within(table).getAllByRole('row')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Для выбранных фильтров рыб нет.');
    await user.selectOptions(within(table).getByRole('combobox'), '');
    await user.click(within(table).getByRole('button', { name: 'Размер / проводка' }));
    await user.click(within(table).getByRole('button', { name: 'Комментарий' }));
    expect(names()).toHaveLength(1);
    expect(names()[0]).toContain('Белуга');
  });

  test('applies good and excellent catch thresholds to total fish counts', async () => {
    const user = userEvent.setup();
    const data = {
      ...observations,
      observedFish: observations.observedFish.map((item, index) => ({
        ...item,
        reportCount: index === 0 ? 30 : 10,
      })),
    };
    render(<LocationObservations baseId="base-1" data={data} />);
    const table = within(sectionNamed('Пойманные рыбы')).getByRole('table');
    await user.click(screen.getByRole('button', { name: 'Хороший клев' }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Отличный клев' }));
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Сом');
    await user.click(screen.getByRole('button', { name: 'Все' }));
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  test('renders a quiet empty state without inventing selector Fish', () => {
    render(
      <LocationObservations
        baseId="base-1"
        data={{ locationId: 'location-1', observedFish: [] }}
      />,
    );

    expect(screen.getByText('На этой локации пока нет опубликованных уловов.')).toBeVisible();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ямы и точки' })).not.toBeInTheDocument();
    expect(mocks.renderSpotAnalytics).not.toHaveBeenCalled();
  });
});
