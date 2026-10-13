import { expect, test, vi } from 'vitest';
import {
  decodeBaseFishNotebook,
  getBaseFishNotebook,
  saveBaseFishNotebookEntry,
  setBaseFishNotebookVisibility,
  decodeFishPersonalNotes,
  getFishPersonalNotes,
} from './base-fish-notebook-api';
import { apiRequest } from './api-client';
vi.mock('./api-client', () => ({ apiRequest: vi.fn(), apiBaseUrl: 'http://localhost:3001' }));

test('Fish notes preserve formatting and reject extra owner/storage fields', async () => {
  const data = {
    rows: [
      { base: { id: 'base', name: 'База' }, noteText: '  Строка\n\tСтрока  ' },
      { base: { id: 'empty', name: 'Пустая' }, noteText: null },
    ],
  };
  expect(decodeFishPersonalNotes(data)).toEqual(data);
  for (const field of ['userId', 'fishId', 'rawSourceText', 'isHidden', 'importKey']) {
    expect(() => decodeFishPersonalNotes({ ...data, [field]: 'private' })).toThrow();
    expect(() =>
      decodeFishPersonalNotes({ rows: [{ ...data.rows[0], [field]: 'private' }] }),
    ).toThrow();
    expect(() =>
      decodeFishPersonalNotes({
        rows: [{ ...data.rows[0], base: { ...data.rows[0]!.base, [field]: 'private' } }],
      }),
    ).toThrow();
  }
  expect(() =>
    decodeFishPersonalNotes({ rows: [{ base: data.rows[0]!.base, noteText: 123 }] }),
  ).toThrow();
  vi.mocked(apiRequest).mockResolvedValue(data);
  const signal = new AbortController().signal;
  expect(await getFishPersonalNotes('fish/id', signal)).toEqual(data);
  expect(apiRequest).toHaveBeenLastCalledWith('/admin/catalog/fish/fish%2Fid/notebook', { signal });
});

const payload = {
  base: { id: 'base', name: 'База' },
  rows: [
    {
      fish: { id: 'fish', name: 'Рыба', image: null, isRarest: false, isNightBiting: false },
      minWeightGrams: null,
      maxWeightGrams: 456,
      noteText: null,

      topLocations: [{ id: 'location', name: 'Локация', number: 1, reportsCount: 7 }],
      totalCatchReports: 7,
      isHidden: false,
    },
  ],
};

test('decodes exact private projection and preserves stored bounds', () => {
  expect(decodeBaseFishNotebook(payload)).toEqual(payload);
  for (const key of ['rawSourceText', 'contributorKey', 'importKey', 'note']) {
    expect(() => decodeBaseFishNotebook({ ...payload, [key]: 'unexpected' })).toThrow();
    expect(() =>
      decodeBaseFishNotebook({ ...payload, rows: [{ ...payload.rows[0], [key]: 'unexpected' }] }),
    ).toThrow();
  }
  expect(() =>
    decodeBaseFishNotebook({ ...payload, rows: [{ ...payload.rows[0], maxWeightGrams: 1.5 }] }),
  ).toThrow();
  expect(() =>
    decodeBaseFishNotebook({
      ...payload,
      rows: [{ ...payload.rows[0], topLocations: Array(4).fill(payload.rows[0]!.topLocations[0]) }],
    }),
  ).toThrow();
  expect(() =>
    decodeBaseFishNotebook({
      ...payload,
      rows: [
        {
          ...payload.rows[0],
          fish: { ...payload.rows[0]!.fish, image: { url: 'https://external.test/fish.png' } },
        },
      ],
    }),
  ).toThrow();
});

test.each(['isRarest', 'isNightBiting'])(
  'requires the catalog boolean %s without coercion',
  (flag) => {
    for (const value of [undefined, null, 0, 1, 'true']) {
      expect(() =>
        decodeBaseFishNotebook({
          ...payload,
          rows: [{ ...payload.rows[0], fish: { ...payload.rows[0]!.fish, [flag]: value } }],
        }),
      ).toThrow();
    }
    expect(
      decodeBaseFishNotebook({
        ...payload,
        rows: [{ ...payload.rows[0], fish: { ...payload.rows[0]!.fish, [flag]: true } }],
      }).rows[0]?.fish[flag as 'isRarest' | 'isNightBiting'],
    ).toBe(true);
  },
);

test('saves only personal fields to the pair endpoint and strictly decodes the response', async () => {
  const fields = { noteText: 'Личная заметка' };
  vi.mocked(apiRequest).mockResolvedValue({ entry: fields });
  const signal = new AbortController().signal;
  expect(await saveBaseFishNotebookEntry('base', 'fish', fields, signal)).toEqual(fields);
  expect(apiRequest).toHaveBeenLastCalledWith('/admin/catalog/bases/base/notebook/fish/fish', {
    method: 'PUT',
    body: JSON.stringify(fields),
    signal,
  });
  vi.mocked(apiRequest).mockResolvedValue({ entry: { ...fields, userId: 'other-admin' } });
  await expect(saveBaseFishNotebookEntry('base', 'fish', fields)).rejects.toThrow();
});

test('rejects malformed or excessive personal text without leaking extra fields', () => {
  for (const value of [42, {}, 'x'.repeat(5001)]) {
    expect(() =>
      decodeBaseFishNotebook({ ...payload, rows: [{ ...payload.rows[0], noteText: value }] }),
    ).toThrow();
  }
  expect(() =>
    decodeBaseFishNotebook({ ...payload, rows: [{ ...payload.rows[0], userId: 'other-admin' }] }),
  ).toThrow();
});

test('uses only ADMIN endpoint and forwards request cancellation', async () => {
  vi.mocked(apiRequest).mockResolvedValue(payload);
  const signal = new AbortController().signal;
  expect(await getBaseFishNotebook('base', { signal })).toEqual(payload);
  expect(apiRequest).toHaveBeenCalledWith('/admin/catalog/bases/base/notebook', { signal });
});

test('visibility uses a dedicated owner endpoint and never sends noteText', async () => {
  const signal = new AbortController().signal;
  vi.mocked(apiRequest).mockResolvedValue({ visibility: { isHidden: true } });
  expect(await setBaseFishNotebookVisibility('base', 'fish', true, signal)).toBe(true);
  expect(apiRequest).toHaveBeenLastCalledWith(
    '/admin/catalog/bases/base/notebook/fish/fish/visibility',
    {
      method: 'PUT',
      body: JSON.stringify({ isHidden: true }),
      signal,
    },
  );
  for (const visibility of [
    { isHidden: 'true' },
    { isHidden: true, noteText: 'private' },
    { isHidden: false, userId: 'other' },
  ]) {
    vi.mocked(apiRequest).mockResolvedValue({ visibility });
    await expect(setBaseFishNotebookVisibility('base', 'fish', false)).rejects.toThrow();
  }
});

test('requires a personal boolean and nonnegative safe total count', () => {
  for (const value of [undefined, null, 'true', 1]) {
    expect(() =>
      decodeBaseFishNotebook({ ...payload, rows: [{ ...payload.rows[0], isHidden: value }] }),
    ).toThrow();
  }
  for (const value of [-1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1]) {
    expect(() =>
      decodeBaseFishNotebook({
        ...payload,
        rows: [{ ...payload.rows[0], totalCatchReports: value }],
      }),
    ).toThrow();
  }
  expect(
    decodeBaseFishNotebook({
      ...payload,
      rows: [{ ...payload.rows[0], totalCatchReports: 0, isHidden: true }],
    }).rows[0]?.isHidden,
  ).toBe(true);
});
