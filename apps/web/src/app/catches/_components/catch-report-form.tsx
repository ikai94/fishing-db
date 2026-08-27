'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import styles from '../../catch-reports.module.css';
import {
  type CatchReportFormCatalogState,
  useSharedCatchReportFormCatalog,
} from './catch-report-form-catalog-context';
import {
  SearchableCombobox,
  type SearchableComboboxOption,
} from '@/components/searchable-combobox';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import {
  getFishingBase,
  listBaits,
  listFishingBases,
  listScreenAnchors,
  type PublicBait,
  type PublicCatalogItem,
  type PublicFishingBase,
} from '@/lib/catalog-api';
import {
  baitTypeToFishingMethod,
  FISHING_NOTE_OPTIONS,
  fishingMethodLabel,
  formatCentimetersAsMeters,
  normalizeSpotPositionRaw,
  normalizeUserNoteRaw,
  parseMetersToCentimeters,
  parseWeightGrams,
  SPINNING_SIZE_OPTIONS,
  SPINNING_SPEED_OPTIONS,
} from '@/lib/catch-report-form';
import {
  type CatchReport,
  type CatchReportDraft,
  createCatchReport,
  type CreateCatchReportInput,
  type DraftField,
  type FishingMethod,
  type FishingNote,
  type OwnerCatchReport,
  type SpinningSize,
  type SpinningSpeed,
  type UpdateCatchReportInput,
  updateCatchReport,
} from '@/lib/catch-reports-api';

type CatchReportFormProps = {
  initialReport?: CatchReport | OwnerCatchReport;
  initialDraft?: CatchReportDraft;
  canSave?: boolean;
  onValidationStateChange?: (state: CatchReportFormValidationState) => void;
  embeddedBatchRow?: boolean;
  onCreateInputChange?: (input: CreateCatchReportInput | null) => void;
};

export type CatchReportFormValidationState = {
  canConfirm: boolean;
  blockingFields: Array<keyof CatchReportDraft['fields']>;
  fishingMethod: FishingMethod | null;
};

type SelectionState =
  | { kind: 'ready'; key: string; data: PublicFishingBase }
  | { kind: 'historical'; key: string }
  | { kind: 'error'; key: string; message: string };

type FormField =
  | 'baseId'
  | 'locationId'
  | 'fishId'
  | 'baitId'
  | 'weightGrams'
  | 'holeDepthCm'
  | 'spotPositionRaw'
  | 'fishingNote'
  | 'spinningSize'
  | 'spinningSpeed'
  | 'userNoteRaw';
type FormErrors = Partial<Record<FormField, string>>;

type FormValidation = {
  errors: FormErrors;
  parsedWeight: number | undefined;
  parsedDepth: number | null | undefined;
  parsedPosition: string | null | undefined;
  parsedComment: string | null | undefined;
  canConfirm: boolean;
};

type CatalogOption = SearchableComboboxOption;
type BaitOption = CatalogOption & { type?: PublicBait['type'] };

