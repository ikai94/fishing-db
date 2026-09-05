import { describe, expect, test } from 'vitest';
import {
  personalCatchArchiveHref,
  readPersonalCatchArchiveFilters,
} from './personal-catch-navigation';

describe('personal CatchReport navigation', () => {
  test('reads only supported URL-backed archive filters', () => {
    expect(
      readPersonalCatchArchiveFilters(
        new URLSearchParams('source=native&fishId=fish-1&unknown=value'),
      ),
    ).toEqual({ source: 'native', fishId: 'fish-1' });
  });

  test('writes stable statistics and native drill-down URLs', () => {
    expect(personalCatchArchiveHref({ source: 'native', locationId: 'location-1' })).toBe(
      '/my/catches?source=native&locationId=location-1',
    );
    expect(personalCatchArchiveHref({}, 'statistics')).toBe('/my/catches?view=statistics');
  });
});
