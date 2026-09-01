import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { CatchReport, CatchReportDraft } from '@/lib/catch-reports-api';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  createCatchReport: vi.fn(),
  updateCatchReport: vi.fn(),
  listFishingBases: vi.fn(),
  listBaits: vi.fn(),
  listScreenAnchors: vi.fn(),
  getFishingBase: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh, replace: mocks.replace }),
}));

vi.mock('@/lib/catalog-api', () => ({
  listFishingBases: mocks.listFishingBases,
  listBaits: mocks.listBaits,
  listScreenAnchors: mocks.listScreenAnchors,
  getFishingBase: mocks.getFishingBase,
}));

vi.mock('@/lib/catch-reports-api', () => ({
  createCatchReport: mocks.createCatchReport,
  updateCatchReport: mocks.updateCatchReport,
}));

import { CatchReportForm } from './catch-report-form';
import { CatchReportDraftPreview } from './catch-report-draft-preview';

const report: CatchReport = {
  id: 'report-1',
  author: { id: 'user-1', nickname: 'Рыбак' },
  fishingBase: { id: 'base-1', name: 'Амур' },
  location: { id: 'location-1', number: 1, name: 'Протока' },
  fish: { id: 'fish-1', name: 'Амурская Щука' },
  bait: { id: 'bait-1', name: 'Мотыль' },
  weightGrams: 1000,
  weightAssessment: {
    classification: 'ordinary',
    minWeightGrams: 100,
    maxWeightGrams: 2_000,
  },
  fishingMethod: 'BAIT_FISHING',
  holeDepthCm: 600,
  spotPositionRaw: 'удочка',
  fishingNote: null,
  spinningSize: null,
  spinningSpeed: null,
  userNoteRaw: null,
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
};

const optionalNull = {
  status: 'RESOLVED' as const,
  sourceText: null,
  value: null,
  required: false,
};

function baitDraft(overrides: Partial<CatchReportDraft> = {}): CatchReportDraft {
  const draft: CatchReportDraft = {
    rawSourceText: 'Амурская Щука 1000 грамм. Поймана на Амур: Протока, Мотыль. ямка 6,00',
    fields: {
      fishingBase: {
        status: 'RESOLVED',
        sourceText: 'Амур',
        value: { id: 'base-1', name: 'Амур' },
        required: true,
      },
      location: {
        status: 'RESOLVED',
        sourceText: 'Протока',
        value: { id: 'location-1', number: 1, name: 'Протока' },
        required: true,
      },
      fish: {
        status: 'RESOLVED',
        sourceText: 'Амурская Щука',
        value: { id: 'fish-1', name: 'Амурская Щука' },
        required: true,
      },
      bait: {
        status: 'RESOLVED',
        sourceText: 'Мотыль',
        value: { id: 'bait-1', name: 'Мотыль', type: 'BAIT' },
        required: true,
      },
      weightGrams: {
        status: 'RESOLVED',
        sourceText: '1000 грамм',
        value: 1000,
        required: true,
      },
      fishingMethod: {
        status: 'RESOLVED',
        sourceText: 'Мотыль',
        value: 'BAIT_FISHING',
        required: true,
      },
      holeDepthCm: {
        status: 'RESOLVED',
        sourceText: '6,00',
        value: 600,
        required: false,
      },
      spotPositionRaw: optionalNull,
      fishingNote: optionalNull,
      spinningSize: optionalNull,
      spinningSpeed: optionalNull,
      userNoteRaw: optionalNull,
    },
    baseFishMembership: { status: 'RESOLVED', baseId: 'base-1', fishId: 'fish-1' },
    issues: [],
    unresolvedFragments: [],
    missingRequiredFields: [],
    canConfirm: true,
  };
  return { ...draft, ...overrides };
}

