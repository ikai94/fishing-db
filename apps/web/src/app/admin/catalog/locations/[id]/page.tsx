'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useState } from 'react';
import styles from '../../../../catalog.module.css';
import {
  type AdminLocationDetail,
  getAdminLocation,
  type UpdateLocationInput,
  updateLocation,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { useApiResource } from '@/lib/use-api-resource';

export default function AdminLocationPage() {
  const { id: locationId } = useParams<{ id: string }>();
  const loadLocation = useCallback(
    (signal: AbortSignal) => getAdminLocation(locationId, signal),
    [locationId],
  );
  const { state, reload } = useApiResource(loadLocation, 'Не удалось загрузить локацию.');

  return (
    <>
      {state.kind === 'loading' ? (
        <p className={styles.message} aria-live="polite">
          Загружаем локацию…
        </p>
      ) : null}
      {state.kind === 'not-found' ? (
        <div className={styles.message}>
          <h1 className={styles.panelTitle}>Локация не найдена</h1>
          <Link className={styles.link} href="/admin/catalog/bases">
            Вернуться к базам
          </Link>
        </div>
      ) : null}
      {state.kind === 'error' ? (
        <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
          <p>{state.message}</p>
          <button className={styles.secondaryButton} type="button" onClick={reload}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.kind === 'ready' ? (
        <LocationEditor
          location={state.data}
          reload={reload}
          key={`${state.data.id}:${state.data.updatedAt}`}
        />
      ) : null}
    </>
  );
}

function LocationEditor({
  location,
  reload,
}: {
  location: AdminLocationDetail;
  reload: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(location.name);
  const [number, setNumber] = useState(String(location.number));
  const [isActive, setIsActive] = useState(location.isActive);
  const [nameError, setNameError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const trimmedName = name.trim();
    const parsedNumber = Number(number);
    const update: UpdateLocationInput = {};
    setNameError(null);
    setNumberError(null);
    setEditError(null);
    if (trimmedName.length === 0) setNameError('Введите название локации.');
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1)
      setNumberError('Номер должен быть целым числом не меньше 1.');
    if (trimmedName.length === 0 || !Number.isInteger(parsedNumber) || parsedNumber < 1) return;

    if (trimmedName !== location.name) update.name = trimmedName;
    if (parsedNumber !== location.number) update.number = parsedNumber;
    if (isActive !== location.isActive) update.isActive = isActive;
    if (Object.keys(update).length === 0) {
      setEditError('Нет изменений для сохранения.');
      return;
    }

    setIsSaving(true);
    try {
      await updateLocation(location.id, update);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      if (isApiError(error) && error.status === 403) {
        setEditError('Административные права недоступны.');
      } else if (isApiError(error) && error.code === 'LOCATION_NUMBER_ALREADY_EXISTS') {
        setNumberError('На этой базе уже есть локация с таким номером.');
      } else if (isApiError(error) && error.code === 'LOCATION_NAME_ALREADY_EXISTS') {
        setNameError('На этой базе уже есть локация с таким названием.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_INACTIVE') {
        setEditError('Нельзя активировать локацию, пока её база неактивна.');
      } else {
        setNameError(isApiError(error) ? (error.fieldErrors.name?.[0] ?? null) : null);
        setNumberError(isApiError(error) ? (error.fieldErrors.number?.[0] ?? null) : null);
        setEditError(getApiErrorMessage(error, 'Не удалось сохранить локацию.'));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <nav className={styles.sectionNav}>
        <Link className={styles.backLink} href={`/admin/catalog/bases/${location.fishingBase.id}`}>
          ← {location.fishingBase.name}
        </Link>
      </nav>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Локация</p>
        <h1 className={styles.title}>
          {location.number}. {location.name}
        </h1>
        <p className={styles.subtitle}>
          Рыбы управляются на странице рыболовной базы, а не в локации.
        </p>
      </header>
      {!location.fishingBase.isActive ? (
        <p className={`${styles.message} ${styles.warningMessage}`}>
          Рыболовная база неактивна. Локация скрыта публично.
        </p>
      ) : null}
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Настройки локции</h2>
        <form className={styles.form} onSubmit={handleSave} noValidate>
          {editError ? (
            <p className={styles.formError} role="alert">
              {editError}
            </p>
          ) : null}
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="edit-location-number">
                Номер
              </label>
              <input
                className={styles.input}
                id="edit-location-number"
                type="number"
                min="1"
                step="1"
                value={number}
                onChange={(event) => {
                  setNumber(event.target.value);
                  setNumberError(null);
                }}
                aria-invalid={numberError ? 'true' : undefined}
                required
              />
              {numberError ? <p className={styles.fieldError}>{numberError}</p> : null}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="edit-location-name">
                Название
              </label>
              <input
                className={styles.input}
                id="edit-location-name"
                value={name}
                maxLength={128}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
                aria-invalid={nameError ? 'true' : undefined}
                required
              />
              {nameError ? <p className={styles.fieldError}>{nameError}</p> : null}
            </div>
            <div className={styles.fieldWide}>
              <label className={styles.checkboxLabel}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  checked={isActive}
                  disabled={!location.fishingBase.isActive && !isActive}
                  onChange={(event) => {
                    if (event.target.checked && !location.fishingBase.isActive) {
                      setEditError('Сначала активируйте рыболовную базу.');
                      return;
                    }
                    setIsActive(event.target.checked);
                  }}
                />
                Локация активна
              </label>
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isSaving}>
              {isSaving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
