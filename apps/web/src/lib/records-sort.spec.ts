import { describe, expect, test } from 'vitest';
import type { RecordsItem } from './records-api';
import { readRecordsSort, recordsSortSearch, sortRecords } from './records-sort';

function row(
  name: string,
  state: RecordsItem['state'],
  percent: number | null,
  weight: number | null,
): RecordsItem {
  return {
    fish: { id: name, name },
    state,
    record:
      weight === null
        ? null
        : {
            weightGrams: weight,
            waterbody: 'База',
            fishingBase: null,
            playerName: 'Игрок',
            caughtAt: '2026-09-09T10:00:00Z',
          },
    normalMaxWeightGrams: percent === null ? null : 1_000,
    maxBases: [],
    headroomGrams: percent === null ? null : percent * 10,
    headroomPercent: percent,
    status: state === 'NO_RECORD' ? 'NO_RECORD' : percent === null ? 'MAX_UNKNOWN' : 'CAN_BEAT',
  };
}

describe('records sorting', () => {
  const rows = [
    row('Мутант', 'RECORD', -5, 1050),
    row('Нет Б', 'NO_RECORD', null, null),
    row('Можно', 'RECORD', 20, 800),
    row('Нет А', 'NO_RECORD', null, null),
    row('Без max', 'RECORD', null, 900),
  ];

  test('default puts missing records first and then largest positive percent', () => {
    expect(
      sortRecords(rows, { key: 'default', direction: 'desc' }).map((item) => item.fish.name),
    ).toEqual(['Нет А', 'Нет Б', 'Можно', 'Мутант', 'Без max']);
  });

  test('supports numeric sort with nulls last and exact URL reset semantics', () => {
    expect(
      sortRecords(rows, { key: 'weight', direction: 'desc' }).map((item) => item.fish.name),
    ).toEqual(['Мутант', 'Без max', 'Можно', 'Нет А', 'Нет Б']);
    expect(readRecordsSort(new URLSearchParams('sort=headroom&direction=asc'))).toEqual({
      key: 'headroom',
      direction: 'asc',
    });
    expect(readRecordsSort(new URLSearchParams('sort=bad&direction=asc')).key).toBe('default');
    expect(recordsSortSearch({ key: 'default', direction: 'desc' })).toBe('');
  });
});