describe('CatchReportForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFishingBases.mockResolvedValue([
      { id: 'base-1', name: 'Амур' },
      { id: 'base-2', name: 'Байкал' },
    ]);
    // The catalog type drifted to LURE, but the unchanged historical report remains BAIT_FISHING.
    mocks.listBaits.mockResolvedValue([
      { id: 'bait-1', name: 'Мотыль', type: 'LURE' },
      { id: 'bait-2', name: 'Vib-rapan', type: 'LURE' },
    ]);
    mocks.listScreenAnchors.mockResolvedValue([{ id: 'anchor', name: 'Удочка' }]);
    mocks.getFishingBase.mockImplementation(async (id: string) =>
      id === 'base-1'
        ? {
            id: 'base-1',
            name: 'Амур',
            locations: [
              { id: 'location-1', number: 1, name: 'Протока' },
              { id: 'location-2', number: 2, name: 'Хутор' },
            ],
            fish: [{ id: 'fish-1', name: 'Амурская Щука' }],
          }
        : {
            id: 'base-2',
            name: 'Байкал',
            locations: [{ id: 'location-3', number: 1, name: 'Берег' }],
            fish: [{ id: 'fish-2', name: 'Омуль' }],
          },
    );
  });

  test('uses persisted method when the same bait id now has another catalog type', async () => {
    const user = userEvent.setup();
    render(<CatchReportForm initialReport={report} />);
    expect(await screen.findByText('Ловля на наживку')).toBeInTheDocument();
    expect(screen.queryByLabelText('Размер *')).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: /Наживка или приманка/ }));
    await user.click(screen.getByRole('option', { name: 'Vib-rapan' }));
    expect(screen.getByText('Спиннинг')).toBeInTheDocument();
    expect(screen.getByLabelText(/Размер/)).toBeInTheDocument();
  });

  test('changing Location within a Base retains Fish', async () => {
    const user = userEvent.setup();
    render(<CatchReportForm initialReport={report} />);
    const location = await screen.findByRole('combobox', { name: /Локация/ });
    const fish = screen.getByRole('combobox', { name: /^Рыба/ });
    await waitFor(() => expect(location).not.toBeDisabled());
    expect(fish).toHaveValue('Амурская Щука');
    await user.click(location);
    await user.click(screen.getByRole('option', { name: '2. Хутор' }));
    expect(fish).toHaveValue('Амурская Щука');
  });

  test('requires an active Base Fish when Location changes from historical references', async () => {
    const user = userEvent.setup();
    mocks.getFishingBase.mockResolvedValue({
      id: 'base-1',
      name: 'Амур',
      locations: [
        { id: 'location-1', number: 1, name: 'Протока' },
        { id: 'location-2', number: 2, name: 'Хутор' },
      ],
      fish: [],
    });
    render(<CatchReportForm initialReport={report} />);
    const location = await screen.findByRole('combobox', { name: /Локация/ });
    await waitFor(() => expect(location).not.toBeDisabled());

    await user.click(location);
    await user.click(screen.getByRole('option', { name: '2. Хутор' }));

    expect(screen.getByRole('combobox', { name: /^Рыба/ })).toHaveValue(
      'Амурская Щука (текущее историческое значение)',
    );
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled();
  });

  test('requires an active Location when Fish changes from historical references', async () => {
    const user = userEvent.setup();
    mocks.getFishingBase.mockResolvedValue({
      id: 'base-1',
      name: 'Амур',
      locations: [{ id: 'location-2', number: 2, name: 'Хутор' }],
      fish: [
        { id: 'fish-1', name: 'Амурская Щука' },
        { id: 'fish-2', name: 'Сом' },
      ],
    });
    render(<CatchReportForm initialReport={report} />);
    const fish = await screen.findByRole('combobox', { name: /^Рыба/ });
    await waitFor(() => expect(fish).not.toBeDisabled());

    await user.click(fish);
    await user.click(screen.getByRole('option', { name: 'Сом' }));

    expect(screen.getByRole('combobox', { name: /Локация/ })).toHaveValue(
      '1. Протока (текущее историческое значение)',
    );
    expect(screen.getByRole('button', { name: 'Сохранить изменения' })).toBeDisabled();
  });

  test('changing Base clears dependent Location and Fish', async () => {
    const user = userEvent.setup();
    render(<CatchReportForm initialReport={report} />);
    await screen.findByText('Ловля на наживку');
    await user.click(screen.getByRole('combobox', { name: /Рыболовная база/ }));
    await user.click(screen.getByRole('option', { name: 'Байкал' }));
    expect(screen.getByRole('combobox', { name: /Локация/ })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: /^Рыба/ })).toHaveValue('');
  });

  test('allows a BAIT report to clear its optional hole', async () => {
    const user = userEvent.setup();
    mocks.updateCatchReport.mockResolvedValue({ id: report.id });
    render(<CatchReportForm initialReport={report} />);
    const depth = await screen.findByLabelText(/Глубина ямки/);
    await user.clear(depth);
    const submit = screen.getByRole('button', { name: 'Сохранить изменения' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.updateCatchReport).toHaveBeenCalledWith(report.id, { holeDepthCm: null }),
    );
  });

  test('namespaces every input, listbox and datalist id when two create forms coexist', async () => {
    render(
      <>
        <CatchReportForm />
        <CatchReportForm />
      </>,
    );
    const comboboxes = (await screen.findAllByRole('combobox')).filter(
      (element) => element.getAttribute('aria-autocomplete') === 'list',
    );
    expect(comboboxes).toHaveLength(8);

    fireEvent.focus(comboboxes[0]);
    fireEvent.focus(comboboxes[4]);
    expect(screen.getAllByRole('listbox')).toHaveLength(2);

    const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const input of screen.getAllByLabelText('Позиция на экране')) {
      const listId = input.getAttribute('list');
      expect(listId).toBeTruthy();
      expect(document.getElementById(listId ?? '')?.tagName).toBe('DATALIST');
    }
  });

  test('recomputes BLOCKING issues after repair while keeping WARNING nonblocking', async () => {
    const user = userEvent.setup();
    mocks.listBaits.mockResolvedValue([{ id: 'bait-1', name: 'Мотыль', type: 'BAIT' }]);
    const draft = baitDraft({
      fields: {
        ...baitDraft().fields,
        location: { status: 'MISSING', sourceText: null, value: null, required: true },
      },
      issues: [
        {
          severity: 'BLOCKING',
          code: 'MISSING_LOCATION',
          field: 'location',
          message: 'Не удалось определить локацию',
        },
        {
          severity: 'WARNING',
          code: 'UNRESOLVED_FRAGMENT',
          message: 'Проверьте фрагмент «игродень»',
        },
      ],
      unresolvedFragments: [{ text: 'игродень', start: 1, end: 9 }],
      missingRequiredFields: ['location'],
      canConfirm: false,
    });
    render(<CatchReportDraftPreview draft={draft} canSave />);

    const submit = await screen.findByRole('button', { name: 'Подтвердить и опубликовать' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Не удалось определить локацию')).toBeInTheDocument();
    expect(screen.getByText(/Проверьте фрагмент/)).toBeInTheDocument();

    const location = screen.getByRole('combobox', { name: /Локация/ });
    await waitFor(() => expect(location).not.toBeDisabled());
    await user.click(location);
    await user.click(screen.getByRole('option', { name: '1. Протока' }));

    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText('Не удалось определить локацию')).not.toBeInTheDocument();
    expect(screen.getByText(/Проверьте фрагмент/)).toBeInTheDocument();
    expect(screen.getByText('Исправлено')).toBeInTheDocument();
  });

  test('creates the repaired parsed report with exact raw source and no derived-only fields', async () => {
    const user = userEvent.setup();
    mocks.listBaits.mockResolvedValue([{ id: 'bait-1', name: 'Мотыль', type: 'BAIT' }]);
    mocks.createCatchReport.mockResolvedValue({ id: 'created-report' });
    const draft = baitDraft();
    render(<CatchReportForm initialDraft={draft} />);

    const submit = await screen.findByRole('button', { name: 'Подтвердить и опубликовать' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(mocks.createCatchReport).toHaveBeenCalledWith({
        locationId: 'location-1',
        fishId: 'fish-1',
        baitId: 'bait-1',
        weightGrams: 1000,
        holeDepthCm: 600,
        spotPositionRaw: null,
        fishingNote: null,
        spinningSize: null,
        spinningSpeed: null,
        userNoteRaw: null,
        rawSourceText: draft.rawSourceText,
      }),
    );
    const payload = mocks.createCatchReport.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('baseId');
    expect(payload).not.toHaveProperty('fishingMethod');
  });

  test('emits a valid batch-row payload without submitting an individual report', async () => {
    mocks.listBaits.mockResolvedValue([{ id: 'bait-1', name: 'Мотыль', type: 'BAIT' }]);
    const onCreateInputChange = vi.fn();
    const draft = baitDraft();
    const view = render(
      <CatchReportForm
        initialDraft={draft}
        embeddedBatchRow
        onCreateInputChange={onCreateInputChange}
      />,
    );

    await waitFor(() =>
      expect(onCreateInputChange).toHaveBeenLastCalledWith({
        locationId: 'location-1',
        fishId: 'fish-1',
        baitId: 'bait-1',
        weightGrams: 1000,
        holeDepthCm: 600,
        spotPositionRaw: null,
        fishingNote: null,
        spinningSize: null,
        spinningSpeed: null,
        userNoteRaw: null,
        rawSourceText: draft.rawSourceText,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Подтвердить и опубликовать' })).toBeNull();
    fireEvent.submit(view.container.querySelector('form')!);
    expect(mocks.createCatchReport).not.toHaveBeenCalled();
  });

  test('sends a sparse PATCH and omits a redundant same bait id', async () => {
    const user = userEvent.setup();
    mocks.updateCatchReport.mockResolvedValue({ id: report.id });
    render(<CatchReportForm initialReport={report} />);
    const weight = await screen.findByLabelText(/Вес, граммы/);
    await user.clear(weight);
    await user.type(weight, '1001');
    const submit = screen.getByRole('button', { name: 'Сохранить изменения' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    await waitFor(() =>
      expect(mocks.updateCatchReport).toHaveBeenCalledWith(report.id, { weightGrams: 1001 }),
    );
  });

  test('derives BAIT to LURE controls locally and sends only the actual transition fields', async () => {
    const user = userEvent.setup();
    mocks.updateCatchReport.mockResolvedValue({ id: report.id });
    render(<CatchReportForm initialReport={report} />);
    await screen.findByText('Ловля на наживку');

    await user.click(screen.getByRole('combobox', { name: /Наживка или приманка/ }));
    await user.click(screen.getByRole('option', { name: 'Vib-rapan' }));
    await user.click(screen.getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() =>
      expect(mocks.updateCatchReport).toHaveBeenCalledWith(report.id, {
        baitId: 'bait-2',
      }),
    );
  });

  test('clears stale spinning data without requiring a hole for a LURE to BAIT transition', async () => {
    const user = userEvent.setup();
    const spinningReport: CatchReport = {
      ...report,
      bait: { id: 'bait-2', name: 'Vib-rapan' },
      fishingMethod: 'SPINNING',
      holeDepthCm: null,
      spinningSize: 'MEDIUM',
      spinningSpeed: 'SLOW',
    };
    mocks.listBaits.mockResolvedValue([
      { id: 'bait-2', name: 'Vib-rapan', type: 'LURE' },
      { id: 'bait-3', name: 'Большой живец', type: 'BAIT' },
    ]);
    mocks.updateCatchReport.mockResolvedValue({ id: report.id });
    render(<CatchReportForm initialReport={spinningReport} />);
    await screen.findByText('Спиннинг');

    await user.click(screen.getByRole('combobox', { name: /Наживка или приманка/ }));
    await user.click(screen.getByRole('option', { name: 'Большой живец' }));
    expect(screen.queryByLabelText(/Размер/)).not.toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Сохранить изменения' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(mocks.updateCatchReport).toHaveBeenCalledWith(report.id, {
        baitId: 'bait-3',
        spinningSize: null,
        spinningSpeed: null,
      }),
    );
  });
});
