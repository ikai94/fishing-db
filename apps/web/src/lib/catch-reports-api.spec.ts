import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
}));

vi.mock('./api-client', () => ({
  apiRequest: mocks.apiRequest,
}));

import {
  decodeCatchReportDraft,
  decodeOwnerCatchReport,
  decodePublicCatchReport,
  listCatchReports,
  listMyCatchReports,
  parseCatchReport,
} from './catch-reports-api';

const publicReport = {
  id: 'report',
  author: { id: 'user', nickname: 'Рыбак' },
  fishingBase: { id: 'base', name: 'Амур' },
  location: { id: 'location', number: 1, name: 'Протока' },
  fish: { id: 'fish', name: 'Кижуч' },
  bait: { id: 'bait', name: 'Vib-rapan' },
  weightGrams: 7242,
  fishingMethod: 'SPINNING',
  holeDepthCm: null,
  spotPositionRaw: null,
  fishingNote: null,
  spinningSize: 'MEDIUM',
  spinningSpeed: 'SLOW',
  userNoteRaw: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

describe('decodePublicCatchReport', () => {
  test('accepts the explicit v2 public projection', () => {
    expect(decodePublicCatchReport(publicReport)).toEqual(publicReport);
  });

  test('rejects accidental owner raw-source leakage', () => {
    expect(() => decodePublicCatchReport({ ...publicReport, rawSourceText: 'приватно' })).toThrow();
  });

  test('rejects live bait type in a historical report projection', () => {
    expect(() =>
      decodePublicCatchReport({ ...publicReport, bait: { ...publicReport.bait, type: 'LURE' } }),
    ).toThrow();
  });

  test('accepts raw source only through the explicit owner projection', () => {
    expect(
      decodeOwnerCatchReport({ ...publicReport, rawSourceText: 'Кижуч 7,242 кг' }).rawSourceText,
    ).toBe('Кижуч 7,242 кг');
  });
});

describe('decodeCatchReportDraft', () => {
  test('decodes resolved, missing and optional-null fields without losing warnings', () => {
    const optionalNull = {
      status: 'RESOLVED',
      sourceText: null,
      value: null,
      required: false,
    };
    const draft = decodeCatchReportDraft({
      rawSourceText: 'Кижуч 7,242 кг',
      fields: {
        fishingBase: {
          status: 'RESOLVED',
          sourceText: 'Амур',
          required: true,
          value: { id: 'base', name: 'Амур' },
        },
        location: {
          status: 'RESOLVED',
          sourceText: 'Протока',
          required: true,
          value: { id: 'location', number: 1, name: 'Протока' },
        },
        fish: {
          status: 'RESOLVED',
          sourceText: 'Кижуч',
          required: true,
          value: { id: 'fish', name: 'Кижуч' },
        },
        bait: {
          status: 'RESOLVED',
          sourceText: 'Vib-rapan',
          required: true,
          value: { id: 'bait', name: 'Vib-rapan', type: 'LURE' },
        },
        weightGrams: { status: 'RESOLVED', sourceText: '7,242 кг', value: 7242, required: true },
        fishingMethod: {
          status: 'RESOLVED',
          sourceText: 'Vib-rapan',
          value: 'SPINNING',
          required: true,
        },
        holeDepthCm: optionalNull,
        spotPositionRaw: optionalNull,
        fishingNote: optionalNull,
        spinningSize: { status: 'MISSING', sourceText: null, value: null, required: true },
        spinningSpeed: { status: 'MISSING', sourceText: null, value: null, required: true },
        userNoteRaw: optionalNull,
      },
      baseFishMembership: { status: 'RESOLVED', baseId: 'base', fishId: 'fish' },
      issues: [{ severity: 'WARNING', code: 'UNRESOLVED_FRAGMENT', message: 'Проверьте текст' }],
      unresolvedFragments: [{ text: 'игродень', start: 10, end: 18 }],
      missingRequiredFields: ['spinningSize', 'spinningSpeed'],
      canConfirm: false,
    });

    expect(draft.fields.weightGrams.value).toBe(7242);
    expect(draft.fields.spinningSize.status).toBe('MISSING');
    expect(draft.unresolvedFragments[0]?.text).toBe('игродень');
    expect(draft.issues[0]?.severity).toBe('WARNING');
  });
});

describe('parseCatchReport', () => {
  beforeEach(() => mocks.apiRequest.mockReset());

  test('passes the exact multiline source and caller abort signal to the parse request', async () => {
    const rawSourceText = 'Кижуч 7,242 кг\r\nПойман на Амуре:\n\tямка 7,63';
    const missing = { status: 'MISSING', sourceText: null, value: null, required: true };
    mocks.apiRequest.mockResolvedValue({
      draft: {
        rawSourceText,
        fields: {
          fishingBase: missing,
          location: missing,
          fish: missing,
          bait: missing,
          weightGrams: missing,
          fishingMethod: missing,
          holeDepthCm: missing,
          spotPositionRaw: missing,
          fishingNote: missing,
          spinningSize: missing,
          spinningSpeed: missing,
          userNoteRaw: missing,
        },
        baseFishMembership: { status: 'MISSING', baseId: null, fishId: null },
        issues: [],
        unresolvedFragments: [],
        missingRequiredFields: [],
        canConfirm: false,
      },
    });
    const controller = new AbortController();

    await expect(parseCatchReport(rawSourceText, controller.signal)).resolves.toMatchObject({
      rawSourceText,
    });
    expect(mocks.apiRequest).toHaveBeenCalledWith('/catch-reports/parse', {
      method: 'POST',
      body: JSON.stringify({ rawSourceText }),
      signal: controller.signal,
    });
  });
});

describe('CatchReport list requests', () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset();
    mocks.apiRequest.mockResolvedValue({ items: [], nextCursor: null });
  });

  test('serializes a deterministic public Fish/Base scope with pagination', async () => {
    const controller = new AbortController();

    await listCatchReports({
      limit: 20,
      cursor: 'next page',
      fishId: 'fish-id',
      baseIds: ['base-b', 'base-a', 'base-b'],
      signal: controller.signal,
    });

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      '/catch-reports?limit=20&cursor=next+page&fishId=fish-id&baseIds=base-a%2Cbase-b',
      { signal: controller.signal },
    );
  });

  test('rejects an explicit empty Base scope instead of omitting the filter', async () => {
    await expect(listCatchReports({ fishId: 'fish-id', baseIds: [] })).rejects.toThrow(
      'хотя бы одну рыболовную базу',
    );
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });

  test('keeps the owner list contract pagination-only', async () => {
    await listMyCatchReports({ limit: 5, cursor: 'owner-cursor' });

    expect(mocks.apiRequest).toHaveBeenCalledWith('/me/catch-reports?limit=5&cursor=owner-cursor', {
      signal: undefined,
    });
  });
});
