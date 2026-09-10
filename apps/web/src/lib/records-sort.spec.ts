import { describe, expect, test } from 'vitest';
import type { RecordsItem } from './records-api';
import { readRecordsSort, recordsSortSearch, sortRecords } from './records-sort';

function row(
  name: string,
  state: RecordsItem['state'],
  percent: number | null,
  weight: number | null,
  maxBases: RecordsItem['maxBases'] = [],
  fishingBase: NonNullable<RecordsItem['record']>['fishingBase'] = null,
): RecordsItem {
  return {
    fish: { id: name, name, isRarest: false },
    state,
    record:
      weight === null
        ? null
        : {
            weightGrams: weight,
            waterbody: 'База',
            fishingBase,
            playerName: 'Игрок',
            caughtAt: '2026-09-09T10:00:00Z',
          },
    normalMaxWeightGrams: percent === null ? null : 1_000,
    maxBases,
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

  test('sorts by the first displayed tied-max Base and keeps missing Bases last', () => {
    const rowsByBase = [
      row('Нет базы', 'RECORD', null, 900),
      row('Байкал', 'RECORD', 10, 900, [{ id: 'baikal', name: 'Байкал', isActive: true }]),
      row('Байкал второй', 'RECORD', 10, 900, [
        { id: 'other-baikal', name: 'Байкал', isActive: true },
      ]),
      row('Ахтуба', 'RECORD', 10, 900, [
        { id: 'akhtuba', name: 'Ахтуба', isActive: true },
        { id: 'volga', name: 'Волга', isActive: true },
      ]),
    ];

    expect(
      sortRecords(rowsByBase, { key: 'maxBase', direction: 'asc' }).map((item) => item.fish.name),
    ).toEqual(['Ахтуба', 'Байкал', 'Байкал второй', 'Нет базы']);
    expect(
      sortRecords(rowsByBase, { key: 'maxBase', direction: 'desc' }).map((item) => item.fish.name),
    ).toEqual(['Байкал', 'Байкал второй', 'Ахтуба', 'Нет базы']);
    expect(readRecordsSort(new URLSearchParams('sort=maxBase&direction=asc'))).toEqual({
      key: 'maxBase',
      direction: 'asc',
    });
    expect(recordsSortSearch({ key: 'maxBase', direction: 'desc' })).toBe(
      'sort=maxBase&direction=desc',
    );
  });

  test('sorts by displayed caught-at Base with missing Bases last and Fish-name ties', () => {
    const rowsByFishingBase = [
      row('Нет базы', 'RECORD', 10, 900),
      row('Байкал второй', 'RECORD', 10, 900, [], {
        id: 'other-baikal',
        name: 'Байкал',
        isActive: false,
      }),
      row('Ахтуба', 'RECORD', 10, 900, [], {
        id: 'akhtuba',
        name: 'Ахтуба',
        isActive: true,
      }),
      row('Байкал', 'RECORD', 10, 900, [], {
        id: 'baikal',
        name: 'Байкал',
        isActive: true,
      }),
    ];

    expect(
      sortRecords(rowsByFishingBase, { key: 'fishingBase', direction: 'asc' }).map(
        (item) => item.fish.name,
      ),
    ).toEqual(['Ахтуба', 'Байкал', 'Байкал второй', 'Нет базы']);
    expect(
      sortRecords(rowsByFishingBase, { key: 'fishingBase', direction: 'desc' }).map(
        (item) => item.fish.name,
      ),
    ).toEqual(['Байкал', 'Байкал второй', 'Ахтуба', 'Нет базы']);
    expect(readRecordsSort(new URLSearchParams('sort=fishingBase&direction=asc'))).toEqual({
      key: 'fishingBase',
      direction: 'asc',
    });
    expect(recordsSortSearch({ key: 'fishingBase', direction: 'desc' })).toBe(
      'sort=fishingBase&direction=desc',
    );
  });
});
