'use client';

import { type FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../../../../catalog.module.css';
import {
  type AdminFishingBaseFish,
  type UpdateFishingBaseFishInput,
  updateFishingBaseFish,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { filterCatalogItems } from '@/lib/catalog-search';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

type BoundResult = { value: number | null; error: null } | { value: null; error: string };

function parseBound(rawValue: string, label: string): BoundResult {
  const value = rawValue.trim();
  if (value === '') return { value: null, error: null };
  if (!/^\d+$/u.test(value)) {
    return { value: null, error: `${label} должен быть целым числом граммов.` };
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > POSTGRES_INTEGER_MAX) {
    return { value: null, error: `${label} должен быть от 1 до ${POSTGRES_INTEGER_MAX}.` };
  }

  return { value: parsed, error: null };
}

export function BaseFishWeightTable({
  baseId,
  fish,
  removingFishId,
  onRemove,
}: {
  baseId: string;
  fish: AdminFishingBaseFish[];
  removingFishId: string | null;
  onRemove: (fishId: string, fishName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visibleFish = useMemo(() => filterCatalogItems(fish, query), [fish, query]);

  if (fish.length === 0) {
    return <p className={styles.muted}>Связи с рыбами ещё не добавлены.</p>;
  }

  return (
    <>
      <div className={styles.compactSearchField}>
        <label className={styles.label} htmlFor="base-membership-search">
          Найти рыбу на базе
        </label>
        <input
          className={styles.input}
          id="base-membership-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Название рыбы"
        />
      </div>

      {visibleFish.length === 0 ? (
        <p className={styles.muted}>Связей с такой рыбой не найдено.</p>
      ) : (
        <div
          className={styles.compactTableScroll}
          role="region"
          aria-label="Весовые границы рыб базы"
          tabIndex={0}
        >
          <table className={styles.compactAdminTable}>
            <thead>
              <tr>
                <th scope="col">Рыба</th>
                <th scope="col">Статус</th>
                <th scope="col">Мин., г</th>
                <th scope="col">Макс., г</th>
                <th scope="col">Действия</th>
              </tr>
            </thead>
            <tbody>
              {visibleFish.map((item) => (
                <BaseFishWeightRow
                  baseId={baseId}
                  fish={item}
                  removingFishId={removingFishId}
                  onRemove={onRemove}
                  key={item.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function BaseFishWeightRow({
  baseId,
  fish,
  removingFishId,
  onRemove,
}: {
  baseId: string;
  fish: AdminFishingBaseFish;
  removingFishId: string | null;
  onRemove: (fishId: string, fishName: string) => void;
}) {
  const router = useRouter();
  const formId = `base-fish-weight-${fish.id}`;
  const errorId = `${formId}-error`;
  const [savedMin, setSavedMin] = useState(fish.minWeightGrams);
  const [savedMax, setSavedMax] = useState(fish.maxWeightGrams);
  const [minValue, setMinValue] = useState(fish.minWeightGrams?.toString() ?? '');
  const [maxValue, setMaxValue] = useState(fish.maxWeightGrams?.toString() ?? '');
  const [minError, setMinError] = useState<string | null>(null);
  const [maxError, setMaxError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const min = parseBound(minValue, 'Минимальный вес');
    const max = parseBound(maxValue, 'Максимальный вес');
    setMinError(min.error);
    setMaxError(max.error);
    setFormError(null);
    setSuccess(null);
    if (min.error || max.error) return;

    if (min.value !== null && max.value !== null && min.value > max.value) {
      setFormError('Минимальный вес не должен превышать максимальный.');
      return;
    }

    const update: UpdateFishingBaseFishInput = {};
    if (min.value !== savedMin) update.minWeightGrams = min.value;
    if (max.value !== savedMax) update.maxWeightGrams = max.value;
    if (Object.keys(update).length === 0) {
      setFormError('Нет изменений для сохранения.');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await updateFishingBaseFish(baseId, fish.id, update);
      setSavedMin(updated.minWeightGrams);
      setSavedMax(updated.maxWeightGrams);
      setMinValue(updated.minWeightGrams?.toString() ?? '');
      setMaxValue(updated.maxWeightGrams?.toString() ?? '');
      setSuccess('Сохранено.');
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны.');
      } else if (isApiError(error) && error.fieldErrors.minWeightGrams?.[0]) {
        setMinError(error.fieldErrors.minWeightGrams[0]);
      } else if (isApiError(error) && error.fieldErrors.maxWeightGrams?.[0]) {
        setMaxError(error.fieldErrors.maxWeightGrams[0]);
      } else if (isApiError(error) && error.fieldErrors.body?.[0]) {
        setFormError(error.fieldErrors.body[0]);
      } else {
        setFormError(getApiErrorMessage(error, 'Не удалось сохранить весовые границы.'));
      }
    } finally {
      setIsSaving(false);
    }
  }

  const describedBy = minError || maxError || formError ? errorId : undefined;

  return (
    <tr>
      <th scope="row">
        <span className={styles.compactItemName}>{fish.name}</span>
        <span className={styles.compactMetadata}>
          Связь создана: {formatDate(fish.relationCreatedAt)}
        </span>
        {minError || maxError || formError ? (
          <span className={styles.compactRowError} id={errorId} role="alert">
            {minError ?? maxError ?? formError}
          </span>
        ) : null}
        {success ? (
          <span className={styles.compactRowSuccess} role="status">
            {success}
          </span>
        ) : null}
      </th>
      <td>
        <span
          className={`${styles.status} ${fish.isActive ? styles.activeStatus : styles.inactiveStatus}`}
        >
          {fish.isActive ? 'Активна' : 'Неактивна'}
        </span>
      </td>
      <td>
        <input
          className={styles.compactNumberInput}
          aria-label={`Минимальный вес, ${fish.name}`}
          aria-invalid={minError || formError ? 'true' : undefined}
          aria-describedby={describedBy}
          form={formId}
          type="number"
          min="1"
          max={POSTGRES_INTEGER_MAX}
          step="1"
          inputMode="numeric"
          placeholder="—"
          value={minValue}
          disabled={isSaving || removingFishId !== null}
          onChange={(event) => {
            setMinValue(event.target.value);
            setMinError(null);
            setFormError(null);
            setSuccess(null);
          }}
        />
      </td>
      <td>
        <input
          className={styles.compactNumberInput}
          aria-label={`Максимальный вес, ${fish.name}`}
          aria-invalid={maxError || formError ? 'true' : undefined}
          aria-describedby={describedBy}
          form={formId}
          type="number"
          min="1"
          max={POSTGRES_INTEGER_MAX}
          step="1"
          inputMode="numeric"
          placeholder="—"
          value={maxValue}
          disabled={isSaving || removingFishId !== null}
          onChange={(event) => {
            setMaxValue(event.target.value);
            setMaxError(null);
            setFormError(null);
            setSuccess(null);
          }}
        />
      </td>
      <td>
        <form className={styles.compactActions} id={formId} onSubmit={handleSave} noValidate>
          <button
            className={styles.button}
            type="submit"
            disabled={isSaving || removingFishId !== null}
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            className={styles.dangerButton}
            type="button"
            onClick={() => onRemove(fish.id, fish.name)}
            disabled={isSaving || removingFishId !== null}
          >
            {removingFishId === fish.id ? 'Убираем…' : 'Убрать'}
          </button>
        </form>
      </td>
    </tr>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
