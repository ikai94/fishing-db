import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCatchReportsBatch: vi.fn(),
  getFishingBase: vi.fn(),
  listBaits: vi.fn(),
  listFishingBases: vi.fn(),
  listScreenAnchors: vi.fn(),
  routerRefresh: vi.fn(),
  routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mocks.routerRefresh,
    replace: mocks.routerReplace,
    push: vi.fn(),
  }),
}));

vi.mock('@/lib/catalog-api', () => ({
  getFishingBase: mocks.getFishingBase,
  listBaits: mocks.listBaits,
  listFishingBases: mocks.listFishingBases,
  listScreenAnchors: mocks.listScreenAnchors,
}));

vi.mock('@/lib/catch-reports-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/catch-reports-api')>()),
  createCatchReportsBatch: mocks.createCatchReportsBatch,
}));

import { CatchReportBatchPreview } from './catch-report-batch-preview';
import { CatchReportFormCatalogProvider } from './catch-report-form-catalog-context';
import type { CatchReportDraft, ParseCatchReportBatchResult } from '@/lib/catch-reports-api';

function draft(index: number): CatchReportDraft {
  const rawSourceText = `Амурская Щука 22,069 кг. Поймана на Амур: Протока бешеная - огороды, Живец. Строка ${index + 1}`;
  const optionalNull = {
    status: 'RESOLVED' as const,
    sourceText: null,
    value: null,
    required: false,
  };

  return {
    rawSourceText,
    fields: {
      fishingBase: {
        status: 'RESOLVED',
        sourceText: 'Амур',
        value: { id: 'base-amur', name: 'Амур' },
        required: true,
      },
      location: {
        status: 'RESOLVED',
        sourceText: 'Протока бешеная - огороды',
        value: {
          id: 'location-gardens',
          number: 1,
          name: 'Протока бешеная - огороды',
        },
        required: true,
      },
      fish: {
        status: 'RESOLVED',
        sourceText: 'Амурская Щука',
        value: { id: 'fish-amur-pike', name: 'Амурская Щука' },
        required: true,
      },
      bait: {
        status: 'RESOLVED',
        sourceText: 'Живец',
        value: { id: 'bait-live', name: 'Живец', type: 'BAIT' },
        required: true,
      },
      weightGrams: {
        status: 'RESOLVED',
        sourceText: '22,069 кг',
        value: 22_069,
        required: true,
      },
      fishingMethod: {
        status: 'RESOLVED',
        sourceText: 'Живец',
        value: 'BAIT_FISHING',
        required: true,
      },
      holeDepthCm: optionalNull,
      spotPositionRaw: optionalNull,
      fishingNote: optionalNull,
      spinningSize: optionalNull,
      spinningSpeed: optionalNull,
      userNoteRaw: optionalNull,
    },
    baseFishMembership: {
      status: 'RESOLVED',
      baseId: 'base-amur',
      fishId: 'fish-amur-pike',
    },
    issues: [],
    unresolvedFragments: [],
    missingRequiredFields: [],
    canConfirm: true,
  };
}

function batchResult(count = 42): ParseCatchReportBatchResult {
  return {
    rows: Array.from({ length: count }, (_, index) => ({
      index,
      sourceLine: index + 1,
      duplicateIndexes: [],
      draft: draft(index),
    })),
  };
}

function mismatchBatchResult(): ParseCatchReportBatchResult {
  const clean = draft(0);
  const mismatchSource = 'Чужая Рыба 22,069 кг. Поймана на Амур: Протока бешеная - огороды, Живец.';
  const mismatch: CatchReportDraft = {
    ...draft(1),
    rawSourceText: mismatchSource,
    fields: {
      ...draft(1).fields,
      fish: {
        status: 'RESOLVED',
        sourceText: 'Чужая Рыба',
        value: { id: 'fish-other-base-only', name: 'Чужая Рыба' },
        required: true,
      },
    },
    baseFishMembership: {
      status: 'UNRESOLVED',
      baseId: 'base-amur',
      fishId: 'fish-other-base-only',
    },
    issues: [
      {
        severity: 'BLOCKING',
        code: 'FISH_NOT_IN_BASE',
        field: 'fish',
        message: 'Рыба не связана с выбранной рыболовной базой',
      },
    ],
    canConfirm: false,
  };
  return {
    rows: [
      { index: 0, sourceLine: 1, duplicateIndexes: [], draft: clean },
      { index: 1, sourceLine: 2, duplicateIndexes: [], draft: mismatch },
    ],
  };
}

