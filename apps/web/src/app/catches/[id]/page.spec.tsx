import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCatchReport: vi.fn() }));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'report-1' }) }));
vi.mock('@/lib/catch-reports-api', () => ({ getCatchReport: mocks.getCatchReport }));

import CatchReportDetailPage from './page';

describe('CatchReport detail weight classification', () => {
  beforeEach(() => {
    mocks.getCatchReport.mockReset();
    mocks.getCatchReport.mockResolvedValue({
      id: 'report-1',
      author: { id: 'user-1', nickname: 'Рыбак' },
      fishingBase: { id: 'base-1', name: 'Ахтуба' },
      location: { id: 'location-1', number: 1, name: 'Берег' },
      fish: { id: 'fish-1', name: 'Сом' },
      bait: { id: 'bait-1', name: 'Мотыль' },
      weightGrams: 1_250,
      weightAssessment: {
        classification: 'ordinary',
        minWeightGrams: 100,
        maxWeightGrams: 2_000,
      },
      fishingMethod: 'BAIT_FISHING',
      holeDepthCm: null,
      spotPositionRaw: null,
      fishingNote: null,
      spinningSize: null,
      spinningSpeed: null,
      userNoteRaw: null,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
  });

  test('always explains the current classification and Base range', async () => {
    render(<CatchReportDetailPage />);
    expect(await screen.findByText(/Обычный · по текущим границам базы/)).toBeInTheDocument();
    expect(screen.getByText('100 г — 2 кг')).toBeInTheDocument();
  });
});
