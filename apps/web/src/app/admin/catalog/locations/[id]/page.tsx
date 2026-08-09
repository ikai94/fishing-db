'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useMemo, useState } from 'react';
import styles from '../../../../catalog.module.css';
import {
  type AdminFish,
  type AdminLocationDetail,
  addFishToLocation,
  getAdminLocation,
  listAdminFish,
  removeFishFromLocation,
  type UpdateLocationInput,
  updateLocation,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { useApiResource } from '@/lib/use-api-resource';

type LocationPageData = {
  location: AdminLocationDetail;
  activeFish: AdminFish[];
};

export default function AdminLocationPage() {
  const { id: locationId } = useParams<{ id: string }>();
  const loadLocation = useCallback(
    async (signal: AbortSignal): Promise<LocationPageData> => {
      const [location, activeFish] = await Promise.all([
        getAdminLocation(locationId, signal),
        listAdminFish('active', signal),
      ]);
      return { location, activeFish };
    },
    [locationId],
  );
  const { state, reload } = useApiResource(
    loadLocation,
    'Не удалось загрузить локацию и связи с рыбами.',
  );

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
          data={state.data}
          reload={reload}
          key={`${state.data.location.id}:${state.data.location.updatedAt}:${state.data.location.fish.length}`}
        />
      ) : null}
    </>
  );
}

