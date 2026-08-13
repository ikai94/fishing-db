import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catchReportObservationErrors,
  isCatchReportObservationComplete,
} from './catch-report-observation.js';

void describe('CatchReport v2 observation invariants', () => {
  void it('requires a hole and rejects spinning data for bait fishing', () => {
    assert.deepEqual(
      catchReportObservationErrors({
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: null,
        spinningSize: 'MEDIUM',
        spinningSpeed: 'SLOW',
      }),
      {
        holeDepthCm: ['Для ловли на наживку укажите глубину ямки'],
        spinningSize: ['Размер спиннинга неприменим для ловли на наживку'],
        spinningSpeed: ['Скорость проводки неприменима для ловли на наживку'],
      },
    );
  });

  void it('requires both spinning parameters and allows an optional hole', () => {
    assert.deepEqual(
      catchReportObservationErrors({
        fishingMethod: 'SPINNING',
        holeDepthCm: 1_078,
        spinningSize: null,
        spinningSpeed: null,
      }),
      {
        spinningSize: ['Для спиннинга укажите размер'],
        spinningSpeed: ['Для спиннинга укажите скорость проводки'],
      },
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

  void it('accepts a complete bait-fishing observation', () => {
    assert.equal(
      isCatchReportObservationComplete({
        fishingMethod: 'BAIT_FISHING',
        holeDepthCm: 600,
        spinningSize: null,
        spinningSpeed: null,
      }),
      true,
    );
  });
});
