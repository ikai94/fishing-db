import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { CatchReport } from '@/lib/catch-reports-api';
import { CatchReportList } from './catch-report-list';

const report: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'Ахтуба' },
  location: { id: 'location-1', number: 1, name: 'Берег' },
  fish: { id: 'fish-1', name: 'Сом' },
  bait: { id: 'bait-1', name: 'Мотыль' },
  weightGrams: 1_250,
  weightAssessment: {
    classification: 'mutant',
    minWeightGrams: 100,
    maxWeightGrams: 1_200,
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
};

describe('CatchReportList weight classification', () => {
  test('shows anomalies and suppresses ordinary or unclassified row labels', () => {
    const { rerender } = render(<CatchReportList reports={[report]} />);
    expect(screen.getByText('Мутант')).toBeInTheDocument();

    rerender(
      <CatchReportList
        reports={[
          {
            ...report,
            weightAssessment: { ...report.weightAssessment, classification: 'ordinary' },
          },
        ]}
      />,
    );
    expect(screen.queryByText('Обычный')).not.toBeInTheDocument();
  });
});
