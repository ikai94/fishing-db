import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ActivityEvent } from '@/lib/activity-api';
import { RecentActivityList } from './recent-activity-list';

const events: ActivityEvent[] = [
  {
    id: '2',
    type: 'CATCH_REPORT_BATCH_CREATED',
    occurredAt: '2026-09-04T12:00:00.000Z',
    actor: { kind: 'ANGLER', nickname: 'Рыбак' },
    data: { createdCount: 12 },
  },
  {
    id: '1',
    type: 'FISHING_BASE_FISH_REMOVED',
    occurredAt: '2026-09-04T11:00:00.000Z',
    actor: { kind: 'ADMINISTRATION' },
    data: {
      membership: {
        fishingBase: { id: '60000000-0000-4000-8000-000000000001', name: 'Амур' },
        fish: { id: '40000000-0000-4000-8000-000000000001', name: 'Кижуч' },
        minWeightGrams: null,
        maxWeightGrams: null,
      },
    },
  },
];

describe('RecentActivityList', () => {
  test('renders typed event text and Moscow timestamps without links', () => {
    render(<RecentActivityList events={events} />);

    expect(
      screen.getByRole('list', { name: 'Десять последних действий на сайте' }),
    ).toHaveTextContent('Рыбак: добавлено уловов — 12.');
    expect(screen.getByText(/с базы «Амур» убрана рыба «Кижуч»/)).toBeVisible();
    expect(screen.getAllByRole('time')[0]).toHaveAttribute('datetime', '2026-09-04T12:00:00.000Z');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