export function CatchReportForm({
  initialReport,
  initialDraft,
  canSave = true,
  onValidationStateChange,
  embeddedBatchRow = false,
  onCreateInputChange,
}: CatchReportFormProps) {
  const router = useRouter();
  const sharedCatalog = useSharedCatchReportFormCatalog();
  const generatedId = useId().replace(/:/g, '');
  const formId = `catch-report-${generatedId}`;
  const fieldIds = {
    base: `${formId}-base`,
    location: `${formId}-location`,
    fish: `${formId}-fish`,
    bait: `${formId}-bait`,
    weight: `${formId}-weight`,
    depth: `${formId}-depth`,
    spinningSize: `${formId}-spinning-size`,
    spinningSpeed: `${formId}-spinning-speed`,
    position: `${formId}-position`,
    positionSuggestions: `${formId}-screen-anchor-suggestions`,
    fishingNote: `${formId}-fishing-note`,
    comment: `${formId}-comment`,
    originalSource: `${formId}-original-source`,
  };
  const isEdit = initialReport !== undefined;
  const draftBase = resolvedDraftValue(initialDraft?.fields.fishingBase);
  const draftLocation = resolvedDraftValue(initialDraft?.fields.location);
  const draftFish = resolvedDraftValue(initialDraft?.fields.fish);
  const draftBait = resolvedDraftValue(initialDraft?.fields.bait);
  const draftWeight = resolvedDraftValue(initialDraft?.fields.weightGrams);
  const draftDepth = resolvedDraftValue(initialDraft?.fields.holeDepthCm);

  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [localCatalog, setLocalCatalog] = useState<CatchReportFormCatalogState>({
    kind: 'loading',
  });
  const [baseId, setBaseId] = useState(initialReport?.fishingBase.id ?? draftBase?.id ?? '');
  const [locationId, setLocationId] = useState(
    initialReport?.location.id ?? draftLocation?.id ?? '',
  );
  const [fishId, setFishId] = useState(initialReport?.fish.id ?? draftFish?.id ?? '');
  const [baitId, setBaitId] = useState(initialReport?.bait.id ?? draftBait?.id ?? '');
  const [weightGrams, setWeightGrams] = useState(
    initialReport
      ? String(initialReport.weightGrams)
      : draftWeight === null
        ? ''
        : String(draftWeight),
  );
  const [holeDepthMeters, setHoleDepthMeters] = useState(
    initialReport?.holeDepthCm
      ? formatCentimetersAsMeters(initialReport.holeDepthCm)
      : draftDepth
        ? formatCentimetersAsMeters(draftDepth)
        : '',
  );
  const [spotPositionRaw, setSpotPositionRaw] = useState(
    initialReport?.spotPositionRaw ??
      resolvedDraftValue(initialDraft?.fields.spotPositionRaw) ??
      '',
  );
  const [fishingNote, setFishingNote] = useState<FishingNote | ''>(
    initialReport?.fishingNote ?? resolvedDraftValue(initialDraft?.fields.fishingNote) ?? '',
  );
  const [spinningSize, setSpinningSize] = useState<SpinningSize | ''>(
    initialReport?.spinningSize ?? resolvedDraftValue(initialDraft?.fields.spinningSize) ?? '',
  );
  const [spinningSpeed, setSpinningSpeed] = useState<SpinningSpeed | ''>(
    initialReport?.spinningSpeed ?? resolvedDraftValue(initialDraft?.fields.spinningSpeed) ?? '',
  );
  const [userNoteRaw, setUserNoteRaw] = useState(
    initialReport?.userNoteRaw ?? resolvedDraftValue(initialDraft?.fields.userNoteRaw) ?? '',
  );
  const [baseState, setBaseState] = useState<SelectionState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (sharedCatalog !== null) return;
    const controller = new AbortController();
    async function loadCatalog() {
      try {
        const [bases, baits, screenAnchors] = await Promise.all([
          listFishingBases(controller.signal),
          listBaits(controller.signal),
          listScreenAnchors(controller.signal),
        ]);
        setLocalCatalog({ kind: 'ready', bases, baits, screenAnchors });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLocalCatalog({
          kind: 'error',
          message: getApiErrorMessage(error, 'Не удалось загрузить активный игровой каталог.'),
        });
      }
    }
    void loadCatalog();
    return () => controller.abort();
  }, [catalogAttempt, sharedCatalog]);

  const catalog = sharedCatalog?.state ?? localCatalog;
  const catalogRevision = sharedCatalog?.revision ?? catalogAttempt;

  const baseRequestKey = `${baseId}:${catalogRevision}`;
  useEffect(() => {
    if (!baseId || catalog.kind !== 'ready') return;
    const controller = new AbortController();
    const key = `${baseId}:${catalogRevision}`;

    async function loadBase() {
      try {
        const data =
          sharedCatalog === null
            ? await getFishingBase(baseId, controller.signal)
            : await sharedCatalog.loadBase(baseId);
        if (controller.signal.aborted) return;
        setBaseState({ kind: 'ready', key, data });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.status === 404 && initialReport?.fishingBase.id === baseId) {
          setBaseState({ kind: 'historical', key });
          return;
        }
        setBaseState({
          kind: 'error',
          key,
          message: getApiErrorMessage(error, 'Не удалось загрузить локации и рыб выбранной базы.'),
        });
      }
    }
    void loadBase();
    return () => controller.abort();
  }, [baseId, catalog.kind, catalogRevision, initialReport, sharedCatalog]);

  const baseSelection = baseState?.key === baseRequestKey ? baseState : null;

  const baseOptions = useMemo<CatalogOption[]>(() => {
    if (catalog.kind !== 'ready') return [];
    return withHistoricalOption(
      catalog.bases,
      initialReport
        ? { id: initialReport.fishingBase.id, name: initialReport.fishingBase.name }
        : (draftBase ?? undefined),
    );
  }, [catalog, draftBase, initialReport]);

  const locationOptions = useMemo<CatalogOption[]>(() => {
    const active =
      baseSelection?.kind === 'ready'
        ? baseSelection.data.locations.map((location) => ({
            id: location.id,
            name: `${location.number}. ${location.name}`,
          }))
        : [];
    const historical =
      initialReport && initialReport.fishingBase.id === baseId
        ? {
            id: initialReport.location.id,
            name: `${initialReport.location.number}. ${initialReport.location.name}`,
          }
        : draftBase?.id === baseId && draftLocation
          ? { id: draftLocation.id, name: `${draftLocation.number}. ${draftLocation.name}` }
          : undefined;
    return withHistoricalOption(active, historical);
  }, [baseId, baseSelection, draftBase, draftLocation, initialReport]);

  const fishOptions = useMemo<CatalogOption[]>(() => {
    const active = baseSelection?.kind === 'ready' ? baseSelection.data.fish : [];
    const historical =
      initialReport && initialReport.fishingBase.id === baseId
        ? { id: initialReport.fish.id, name: initialReport.fish.name }
        : draftBase?.id === baseId && draftFish
          ? draftFish
          : undefined;
    return withHistoricalOption(active, historical);
  }, [baseId, baseSelection, draftBase, draftFish, initialReport]);

  const baitOptions = useMemo<BaitOption[]>(() => {
    if (catalog.kind !== 'ready') return [];
    const active: BaitOption[] = catalog.baits.map((bait) => ({ ...bait }));
    const historical: BaitOption | undefined = initialReport
      ? { id: initialReport.bait.id, name: initialReport.bait.name }
      : (draftBait ?? undefined);
    return withHistoricalBait(active, historical);
  }, [catalog, draftBait, initialReport]);

  const fishingMethod = resolveFishingMethod({ initialReport, initialDraft, baitId, baitOptions });
  const validation = useMemo(
    () =>
      validateCatchReportForm({
        initialReport,
        baseId,
        locationId,
        fishId,
        baitId,
        weightGrams,
        holeDepthMeters,
        spotPositionRaw,
        userNoteRaw,
        spinningSize,
        spinningSpeed,
        fishingMethod,
        baseSelection,
        catalogReady: catalog.kind === 'ready',
      }),
    [
      initialReport,
      baseId,
      locationId,
      fishId,
      baitId,
      weightGrams,
      holeDepthMeters,
      spotPositionRaw,
      userNoteRaw,
      spinningSize,
      spinningSpeed,
      fishingMethod,
      baseSelection,
      catalog.kind,
    ],
  );
  const blockingFields = useMemo(
    () => formErrorsToDraftFields(validation.errors, fishingMethod),
    [validation.errors, fishingMethod],
  );
  const createInput = useMemo<CreateCatchReportInput | null>(() => {
    const { parsedWeight, parsedDepth, parsedPosition, parsedComment } = validation;
    if (
      initialReport !== undefined ||
      !validation.canConfirm ||
      fishingMethod === null ||
      parsedWeight === undefined ||
      parsedDepth === undefined ||
      parsedPosition === undefined ||
      parsedComment === undefined
    ) {
      return null;
    }

    return {
      locationId,
      fishId,
      baitId,
      weightGrams: parsedWeight,
      holeDepthCm: parsedDepth,
      spotPositionRaw: parsedPosition,
      fishingNote: fishingNote || null,
      spinningSize: fishingMethod === 'SPINNING' ? spinningSize || null : null,
      spinningSpeed: fishingMethod === 'SPINNING' ? spinningSpeed || null : null,
      userNoteRaw: parsedComment,
      ...(initialDraft ? { rawSourceText: initialDraft.rawSourceText } : {}),
    };
  }, [
    baitId,
    fishingMethod,
    fishingNote,
    fishId,
    initialDraft,
    initialReport,
    locationId,
    spinningSize,
    spinningSpeed,
    validation,
  ]);

  useEffect(() => {
    onValidationStateChange?.({
      canConfirm: validation.canConfirm,
      blockingFields,
      fishingMethod,
    });
  }, [blockingFields, fishingMethod, onValidationStateChange, validation.canConfirm]);

  useEffect(() => {
    onCreateInputChange?.(createInput);
  }, [createInput, onCreateInputChange]);

  function clearError(field: FormField) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  function changeBait(nextBaitId: string) {
    setBaitId(nextBaitId);
    clearError('baitId');
    const nextBait = baitOptions.find((bait) => bait.id === nextBaitId);
    const nextMethod =
      initialReport && nextBaitId === initialReport.bait.id
        ? initialReport.fishingMethod
        : nextBait?.type
          ? baitTypeToFishingMethod(nextBait.type)
          : null;
    if (nextMethod === 'BAIT_FISHING') {
      setSpinningSize('');
      setSpinningSpeed('');
      clearError('spinningSize');
      clearError('spinningSpeed');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (embeddedBatchRow) return;
    if (isSubmitting || catalog.kind !== 'ready' || !canSave) return;

    setErrors(validation.errors);
    setFormError(null);
    const { parsedWeight, parsedDepth, parsedPosition, parsedComment } = validation;
    if (
      !validation.canConfirm ||
      !fishingMethod ||
      parsedWeight === undefined ||
      parsedDepth === undefined ||
      parsedPosition === undefined ||
      parsedComment === undefined
    ) {
      return;
    }

    const observation = {
      locationId,
      fishId,
      baitId,
      weightGrams: parsedWeight,
      holeDepthCm: parsedDepth,
      spotPositionRaw: parsedPosition,
      fishingNote: fishingNote || null,
      spinningSize: fishingMethod === 'SPINNING' ? spinningSize || null : null,
      spinningSpeed: fishingMethod === 'SPINNING' ? spinningSpeed || null : null,
      userNoteRaw: parsedComment,
    };

    setIsSubmitting(true);
    try {
      const report = initialReport
        ? await saveUpdate({ initialReport, ...observation })
        : await createCatchReport({
            ...observation,
            ...(initialDraft ? { rawSourceText: initialDraft.rawSourceText } : {}),
          });
      router.push(`/catches/${report.id}`);
      router.refresh();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      applyServerFieldErrors(error, setErrors);
      setFormError(catchReportMutationError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (catalog.kind === 'loading') {
    return (
      <p className={styles.message} aria-live="polite">
        Загружаем активный игровой каталог…
      </p>
    );
  }
  if (catalog.kind === 'error') {
    return (
      <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
        <p>{catalog.message}</p>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={() => {
            if (sharedCatalog === null) {
              setLocalCatalog({ kind: 'loading' });
              setCatalogAttempt((current) => current + 1);
            } else {
              sharedCatalog.reload();
            }
          }}
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>
        {initialDraft ? 'Проверьте и дополните данные' : 'Данные улова'}
      </h2>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.formGrid}>
          <ComboboxField label="Рыболовная база" id={fieldIds.base} required error={errors.baseId}>
            <SearchableCombobox
              id={fieldIds.base}
              options={baseOptions}
              value={baseId}
              onChange={(nextBaseId) => {
                if (nextBaseId !== baseId) {
                  setBaseId(nextBaseId);
                  setLocationId('');
                  setFishId('');
                  setBaseState(null);
                  clearError('baseId');
                  clearError('locationId');
                  clearError('fishId');
                }
              }}
              placeholder="Найти базу"
              invalid={Boolean(errors.baseId)}
              required
              describedBy={errors.baseId ? `${fieldIds.base}-error` : undefined}
            />
            <p className={styles.fieldHint}>
              База нужна для выбора локации и рыбы; в API не отправляется.
            </p>
          </ComboboxField>

          <ComboboxField label="Локация" id={fieldIds.location} required error={errors.locationId}>
            <SearchableCombobox
              id={fieldIds.location}
              options={locationOptions}
              value={locationId}
              onChange={(value) => {
                setLocationId(value);
                clearError('locationId');
              }}
              placeholder={!baseId ? 'Сначала выберите базу' : 'Найти локацию'}
              disabled={!baseId || baseSelection?.kind === 'error'}
              loading={Boolean(baseId && baseSelection === null)}
              invalid={Boolean(errors.locationId)}
              required
              describedBy={errors.locationId ? `${fieldIds.location}-error` : undefined}
            />
            {baseSelection?.kind === 'error' ? (
              <p className={styles.fieldError}>{baseSelection.message}</p>
            ) : null}
            {baseSelection?.kind === 'historical' ? (
              <p className={styles.historicalHint}>
                База сейчас неактивна; историческая локация сохранена.
              </p>
            ) : null}
          </ComboboxField>

          <ComboboxField label="Рыба" id={fieldIds.fish} required error={errors.fishId}>
            <SearchableCombobox
              id={fieldIds.fish}
              options={fishOptions}
              value={fishId}
              onChange={(value) => {
                setFishId(value);
                clearError('fishId');
              }}
              placeholder={!baseId ? 'Сначала выберите базу' : 'Найти рыбу'}
              disabled={!baseId || baseSelection?.kind === 'error'}
              loading={Boolean(baseId && baseSelection === null)}
              invalid={Boolean(errors.fishId)}
              required
              describedBy={errors.fishId ? `${fieldIds.fish}-error` : undefined}
            />
            <p className={styles.fieldHint}>
              Список рыб зависит от базы, а не от отдельной локации.
            </p>
          </ComboboxField>

          <ComboboxField
            label="Наживка или приманка"
            id={fieldIds.bait}
            required
            error={errors.baitId}
          >
            <SearchableCombobox
              id={fieldIds.bait}
              options={baitOptions}
              value={baitId}
              onChange={changeBait}
              placeholder="Найти наживку или приманку"
              invalid={Boolean(errors.baitId)}
              required
              describedBy={errors.baitId ? `${fieldIds.bait}-error` : undefined}
            />
          </ComboboxField>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldIds.weight}>
              Вес, граммы <Required />
            </label>
            <input
              className={`${styles.input} ${errors.weightGrams ? styles.invalidInput : ''}`}
              id={fieldIds.weight}
              type="text"
              inputMode="numeric"
              value={weightGrams}
              onChange={(event) => {
                setWeightGrams(event.target.value);
                clearError('weightGrams');
              }}
              aria-invalid={errors.weightGrams ? 'true' : undefined}
              autoComplete="off"
              required
            />
            <p className={styles.fieldHint}>Только целое положительное число.</p>
            <FieldError value={errors.weightGrams} />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Способ ловли</span>
            <p className={styles.readonlyValue}>
              {fishingMethod
                ? fishingMethodLabel(fishingMethod)
                : 'Определится после выбора наживки'}
            </p>
            <p className={styles.fieldHint}>Сервер выводит способ из выбранной наживки.</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldIds.depth}>
              Глубина ямки, метры
            </label>
            <input
              className={`${styles.input} ${errors.holeDepthCm ? styles.invalidInput : ''}`}
              id={fieldIds.depth}
              type="text"
              inputMode="decimal"
              value={holeDepthMeters}
              onChange={(event) => {
                setHoleDepthMeters(event.target.value);
                clearError('holeDepthCm');
              }}
              placeholder="Например, 7,63"
              aria-invalid={errors.holeDepthCm ? 'true' : undefined}
              autoComplete="off"
            />
            <p className={styles.fieldHint}>Необязательное наблюдение.</p>
            <FieldError value={errors.holeDepthCm} />
          </div>

          {fishingMethod === 'SPINNING' ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={fieldIds.spinningSize}>
                  Размер
                </label>
                <select
                  className={`${styles.select} ${errors.spinningSize ? styles.invalidInput : ''}`}
                  id={fieldIds.spinningSize}
                  value={spinningSize}
                  onChange={(event) => {
                    setSpinningSize(event.target.value as SpinningSize | '');
                    clearError('spinningSize');
                  }}
                >
                  <option value="">Выберите размер</option>
                  {SPINNING_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError value={errors.spinningSize} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={fieldIds.spinningSpeed}>
                  Скорость проводки
                </label>
                <select
                  className={`${styles.select} ${errors.spinningSpeed ? styles.invalidInput : ''}`}
                  id={fieldIds.spinningSpeed}
                  value={spinningSpeed}
                  onChange={(event) => {
                    setSpinningSpeed(event.target.value as SpinningSpeed | '');
                    clearError('spinningSpeed');
                  }}
                >
                  <option value="">Выберите скорость</option>
                  {SPINNING_SPEED_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError value={errors.spinningSpeed} />
              </div>
            </>
          ) : null}

          <div className={styles.fieldWide}>
            <label className={styles.label} htmlFor={fieldIds.position}>
              Позиция на экране
            </label>
            <input
              className={`${styles.input} ${errors.spotPositionRaw ? styles.invalidInput : ''}`}
              id={fieldIds.position}
              list={fieldIds.positionSuggestions}
              value={spotPositionRaw}
              onChange={(event) => {
                setSpotPositionRaw(event.target.value);
                clearError('spotPositionRaw');
              }}
              aria-invalid={errors.spotPositionRaw ? 'true' : undefined}
              placeholder="Например: уда-леска надпись нахлыст"
            />
            <datalist id={fieldIds.positionSuggestions}>
              {catalog.screenAnchors.map((anchor) => (
                <option key={anchor.id} value={anchor.name} />
              ))}
            </datalist>
            <p className={styles.fieldHint}>
              Сохраняется точно: можно указать несколько ориентиров и свои слова.
            </p>
            <FieldError value={errors.spotPositionRaw} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={fieldIds.fishingNote}>
              Условие ловли
            </label>
            <select
              className={styles.select}
              id={fieldIds.fishingNote}
              value={fishingNote}
              onChange={(event) => {
                setFishingNote(event.target.value as FishingNote | '');
                clearError('fishingNote');
              }}
            >
              <option value="">Не указано</option>
              {FISHING_NOTE_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className={styles.fieldHint}>Например, «вполводы»; не часть идентичности ямки.</p>
          </div>

          <div className={styles.fieldWide}>
            <label className={styles.label} htmlFor={fieldIds.comment}>
              Комментарий
            </label>
            <textarea
              className={`${styles.textarea} ${errors.userNoteRaw ? styles.invalidInput : ''}`}
              id={fieldIds.comment}
              value={userNoteRaw}
              onChange={(event) => {
                setUserNoteRaw(event.target.value);
                clearError('userNoteRaw');
              }}
              aria-invalid={errors.userNoteRaw ? 'true' : undefined}
              placeholder="Ваш осознанный публичный комментарий"
            />
            <p className={styles.fieldHint}>
              Комментарий будет виден всем. Нераспознанные фрагменты не попадают сюда автоматически.
            </p>
            <FieldError value={errors.userNoteRaw} />
          </div>

          {initialReport &&
          'rawSourceText' in initialReport &&
          initialReport.rawSourceText !== null ? (
            <div className={styles.fieldWide}>
              <label className={styles.label} htmlFor={fieldIds.originalSource}>
                Исходная запись (только для вас)
              </label>
              <textarea
                className={styles.textarea}
                id={fieldIds.originalSource}
                value={initialReport.rawSourceText}
                readOnly
              />
              <p className={styles.fieldHint}>Исходник не публикуется и не изменяется.</p>
            </div>
          ) : null}
        </div>

        {!canSave ? (
          <p className={`${styles.message} ${styles.warningMessage}`}>
            Вы можете проверить и исправить черновик, но сохранение заблокировано.
          </p>
        ) : null}
        {!embeddedBatchRow ? (
          <div className={styles.formActions}>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={isSubmitting || !canSave || !validation.canConfirm}
            >
              {isSubmitting
                ? isEdit
                  ? 'Сохраняем…'
                  : 'Публикуем…'
                : isEdit
                  ? 'Сохранить изменения'
                  : initialDraft
                    ? 'Подтвердить и опубликовать'
                    : 'Опубликовать улов'}
            </button>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function ComboboxField({
  label,
  id,
  required,
  error,
  children,
}: {
  label: string;
  id: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label} {required ? <Required /> : null}
      </label>
      {children}
      <FieldError id={`${id}-error`} value={error} />
    </div>
  );
}

function Required() {
  return <span className={styles.required}>*</span>;
}
function FieldError({ id, value }: { id?: string; value?: string }) {
  return value ? (
    <p className={styles.fieldError} id={id}>
      {value}
    </p>
  ) : null;
}

function resolvedDraftValue<T>(field: DraftField<T> | undefined): T | null {
  return field?.status === 'RESOLVED' ? field.value : null;
}

function validateCatchReportForm(input: {
  initialReport?: CatchReport | OwnerCatchReport;
  baseId: string;
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: string;
  holeDepthMeters: string;
  spotPositionRaw: string;
  userNoteRaw: string;
  spinningSize: SpinningSize | '';
  spinningSpeed: SpinningSpeed | '';
  fishingMethod: FishingMethod | null;
  baseSelection: SelectionState | null;
  catalogReady: boolean;
}): FormValidation {
  const errors: FormErrors = {};
  if (!input.baseId) errors.baseId = 'Выберите рыболовную базу.';
  if (!input.locationId) errors.locationId = 'Выберите локацию.';
  if (!input.fishId) errors.fishId = 'Выберите рыбу.';
  if (!input.baitId || !input.fishingMethod) {
    errors.baitId = 'Выберите наживку или приманку.';
  }

  if (input.baseSelection?.kind === 'error') {
    errors.baseId = 'Не удалось проверить выбранную базу.';
  }

  const unchangedHistoricalReferences = Boolean(
    input.initialReport &&
    input.baseId === input.initialReport.fishingBase.id &&
    input.locationId === input.initialReport.location.id &&
    input.fishId === input.initialReport.fish.id,
  );
  if (input.baseSelection?.kind === 'ready') {
    if (
      input.locationId &&
      !input.baseSelection.data.locations.some((location) => location.id === input.locationId) &&
      !unchangedHistoricalReferences
    ) {
      errors.locationId = 'Выбранная локация не относится к этой базе.';
    }
    if (
      input.fishId &&
      !input.baseSelection.data.fish.some((fish) => fish.id === input.fishId) &&
      !unchangedHistoricalReferences
    ) {
      errors.fishId = 'Выбранная рыба не связана с этой базой.';
    }
  }

  let parsedWeight: number | undefined;
  let parsedDepth: number | null | undefined;
  let parsedPosition: string | null | undefined;
  let parsedComment: string | null | undefined;
  try {
    parsedWeight = parseWeightGrams(input.weightGrams);
  } catch (error) {
    errors.weightGrams = errorMessage(error, 'Некорректный вес.');
  }
  try {
    parsedDepth = parseMetersToCentimeters(input.holeDepthMeters);
  } catch (error) {
    errors.holeDepthCm = errorMessage(error, 'Некорректная глубина.');
  }
  try {
    parsedPosition = normalizeSpotPositionRaw(input.spotPositionRaw);
  } catch (error) {
    errors.spotPositionRaw = errorMessage(error, 'Некорректная позиция.');
  }
  try {
    parsedComment = normalizeUserNoteRaw(input.userNoteRaw);
  } catch (error) {
    errors.userNoteRaw = errorMessage(error, 'Некорректный комментарий.');
  }

  const catalogPending =
    !input.catalogReady || Boolean(input.baseId && input.baseSelection === null);
  const canConfirm =
    !catalogPending &&
    Object.keys(errors).length === 0 &&
    parsedWeight !== undefined &&
    parsedDepth !== undefined &&
    parsedPosition !== undefined &&
    parsedComment !== undefined &&
    input.fishingMethod !== null;

  return {
    errors,
    parsedWeight,
    parsedDepth,
    parsedPosition,
    parsedComment,
    canConfirm,
  };
}

function formErrorsToDraftFields(
  errors: FormErrors,
  fishingMethod: FishingMethod | null,
): Array<keyof CatchReportDraft['fields']> {
  const fields = new Set<keyof CatchReportDraft['fields']>();
  const mapping: Partial<Record<FormField, keyof CatchReportDraft['fields']>> = {
    baseId: 'fishingBase',
    locationId: 'location',
    fishId: 'fish',
    baitId: 'bait',
    weightGrams: 'weightGrams',
    holeDepthCm: 'holeDepthCm',
    spotPositionRaw: 'spotPositionRaw',
    fishingNote: 'fishingNote',
    spinningSize: 'spinningSize',
    spinningSpeed: 'spinningSpeed',
    userNoteRaw: 'userNoteRaw',
  };
  for (const field of Object.keys(errors) as FormField[]) {
    const draftField = mapping[field];
    if (draftField) fields.add(draftField);
  }
  if (errors.baitId || fishingMethod === null) fields.add('fishingMethod');
  return [...fields].sort();
}

function withHistoricalOption(
  activeItems: readonly PublicCatalogItem[],
  historical?: PublicCatalogItem,
): CatalogOption[] {
  const items: CatalogOption[] = activeItems.map((item) => ({ ...item }));
  if (historical && !items.some((item) => item.id === historical.id))
    items.unshift({ ...historical, historical: true });
  return items;
}

function withHistoricalBait(
  activeItems: readonly BaitOption[],
  historical?: BaitOption,
): BaitOption[] {
  const items = activeItems.map((item) => ({ ...item }));
  if (historical && !items.some((item) => item.id === historical.id))
    items.unshift({ ...historical, historical: true });
  return items;
}

function resolveFishingMethod(input: {
  initialReport?: CatchReport;
  initialDraft?: CatchReportDraft;
  baitId: string;
  baitOptions: readonly BaitOption[];
}): FishingMethod | null {
  if (input.initialReport && input.baitId === input.initialReport.bait.id)
    return input.initialReport.fishingMethod;
  const bait = input.baitOptions.find((option) => option.id === input.baitId);
  if (bait?.type) return baitTypeToFishingMethod(bait.type);
  if (
    input.initialDraft &&
    resolvedDraftValue<{ id: string }>(input.initialDraft.fields.bait)?.id === input.baitId
  )
    return resolvedDraftValue<FishingMethod>(input.initialDraft.fields.fishingMethod);
  return null;
}

async function saveUpdate(input: {
  initialReport: CatchReport;
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  holeDepthCm: number | null;
  spotPositionRaw: string | null;
  fishingNote: FishingNote | null;
  spinningSize: SpinningSize | null;
  spinningSpeed: SpinningSpeed | null;
  userNoteRaw: string | null;
}): Promise<CatchReport> {
  const update: UpdateCatchReportInput = {};
  const comparisons: Array<[keyof UpdateCatchReportInput, unknown, unknown]> = [
    ['locationId', input.locationId, input.initialReport.location.id],
    ['fishId', input.fishId, input.initialReport.fish.id],
    ['baitId', input.baitId, input.initialReport.bait.id],
    ['weightGrams', input.weightGrams, input.initialReport.weightGrams],
    ['holeDepthCm', input.holeDepthCm, input.initialReport.holeDepthCm],
    ['spotPositionRaw', input.spotPositionRaw, input.initialReport.spotPositionRaw],
    ['fishingNote', input.fishingNote, input.initialReport.fishingNote],
    ['spinningSize', input.spinningSize, input.initialReport.spinningSize],
    ['spinningSpeed', input.spinningSpeed, input.initialReport.spinningSpeed],
    ['userNoteRaw', input.userNoteRaw, input.initialReport.userNoteRaw],
  ];
  for (const [field, value, original] of comparisons) {
    if (value !== original) Object.assign(update, { [field]: value });
  }
  if (Object.keys(update).length === 0) throw new Error('Нет изменений для сохранения.');
  return updateCatchReport(input.initialReport.id, update);
}

function applyServerFieldErrors(
  error: unknown,
  setErrors: (updater: (current: FormErrors) => FormErrors) => void,
) {
  if (!isApiError(error)) return;
  setErrors((current) => {
    const next = { ...current };
    for (const field of [
      'locationId',
      'fishId',
      'baitId',
      'weightGrams',
      'holeDepthCm',
      'spotPositionRaw',
      'fishingNote',
      'spinningSize',
      'spinningSpeed',
      'userNoteRaw',
    ] as const) {
      next[field] = error.fieldErrors[field]?.[0] ?? next[field];
    }
    return next;
  });
}

function catchReportMutationError(error: unknown): string {
  if (
    error instanceof Error &&
    !isApiError(error) &&
    error.message === 'Нет изменений для сохранения.'
  )
    return error.message;
  if (isApiError(error)) {
    const messages: Record<string, string> = {
      ACCOUNT_BANNED: 'Аккаунт заблокирован. Изменение публичных уловов недоступно.',
      CATCH_REPORT_NOT_OWNED: 'Этот отчёт принадлежит другому пользователю.',
      CATCH_REPORT_NOT_FOUND: 'Отчёт больше не существует.',
      FISH_NOT_AVAILABLE_AT_FISHING_BASE: 'Выбранная рыба не связана с этой базой.',
      CATCH_REPORT_OBSERVATION_INVALID:
        'Проверьте совместимость наблюдений с выбранным способом ловли.',
    };
    if (error.code && messages[error.code]) return messages[error.code];
  }
  return getApiErrorMessage(error, 'Не удалось сохранить отчёт. Попробуйте ещё раз.');
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
