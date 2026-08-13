import type {
  CatchReportFishingMethod,
  CatchReportSpinningSize,
  CatchReportSpinningSpeed,
} from './catch-reports.constants.js';

export interface CatchReportObservation {
  fishingMethod: CatchReportFishingMethod;
  holeDepthCm: number | null;
  spinningSize: CatchReportSpinningSize | null;
  spinningSpeed: CatchReportSpinningSpeed | null;
}

export type CatchReportObservationErrors = Partial<
  Record<'holeDepthCm' | 'spinningSize' | 'spinningSpeed', string[]>
>;

export function catchReportObservationErrors(
  observation: CatchReportObservation,
): CatchReportObservationErrors {
  const errors: CatchReportObservationErrors = {};

  if (observation.fishingMethod === 'BAIT_FISHING') {
    if (observation.holeDepthCm === null) {
      errors.holeDepthCm = ['Для ловли на наживку укажите глубину ямки'];
    }

    if (observation.spinningSize !== null) {
      errors.spinningSize = ['Размер спиннинга неприменим для ловли на наживку'];
    }

    if (observation.spinningSpeed !== null) {
      errors.spinningSpeed = ['Скорость проводки неприменима для ловли на наживку'];
    }

    return errors;
  }

  if (observation.spinningSize === null) {
    errors.spinningSize = ['Для спиннинга укажите размер'];
  }

  if (observation.spinningSpeed === null) {
    errors.spinningSpeed = ['Для спиннинга укажите скорость проводки'];
  }

  return errors;
}

export function isCatchReportObservationComplete(observation: CatchReportObservation): boolean {
  return Object.keys(catchReportObservationErrors(observation)).length === 0;
}
