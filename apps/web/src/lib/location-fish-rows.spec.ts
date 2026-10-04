import { describe, expect, test } from 'vitest';
import type { ObservedFish } from './catch-reports-api';
import { filterLocationFishRows, type LocationFishControls } from './location-fish-rows';

const state: LocationFishControls = {
  sort: 'catches',
  direction: 'desc',
  baitId: '',
  hasHole: false,
  hasSpinning: false,
  hasComment: false,
  minCount: 0,
};

function fixture(): ObservedFish[] {
  return [9, 10, 29, 30].map((reportCount, index) => ({
    fish: {
      id: String(index),
      name: ['Белуга', 'Сом', 'Амур', 'Щука'][index],
      isActive: true,
      image: null,
    },
    reportCount,
    topBaits: [
      { id: index < 2 ? 'a' : 'b', name: index < 2 ? 'А' : 'Б', reportCount: 5, image: null },
      { id: 'c', name: 'В', reportCount: 2, image: null },
    ],
    holes: index === 0 ? [] : [{ holeDepthCm: 763, spotPositionRaw: null }],
    spinning: index === 1 ? [] : [{ spinningSize: null, spinningSpeed: 'SLOW' as const }],
    comments: index === 2 ? [] : ['  исходный комментарий  '],
    maxObservedWeightGrams: 100 + reportCount - 1,
    maxObservedWeightAssessment: {
      classification: 'ordinary' as const,
      minWeightGrams: 1,
      maxWeightGrams: 500,
    },
  }));
}

describe('location fish rows', () => {
  test('uses size OR retrieval, presence AND, and exact threshold boundaries', () => {
    const rows = fixture();
    const ids = (controls: Partial<LocationFishControls>) =>
      filterLocationFishRows(rows, { ...state, ...controls }).map((row) => row.fish.id);
    expect(ids({ hasSpinning: true })).toEqual(['3', '2', '0']);
    expect(ids({ hasSpinning: true, hasHole: true, hasComment: true })).toEqual(['3']);
    expect(ids({ minCount: 10 })).toEqual(['3', '2', '1']);
    expect(ids({ minCount: 30 })).toEqual(['3']);
    rows[0].spinning = [{ spinningSize: 'SMALL', spinningSpeed: null }];
    expect(ids({ hasSpinning: true })).toContain('0');
  });

  test('sorts counts globally in both directions and uses displayed top bait with stable ties', () => {
    const rows = fixture();
    const ids = (controls: Partial<LocationFishControls>) =>
      filterLocationFishRows(rows, { ...state, ...controls }).map((row) => row.fish.id);
    expect(ids({ direction: 'asc' })).toEqual(['0', '1', '2', '3']);
    expect(ids({ sort: 'fish', direction: 'asc' })).toEqual(['2', '0', '1', '3']);
    expect(ids({ sort: 'bait', direction: 'asc' })).toEqual(['0', '1', '2', '3']);
    expect(ids({ sort: 'bait', direction: 'desc' })).toEqual(['2', '3', '0', '1']);
    rows[1].topBaits[0].reportCount = 6;
    expect(ids({ sort: 'bait', direction: 'asc' })).toEqual(['1', '0', '2', '3']);
    expect(ids({ baitId: 'c' })).toHaveLength(4);
    expect(ids({ baitId: 'outside-top' })).toEqual([]);
  });
});
