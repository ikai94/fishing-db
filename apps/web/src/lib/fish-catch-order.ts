import type { FishCatchIntensityOrder, FishCatchOrderMode } from './fish-catch-aggregates-api';

/** Порядок уловов независим от охвата баз и фильтров наличия данных. */
export type FishCatchOrder = {
  orderMode: FishCatchOrderMode;
  intensityOrder: FishCatchIntensityOrder;
};

/** Неизвестные параметры возвращают текущий порядок по числу уловов, по убыванию. */
export function readFishCatchOrder(search: Pick<URLSearchParams, 'get'>): FishCatchOrder {
  return {
    orderMode: search.get('orderMode') === 'places' ? 'places' : 'catches',
    intensityOrder: search.get('intensityOrder') === 'asc' ? 'asc' : 'desc',
  };
}

/** Меняет только порядок; выбор баз и AND-фильтры остаются в адресе. */
export function writeFishCatchOrder(searchKey: string, order: FishCatchOrder): string {
  const search = new URLSearchParams(searchKey);
  if (order.orderMode === 'places') search.set('orderMode', 'places');
  else search.delete('orderMode');
  if (order.intensityOrder === 'asc') search.set('intensityOrder', 'asc');
  else search.delete('intensityOrder');
  return search.toString();
}
