'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import styles from '../../catch-reports.module.css';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import {
  type CatchReport,
  createCatchReport,
  type FishingNote,
  type SpotLandmark,
  type UpdateCatchReportInput,
  updateCatchReport,
} from '@/lib/catch-reports-api';
import {
  FISHING_NOTE_OPTIONS,
  formatCentimetersAsMeters,
  normalizeUserNoteRaw,
  parseMetersToCentimeters,
  parseWeightGrams,
  SPOT_LANDMARK_OPTIONS,
} from '@/lib/catch-report-form';
import {
  getFishingBase,
  getLocation,
  listBaits,
  listFishingBases,
  type PublicBait,
  type PublicCatalogItem,
  type PublicFishingBase,
  type PublicLocation,
} from '@/lib/catalog-api';

type CatchReportFormProps = {
  initialReport?: CatchReport;
};

type CatalogState =
  | { kind: 'loading' }
  | { kind: 'ready'; bases: PublicCatalogItem[]; baits: PublicBait[] }
  | { kind: 'error'; message: string };

type SelectionState<T> =
  | { kind: 'ready'; key: string; data: T }
  | { kind: 'historical'; key: string }
  | { kind: 'error'; key: string; message: string };

type FormErrors = Partial<
  Record<
    | 'baseId'
    | 'locationId'
    | 'fishId'
    | 'baitId'
    | 'weightGrams'
    | 'holeDepthCm'
    | 'spotLandmark'
    | 'fishingNote'
    | 'userNoteRaw',
    string
  >
>;

type SelectOption = PublicCatalogItem & {
  historical?: boolean;
};

