import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catchReportObservationErrors,
  isCatchReportObservationComplete,
} from './catch-report-observation.js';

void describe('CatchReport v2 observation invariants', () => {
  void it('allows a missing hole but rejects spinning data for bait fishing', () => {
    assert.deepEqual(
      catchReportObservationErrors({
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: null,
        spinningSize: 'MEDIUM',
        spinningSpeed: 'SLOW',
      }),
      {
        spinningSize: ['Размер спиннинга неприменим для ловли на наживку'],
        spinningSpeed: ['Скорость проводки неприменима для ловли на наживку'],
      },
    );
  });

  void it('allows a spinning observation without size, speed, or hole', () => {
    assert.deepEqual(
      catchReportObservationErrors({
        fishingMethod: 'SPINNING',
        holeDepthCm: 1_078,
        spinningSize: null,
        spinningSpeed: null,
      }),
      {},
    );
    assert.equal(
      isCatchReportObservationComplete({
        fishingMethod: 'SPINNING',
        holeDepthCm: null,
        spinningSize: 'MEDIUM',
        spinningSpeed: 'SLOW',
      }),
      true,
    );
  });

  void it('accepts bait fishing with or without a hole', () => {
    assert.equal(
      isCatchReportObservationComplete({
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: null,
        spinningSize: null,
        spinningSpeed: null,
      }),
      true,
    );
  });
});
