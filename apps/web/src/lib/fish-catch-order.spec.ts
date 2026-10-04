import { expect, test } from 'vitest';
import { readFishCatchOrder, writeFishCatchOrder } from './fish-catch-order';

test('canonical order URL preserves bases and both presence filters', () => {
  const search = 'baseIds=a,b&hasComment=true&hasHole=true';
  for (const orderMode of ['places', 'catches'] as const)
    for (const intensityOrder of ['asc', 'desc'] as const) {
      const next = new URLSearchParams(writeFishCatchOrder(search, { orderMode, intensityOrder }));
      expect(readFishCatchOrder(next)).toEqual({ orderMode, intensityOrder });
      expect(next.get('baseIds')).toBe('a,b');
      expect(next.get('hasComment')).toBe('true');
      expect(next.get('hasHole')).toBe('true');
    }
  expect(readFishCatchOrder(new URLSearchParams('orderMode=bait&intensityOrder=invalid'))).toEqual({
    orderMode: 'catches',
    intensityOrder: 'desc',
  });
  expect(
    writeFishCatchOrder('orderMode=places&intensityOrder=asc', {
      orderMode: 'catches',
      intensityOrder: 'desc',
    }),
  ).toBe('');
});
