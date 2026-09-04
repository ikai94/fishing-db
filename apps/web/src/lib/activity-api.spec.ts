import { describe, expect, test } from 'vitest';
import { decodeActivityPage } from './activity-api';

const report = {
  reportId: '20000000-0000-4000-8000-000000000001',
  fish: { id: '40000000-0000-4000-8000-000000000001', name: 'Кижуч' },
  fishingBase: { id: '60000000-0000-4000-8000-000000000001', name: 'Амур' },
  location: {
    id: '30000000-0000-4000-8000-000000000001',
    number: 7,
    name: 'Протока',
  },
  bait: { id: '50000000-0000-4000-8000-000000000001', name: 'Мотыль' },
  weightGrams: 950,
};

describe('activity API decoder', () => {
  test('decodes the public discriminated union', () => {
    const page = decodeActivityPage({
      items: [
        {
          id: '2',
          type: 'CATCH_REPORT_UPDATED',
          occurredAt: '2026-09-04T12:00:00.000Z',
          actor: { kind: 'ANGLER', nickname: 'Рыбак' },
          data: { report, changedFields: ['weightGrams'] },
        },
        {
          id: '1',
          type: 'CATALOG_ITEM_UPDATED',
          occurredAt: '2026-09-04T11:00:00.000Z',
          actor: { kind: 'ADMINISTRATION' },
          data: {
            item: {
              kind: 'FISH',
              id: '40000000-0000-4000-8000-000000000001',
              name: 'Кижуч',
              isActive: false,
            },
            changes: [{ field: 'isActive', before: true, after: false }],
          },
        },
      ],
      nextCursor: 'cursor',
    });

    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('cursor');
  });

  test.each([
    ['internal actor id', { actorUserId: 'secret' }],
    ['raw source', { rawSourceText: 'private' }],
    ['raw payload', { payload: { report } }],
  ])('rejects %s fields instead of silently accepting them', (_name, leakedField) => {
    expect(() =>
      decodeActivityPage({
        items: [
          {
            id: '1',
            type: 'CATCH_REPORT_CREATED',
            occurredAt: '2026-09-04T12:00:00.000Z',
            actor: { kind: 'ANGLER', nickname: 'Рыбак' },
            data: { report },
            ...leakedField,
          },
        ],
        nextCursor: null,
      }),
    ).toThrow('Сервер вернул некорректную ленту активности');
  });
});