function LocationEditor({ data, reload }: { data: LocationPageData; reload: () => void }) {
  const { location, activeFish } = data;
  const router = useRouter();
  const [name, setName] = useState(location.name);
  const [number, setNumber] = useState(String(location.number));
  const [isActive, setIsActive] = useState(location.isActive);
  const [nameError, setNameError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedFishId, setSelectedFishId] = useState('');
  const [relationError, setRelationError] = useState<string | null>(null);
  const [isAddingFish, setIsAddingFish] = useState(false);
  const [removingFishId, setRemovingFishId] = useState<string | null>(null);

  const availableFish = useMemo(() => {
    const relatedIds = new Set(location.fish.map((fish) => fish.id));
    return activeFish.filter((fish) => !relatedIds.has(fish.id));
  }, [activeFish, location.fish]);

  const relationCanBeAdded = location.fishingBase.isActive && location.isActive;

  function handleAuthorizationError(error: unknown): boolean {
    if (isApiError(error) && error.status === 401) {
      router.replace('/login');
      return true;
    }

    if (isApiError(error) && error.status === 403) {
      setEditError('Административные права недоступны. Обновите страницу.');
      return true;
    }

    return false;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    const trimmedName = name.trim();
    const parsedNumber = Number(number);
    const update: UpdateLocationInput = {};
    setNameError(null);
    setNumberError(null);
    setEditError(null);

    if (trimmedName.length === 0) {
      setNameError('Введите название локации.');
    }

    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      setNumberError('Номер должен быть целым числом не меньше 1.');
    }

    if (trimmedName.length === 0 || !Number.isInteger(parsedNumber) || parsedNumber < 1) {
      return;
    }

    if (trimmedName !== location.name) {
      update.name = trimmedName;
    }

    if (parsedNumber !== location.number) {
      update.number = parsedNumber;
    }

    if (isActive !== location.isActive) {
      update.isActive = isActive;
    }

    if (Object.keys(update).length === 0) {
      setEditError('Нет изменений для сохранения.');
      return;
    }

    setIsSaving(true);

    try {
      await updateLocation(location.id, update);
      reload();
    } catch (error) {
      if (handleAuthorizationError(error)) {
        return;
      }

      if (isApiError(error) && error.code === 'LOCATION_NUMBER_ALREADY_EXISTS') {
        setNumberError('На этой базе уже есть локация с таким номером.');
      } else if (isApiError(error) && error.code === 'LOCATION_NAME_ALREADY_EXISTS') {
        setNameError('На этой базе уже есть локация с таким названием.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_INACTIVE') {
        setEditError('Нельзя активировать локацию, пока её база неактивна.');
      } else {
        setNameError(isApiError(error) ? (error.fieldErrors.name?.[0] ?? null) : null);
        setNumberError(isApiError(error) ? (error.fieldErrors.number?.[0] ?? null) : null);

        if (
          !isApiError(error) ||
          (!error.fieldErrors.name?.[0] && !error.fieldErrors.number?.[0])
        ) {
          setEditError(getApiErrorMessage(error, 'Не удалось сохранить локацию.'));
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddFish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isAddingFish || !relationCanBeAdded) {
      return;
    }

    setRelationError(null);

    if (!selectedFishId) {
      setRelationError('Выберите рыбу.');
      return;
    }

    setIsAddingFish(true);

    try {
      await addFishToLocation(location.id, selectedFishId);
      setSelectedFishId('');
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setRelationError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'LOCATION_FISH_ALREADY_EXISTS') {
        setRelationError('Эта рыба уже связана с локацией.');
      } else if (
        isApiError(error) &&
        ['FISHING_BASE_INACTIVE', 'LOCATION_INACTIVE', 'FISH_INACTIVE'].includes(error.code ?? '')
      ) {
        setRelationError('Добавление возможно только для активной базы, локации и рыбы.');
      } else {
        setRelationError(getApiErrorMessage(error, 'Не удалось добавить рыбу к локации.'));
      }
    } finally {
      setIsAddingFish(false);
    }
  }

  async function handleRemoveFish(fishId: string, fishName: string) {
    if (removingFishId !== null) {
      return;
    }

    if (!window.confirm(`Убрать рыбу «${fishName}» с этой локации?`)) {
      return;
    }

    setRelationError(null);
    setRemovingFishId(fishId);

    try {
      await removeFishFromLocation(location.id, fishId);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setRelationError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'LOCATION_FISH_NOT_FOUND') {
        setRelationError('Связь уже отсутствует. Обновите список.');
      } else {
        setRelationError(getApiErrorMessage(error, 'Не удалось убрать рыбу с локации.'));
      }
    } finally {
      setRemovingFishId(null);
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
          База:{' '}
          <Link
            className={styles.backLink}
            href={`/admin/catalog/bases/${location.fishingBase.id}`}
          >
            {location.fishingBase.name}
          </Link>
        </p>
      </header>

      {!location.fishingBase.isActive ? (
        <p className={`${styles.message} ${styles.warningMessage}`}>
          Рыболовная база неактивна. Локация скрыта публично и не может быть активирована.
        </p>
      ) : null}

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Настройки локации</h2>
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
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                }}
                maxLength={128}
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

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить рыбу</h2>
        {!relationCanBeAdded ? (
          <p className={`${styles.message} ${styles.warningMessage}`}>
            Добавление доступно только для активной базы и активной локации.
          </p>
        ) : null}
        {relationError ? (
          <p className={styles.formError} role="alert">
            {relationError}
          </p>
        ) : null}
        <form className={styles.form} onSubmit={handleAddFish}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="location-fish">
              Активная рыба
            </label>
            <select
              className={styles.select}
              id="location-fish"
              value={selectedFishId}
              onChange={(event) => {
                setSelectedFishId(event.target.value);
                setRelationError(null);
              }}
              disabled={!relationCanBeAdded || isAddingFish || availableFish.length === 0}
              required
            >
              <option value="">Выберите рыбу</option>
              {availableFish.map((fish) => (
                <option value={fish.id} key={fish.id}>
                  {fish.name}
                </option>
              ))}
            </select>
          </div>
          {availableFish.length === 0 ? (
            <p className={styles.muted}>Все активные рыбы уже добавлены или каталог рыб пуст.</p>
          ) : null}
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="submit"
              disabled={!relationCanBeAdded || isAddingFish || availableFish.length === 0}
            >
              {isAddingFish ? 'Добавляем…' : 'Добавить рыбу'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Рыбы на локации</h2>
        {location.fish.length === 0 ? (
          <p className={styles.muted}>Связи с рыбами ещё не добавлены.</p>
        ) : (
          <ul className={styles.list}>
            {location.fish.map((fish) => (
              <li className={styles.listItem} key={fish.id}>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>{fish.name}</p>
                  <p className={styles.metadata}>
                    Связь создана: {formatDate(fish.relationCreatedAt)}
                  </p>
                </div>
                <div className={styles.inlineActions}>
                  <span
                    className={`${styles.status} ${
                      fish.isActive ? styles.activeStatus : styles.inactiveStatus
                    }`}
                  >
                    {fish.isActive ? 'Активна' : 'Рыба неактивна'}
                  </span>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    onClick={() => void handleRemoveFish(fish.id, fish.name)}
                    disabled={removingFishId !== null}
                  >
                    {removingFishId === fish.id ? 'Убираем…' : 'Убрать связь'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