export function CatchReportForm({ initialReport }: CatchReportFormProps) {
  const router = useRouter();
  const isEdit = initialReport !== undefined;
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [catalog, setCatalog] = useState<CatalogState>({ kind: 'loading' });

  const [baseId, setBaseId] = useState(initialReport?.fishingBase.id ?? '');
  const [locationId, setLocationId] = useState(initialReport?.location.id ?? '');
  const [fishId, setFishId] = useState(initialReport?.fish.id ?? '');
  const [baitId, setBaitId] = useState(initialReport?.bait.id ?? '');
  const [weightGrams, setWeightGrams] = useState(
    initialReport ? String(initialReport.weightGrams) : '',
  );
  const [holeDepthMeters, setHoleDepthMeters] = useState(
    initialReport?.holeDepthCm === null || initialReport === undefined
      ? ''
      : formatCentimetersAsMeters(initialReport.holeDepthCm),
  );
  const [spotLandmark, setSpotLandmark] = useState<SpotLandmark | ''>(
    initialReport?.spotLandmark ?? '',
  );
  const [fishingNote, setFishingNote] = useState<FishingNote | ''>(
    initialReport?.fishingNote ?? '',
  );
  const [userNoteRaw, setUserNoteRaw] = useState(initialReport?.userNoteRaw ?? '');

  const [baseState, setBaseState] = useState<SelectionState<PublicFishingBase> | null>(null);
  const [locationState, setLocationState] = useState<SelectionState<PublicLocation> | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      try {
        const [bases, baits] = await Promise.all([
          listFishingBases(controller.signal),
          listBaits(controller.signal),
        ]);
        setCatalog({ kind: 'ready', bases, baits });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setCatalog({
          kind: 'error',
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить активные базы и наживки. Попробуйте ещё раз.',
          ),
        });
      }
    }

    void loadCatalog();
    return () => controller.abort();
  }, [catalogAttempt]);

  const baseRequestKey = `${baseId}:${catalogAttempt}`;

  useEffect(() => {
    if (!baseId || catalog.kind !== 'ready') {
      return;
    }

    const controller = new AbortController();
    const requestKey = `${baseId}:${catalogAttempt}`;

    async function loadBase() {
      try {
        const base = await getFishingBase(baseId, controller.signal);
        setBaseState({ kind: 'ready', key: requestKey, data: base });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (isApiError(error) && error.status === 404 && initialReport?.fishingBase.id === baseId) {
          setBaseState({ kind: 'historical', key: requestKey });
          return;
        }

        setBaseState({
          kind: 'error',
          key: requestKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить локации выбранной базы. Выберите базу заново.',
          ),
        });
      }
    }

    void loadBase();
    return () => controller.abort();
  }, [baseId, catalog.kind, catalogAttempt, initialReport]);

  const locationRequestKey = `${locationId}:${catalogAttempt}`;

  useEffect(() => {
    if (!locationId || catalog.kind !== 'ready') {
      return;
    }

    const controller = new AbortController();
    const requestKey = `${locationId}:${catalogAttempt}`;

    async function loadSelectedLocation() {
      try {
        const location = await getLocation(locationId, controller.signal);
        setLocationState({ kind: 'ready', key: requestKey, data: location });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (
          isApiError(error) &&
          error.status === 404 &&
          initialReport?.location.id === locationId
        ) {
          setLocationState({ kind: 'historical', key: requestKey });
          return;
        }

        setLocationState({
          kind: 'error',
          key: requestKey,
          message: getApiErrorMessage(
            error,
            'Не удалось загрузить рыб выбранной локации. Выберите локацию заново.',
          ),
        });
      }
    }

    void loadSelectedLocation();
    return () => controller.abort();
  }, [locationId, catalog.kind, catalogAttempt, initialReport]);

  const baseOptions = useMemo<SelectOption[]>(() => {
    if (catalog.kind !== 'ready') {
      return [];
    }

    return withHistoricalOption(
      catalog.bases,
      initialReport
        ? { id: initialReport.fishingBase.id, name: initialReport.fishingBase.name }
        : undefined,
    );
  }, [catalog, initialReport]);

  const locationOptions = useMemo<SelectOption[]>(() => {
    const activeLocations =
      baseState?.key === baseRequestKey && baseState.kind === 'ready'
        ? baseState.data.locations.map((location) => ({
            id: location.id,
            name: `${location.number}. ${location.name}`,
          }))
        : [];
    const historicalLocation =
      initialReport?.fishingBase.id === baseId
        ? {
            id: initialReport.location.id,
            name: `${initialReport.location.number}. ${initialReport.location.name}`,
          }
        : undefined;

    return withHistoricalOption(activeLocations, historicalLocation);
  }, [baseId, baseRequestKey, baseState, initialReport]);

  const fishOptions = useMemo<SelectOption[]>(() => {
    const activeFish =
      locationState?.key === locationRequestKey && locationState.kind === 'ready'
        ? locationState.data.fish
        : [];
    const historicalFish =
      initialReport?.location.id === locationId
        ? { id: initialReport.fish.id, name: initialReport.fish.name }
        : undefined;

    return withHistoricalOption(activeFish, historicalFish);
  }, [initialReport, locationId, locationRequestKey, locationState]);

  const baitOptions = useMemo<SelectOption[]>(() => {
    if (catalog.kind !== 'ready') {
      return [];
    }

    return withHistoricalOption(
      catalog.baits,
      initialReport ? { id: initialReport.bait.id, name: initialReport.bait.name } : undefined,
    );
  }, [catalog, initialReport]);

  function clearError(field: keyof FormErrors) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  function retryCatalog() {
    setCatalog({ kind: 'loading' });
    setFormError(null);
    setCatalogAttempt((current) => current + 1);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || catalog.kind !== 'ready') {
      return;
    }

    const nextErrors: FormErrors = {};
    let parsedWeight: number | undefined;
    let parsedDepth: number | null | undefined;
    let parsedRawNote: string | null | undefined;

    if (!baseId) {
      nextErrors.baseId = 'Выберите рыболовную базу.';
    }

    if (!locationId) {
      nextErrors.locationId = 'Выберите локацию.';
    }

    if (!fishId) {
      nextErrors.fishId = 'Выберите рыбу.';
    }

    if (!baitId) {
      nextErrors.baitId = 'Выберите наживку или приманку.';
    }

    try {
      parsedWeight = parseWeightGrams(weightGrams);
    } catch (error) {
      nextErrors.weightGrams = error instanceof Error ? error.message : 'Некорректный вес.';
    }

    try {
      parsedDepth = parseMetersToCentimeters(holeDepthMeters);
    } catch (error) {
      nextErrors.holeDepthCm = error instanceof Error ? error.message : 'Некорректная глубина.';
    }

    try {
      parsedRawNote = normalizeUserNoteRaw(userNoteRaw);
    } catch (error) {
      nextErrors.userNoteRaw = error instanceof Error ? error.message : 'Некорректная заметка.';
    }

    setErrors(nextErrors);
    setFormError(null);

    if (
      Object.keys(nextErrors).length > 0 ||
      parsedWeight === undefined ||
      parsedDepth === undefined ||
      parsedRawNote === undefined
    ) {
      return;
    }

    setIsSubmitting(true);

    try {
      const report = isEdit
        ? await saveUpdate({
            initialReport,
            locationId,
            fishId,
            baitId,
            weightGrams: parsedWeight,
            holeDepthCm: parsedDepth,
            spotLandmark: spotLandmark || null,
            fishingNote: fishingNote || null,
            userNoteRaw: parsedRawNote,
          })
        : await createCatchReport({
            locationId,
            fishId,
            baitId,
            weightGrams: parsedWeight,
            holeDepthCm: parsedDepth,
            spotLandmark: spotLandmark || null,
            fishingNote: fishingNote || null,
            userNoteRaw: parsedRawNote,
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
        <button className={styles.secondaryButton} type="button" onClick={retryCatalog}>
          Повторить
        </button>
      </div>
    );
  }

  const baseSelection = baseState?.key === baseRequestKey ? baseState : null;
  const locationSelection = locationState?.key === locationRequestKey ? locationState : null;

  return (
    <section className={styles.panel}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}

        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-base">
              Рыболовная база <span className={styles.required}>*</span>
            </label>
            <select
              className={`${styles.select} ${errors.baseId ? styles.invalidInput : ''}`}
              id="catch-base"
              value={baseId}
              onChange={(event) => {
                setBaseId(event.target.value);
                setLocationId('');
                setFishId('');
                clearError('baseId');
                clearError('locationId');
                clearError('fishId');
              }}
              aria-invalid={errors.baseId ? 'true' : undefined}
              required
            >
              <option value="">Выберите базу</option>
              {baseOptions.map((base) => (
                <option value={base.id} key={base.id}>
                  {base.name}
                  {base.historical ? ' (текущее историческое значение)' : ''}
                </option>
              ))}
            </select>
            <p className={styles.fieldHint}>
              База нужна для выбора локации и не отправляется в API.
            </p>
            {errors.baseId ? <p className={styles.fieldError}>{errors.baseId}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-location">
              Локация <span className={styles.required}>*</span>
            </label>
            <select
              className={`${styles.select} ${errors.locationId ? styles.invalidInput : ''}`}
              id="catch-location"
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setFishId('');
                clearError('locationId');
                clearError('fishId');
              }}
              disabled={!baseId || (baseSelection !== null && baseSelection.kind === 'error')}
              aria-invalid={errors.locationId ? 'true' : undefined}
              required
            >
              <option value="">
                {!baseId
                  ? 'Сначала выберите базу'
                  : baseSelection === null
                    ? 'Загружаем локации…'
                    : 'Выберите локацию'}
              </option>
              {locationOptions.map((location) => (
                <option value={location.id} key={location.id}>
                  {location.name}
                  {location.historical ? ' (текущее историческое значение)' : ''}
                </option>
              ))}
            </select>
            {baseSelection?.kind === 'error' ? (
              <p className={styles.fieldError}>{baseSelection.message}</p>
            ) : null}
            {baseSelection?.kind === 'historical' ? (
              <p className={styles.historicalHint}>
                База сейчас неактивна. Текущая историческая локация сохранена в форме.
              </p>
            ) : null}
            {errors.locationId ? <p className={styles.fieldError}>{errors.locationId}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-fish">
              Рыба <span className={styles.required}>*</span>
            </label>
            <select
              className={`${styles.select} ${errors.fishId ? styles.invalidInput : ''}`}
              id="catch-fish"
              value={fishId}
              onChange={(event) => {
                setFishId(event.target.value);
                clearError('fishId');
              }}
              disabled={
                !locationId || (locationSelection !== null && locationSelection.kind === 'error')
              }
              aria-invalid={errors.fishId ? 'true' : undefined}
              required
            >
              <option value="">
                {!locationId
                  ? 'Сначала выберите локацию'
                  : locationSelection === null
                    ? 'Загружаем рыб…'
                    : 'Выберите рыбу'}
              </option>
              {fishOptions.map((fish) => (
                <option value={fish.id} key={fish.id}>
                  {fish.name}
                  {fish.historical ? ' (текущее историческое значение)' : ''}
                </option>
              ))}
            </select>
            {locationSelection?.kind === 'error' ? (
              <p className={styles.fieldError}>{locationSelection.message}</p>
            ) : null}
            {locationSelection?.kind === 'historical' ? (
              <p className={styles.historicalHint}>
                Локация сейчас неактивна. Текущая историческая рыба сохранена в форме.
              </p>
            ) : null}
            {errors.fishId ? <p className={styles.fieldError}>{errors.fishId}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-bait">
              Наживка или приманка <span className={styles.required}>*</span>
            </label>
            <select
              className={`${styles.select} ${errors.baitId ? styles.invalidInput : ''}`}
              id="catch-bait"
              value={baitId}
              onChange={(event) => {
                setBaitId(event.target.value);
                clearError('baitId');
              }}
              aria-invalid={errors.baitId ? 'true' : undefined}
              required
            >
              <option value="">Выберите наживку или приманку</option>
              {baitOptions.map((bait) => (
                <option value={bait.id} key={bait.id}>
                  {bait.name}
                  {bait.historical ? ' (текущее историческое значение)' : ''}
                </option>
              ))}
            </select>
            {errors.baitId ? <p className={styles.fieldError}>{errors.baitId}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-weight">
              Вес, граммы <span className={styles.required}>*</span>
            </label>
            <input
              className={`${styles.input} ${errors.weightGrams ? styles.invalidInput : ''}`}
              id="catch-weight"
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
            {errors.weightGrams ? <p className={styles.fieldError}>{errors.weightGrams}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-depth">
              Глубина ямки, метры
            </label>
            <input
              className={`${styles.input} ${errors.holeDepthCm ? styles.invalidInput : ''}`}
              id="catch-depth"
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
            <p className={styles.fieldHint}>До двух знаков после запятой; пусто — неизвестно.</p>
            {errors.holeDepthCm ? <p className={styles.fieldError}>{errors.holeDepthCm}</p> : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-landmark">
              Ориентир
            </label>
            <select
              className={styles.select}
              id="catch-landmark"
              value={spotLandmark}
              onChange={(event) => {
                setSpotLandmark(event.target.value as SpotLandmark | '');
                clearError('spotLandmark');
              }}
            >
              <option value="">Не указан</option>
              {SPOT_LANDMARK_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.spotLandmark ? (
              <p className={styles.fieldError}>{errors.spotLandmark}</p>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="catch-note-condition">
              Условие ловли
            </label>
            <select
              className={styles.select}
              id="catch-note-condition"
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
            <p className={styles.fieldHint}>Условие ловли не считается ориентиром ямки.</p>
            {errors.fishingNote ? <p className={styles.fieldError}>{errors.fishingNote}</p> : null}
          </div>

          <div className={styles.fieldWide}>
            <label className={styles.label} htmlFor="catch-raw-note">
              Исходная заметка
            </label>
            <textarea
              className={`${styles.textarea} ${errors.userNoteRaw ? styles.invalidInput : ''}`}
              id="catch-raw-note"
              value={userNoteRaw}
              onChange={(event) => {
                setUserNoteRaw(event.target.value);
                clearError('userNoteRaw');
              }}
              aria-invalid={errors.userNoteRaw ? 'true' : undefined}
              placeholder="Например: ямка 7,63 вполводы"
            />
            <p className={styles.fieldHint}>
              Текст сохраняется и публикуется без исправлений. Не указывайте приватные данные.
            </p>
            {errors.userNoteRaw ? <p className={styles.fieldError}>{errors.userNoteRaw}</p> : null}
          </div>
        </div>

        <div className={styles.formActions}>
          <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? isEdit
                ? 'Сохраняем…'
                : 'Публикуем…'
              : isEdit
                ? 'Сохранить изменения'
                : 'Опубликовать улов'}
          </button>
        </div>
      </form>
    </section>
  );
}

function withHistoricalOption(
  activeItems: ReadonlyArray<PublicCatalogItem>,
  historicalItem?: PublicCatalogItem,
): SelectOption[] {
  const items: SelectOption[] = activeItems.map((item) => ({ ...item }));

  if (historicalItem && !activeItems.some((item) => item.id === historicalItem.id)) {
    items.unshift({ ...historicalItem, historical: true });
  }

  return items;
}

async function saveUpdate(input: {
  initialReport: CatchReport;
  locationId: string;
  fishId: string;
  baitId: string;
  weightGrams: number;
  holeDepthCm: number | null;
  spotLandmark: SpotLandmark | null;
  fishingNote: FishingNote | null;
  userNoteRaw: string | null;
}): Promise<CatchReport> {
  const update: UpdateCatchReportInput = {};

  if (input.locationId !== input.initialReport.location.id) {
    update.locationId = input.locationId;
  }

  if (input.fishId !== input.initialReport.fish.id) {
    update.fishId = input.fishId;
  }

  if (input.baitId !== input.initialReport.bait.id) {
    update.baitId = input.baitId;
  }

  if (input.weightGrams !== input.initialReport.weightGrams) {
    update.weightGrams = input.weightGrams;
  }

  if (input.holeDepthCm !== input.initialReport.holeDepthCm) {
    update.holeDepthCm = input.holeDepthCm;
  }

  if (input.spotLandmark !== input.initialReport.spotLandmark) {
    update.spotLandmark = input.spotLandmark;
  }

  if (input.fishingNote !== input.initialReport.fishingNote) {
    update.fishingNote = input.fishingNote;
  }

  if (input.userNoteRaw !== input.initialReport.userNoteRaw) {
    update.userNoteRaw = input.userNoteRaw;
  }

  if (Object.keys(update).length === 0) {
    throw new Error('Нет изменений для сохранения.');
  }

  return updateCatchReport(input.initialReport.id, update);
}

function applyServerFieldErrors(
  error: unknown,
  setErrors: (updater: (current: FormErrors) => FormErrors) => void,
) {
  if (!isApiError(error)) {
    return;
  }

  setErrors((current) => ({
    ...current,
    locationId: error.fieldErrors.locationId?.[0] ?? current.locationId,
    fishId: error.fieldErrors.fishId?.[0] ?? current.fishId,
    baitId: error.fieldErrors.baitId?.[0] ?? current.baitId,
    weightGrams: error.fieldErrors.weightGrams?.[0] ?? current.weightGrams,
    holeDepthCm: error.fieldErrors.holeDepthCm?.[0] ?? current.holeDepthCm,
    spotLandmark: error.fieldErrors.spotLandmark?.[0] ?? current.spotLandmark,
    fishingNote: error.fieldErrors.fishingNote?.[0] ?? current.fishingNote,
    userNoteRaw: error.fieldErrors.userNoteRaw?.[0] ?? current.userNoteRaw,
  }));
}

function catchReportMutationError(error: unknown): string {
  if (
    error instanceof Error &&
    !isApiError(error) &&
    error.message === 'Нет изменений для сохранения.'
  ) {
    return error.message;
  }

  if (isApiError(error)) {
    const messages: Record<string, string> = {
      ACCOUNT_BANNED: 'Аккаунт заблокирован. Изменение публичных уловов недоступно.',
      CATCH_REPORT_NOT_OWNED: 'Этот отчёт принадлежит другому пользователю.',
      CATCH_REPORT_NOT_FOUND: 'Отчёт больше не существует.',
      LOCATION_NOT_FOUND: 'Выбранная локация больше не существует.',
      FISHING_BASE_INACTIVE: 'Выбранная рыболовная база сейчас неактивна.',
      LOCATION_INACTIVE: 'Выбранная локация сейчас неактивна.',
      FISH_NOT_FOUND: 'Выбранная рыба больше не существует.',
      FISH_INACTIVE: 'Выбранная рыба сейчас неактивна.',
      BAIT_NOT_FOUND: 'Выбранная наживка или приманка больше не существует.',
      BAIT_INACTIVE: 'Выбранная наживка или приманка сейчас неактивна.',
      FISH_NOT_AVAILABLE_AT_LOCATION: 'Выбранная рыба сейчас не связана с этой локацией.',
      CATCH_REPORT_REFERENCE_CONFLICT:
        'Каталог изменился во время сохранения. Обновите страницу и повторите попытку.',
    };

    if (error.code && messages[error.code]) {
      return messages[error.code];
    }
  }

  return getApiErrorMessage(error, 'Не удалось сохранить отчёт. Попробуйте ещё раз.');
}