describe('CatchReport batch runtime hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFishingBases.mockResolvedValue([{ id: 'base-amur', name: 'Амур' }]);
    mocks.listBaits.mockResolvedValue([{ id: 'bait-live', name: 'Живец', type: 'BAIT' }]);
    mocks.listScreenAnchors.mockResolvedValue([]);
    mocks.getFishingBase.mockResolvedValue({
      id: 'base-amur',
      name: 'Амур',
      locations: [
        {
          id: 'location-gardens',
          number: 1,
          name: 'Протока бешеная - огороды',
        },
      ],
      fish: [{ id: 'fish-amur-pike', name: 'Амурская Щука' }],
    });
    mocks.createCatchReportsBatch.mockResolvedValue({
      createdCount: 42,
      reportIds: Array.from({ length: 42 }, (_, index) => `report-${index + 1}`),
    });
  });

  test('keeps 42 canonical drafts ready and mounts shared editors only on demand', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <CatchReportFormCatalogProvider>
          <CatchReportBatchPreview result={batchResult()} canSave />
        </CatchReportFormCatalogProvider>
      </StrictMode>,
    );

    expect(screen.getByText(/готово: 42;.*требует исправления: 0/iu)).toBeInTheDocument();
    expect(mocks.getFishingBase).not.toHaveBeenCalled();
    expect(screen.queryByText('Загружаем активный игровой каталог…')).not.toBeInTheDocument();

    expect(screen.getAllByText('Способ ловли: Ловля на наживку')).toHaveLength(42);

    const summaries = screen.getAllByText('Проверить и изменить поля');
    await user.click(summaries[0]!);
    await waitFor(() => expect(mocks.getFishingBase).toHaveBeenCalledTimes(1));
    await user.click(summaries[1]!);
    await waitFor(() => expect(mocks.getFishingBase).toHaveBeenCalledTimes(1));
    expect(mocks.listFishingBases).toHaveBeenCalledTimes(2);

    const save = screen.getAllByRole('button', { name: 'Сохранить 42 улова' })[0]!;
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1));
    expect(mocks.createCatchReportsBatch.mock.calls[0]?.[0]).toHaveLength(42);
    expect(await screen.findByText('Создано отчётов: 42')).toBeInTheDocument();
  }, 20_000);

  test('renders only the first 50 clean rows while submitting all 5000 in source order', async () => {
    const user = userEvent.setup();
    mocks.createCatchReportsBatch.mockResolvedValue({
      createdCount: 5_000,
      reportIds: Array.from({ length: 5_000 }, (_, index) => `report-${index + 1}`),
    });
    const { container } = render(
      <CatchReportFormCatalogProvider>
        <CatchReportBatchPreview result={batchResult(5_000)} canSave />
      </CatchReportFormCatalogProvider>,
    );

    expect(screen.getByText(/всего: 5000; готово: 5000/iu)).toBeInTheDocument();
    expect(container.querySelectorAll('article')).toHaveLength(50);
    expect(screen.getByText('Показано готовых строк: 50 из 5000.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Сохранить строку 51' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Сохранить 5000 уловов' })[0]!);
    await waitFor(() => expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1));
    const reports = mocks.createCatchReportsBatch.mock.calls[0]?.[0];
    expect(reports).toHaveLength(5_000);
    expect(reports[0].rawSourceText).toContain('Строка 1');
    expect(reports[4_999].rawSourceText).toContain('Строка 5000');
  }, 20_000);

  test('keeps a BaseFish mismatch blocking, first, and out of the submitted batch', async () => {
    const user = userEvent.setup();
    mocks.createCatchReportsBatch.mockResolvedValue({
      createdCount: 1,
      reportIds: ['report-clean'],
    });
    render(
      <StrictMode>
        <CatchReportFormCatalogProvider>
          <CatchReportBatchPreview result={mismatchBatchResult()} canSave />
        </CatchReportFormCatalogProvider>
      </StrictMode>,
    );

    await waitFor(
      () => expect(screen.getByText(/готово: 1;.*требует исправления: 1/iu)).toBeInTheDocument(),
      { timeout: 10_000 },
    );
    expect(
      screen
        .getAllByRole('checkbox', { name: /Сохранить строку/u })
        .map((checkbox) => checkbox.parentElement?.textContent?.trim()),
    ).toEqual(['Сохранить строку 2', 'Сохранить строку 1']);
    expect(screen.getAllByRole('button', { name: 'Сохранить 2 улова' })[0]).toBeDisabled();
    expect(screen.getByText('Рыба не связана с выбранной рыболовной базой')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Сохранить строку 2' }));
    const save = screen.getAllByRole('button', { name: 'Сохранить 1 улов' })[0]!;
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(mocks.createCatchReportsBatch).toHaveBeenCalledTimes(1));
    expect(mocks.createCatchReportsBatch.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ fishId: 'fish-amur-pike' }),
    ]);
  }, 20_000);
});
