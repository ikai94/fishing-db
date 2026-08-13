'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useMemo, useState } from 'react';
import styles from '../../../../catalog.module.css';
import {
  type AdminFishingBaseDetail,
  type AdminFish,
  addFishToFishingBase,
  createLocation,
  getAdminFishingBase,
  listAdminFish,
  removeFishFromFishingBase,
  type UpdateFishingBaseInput,
  updateFishingBase,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { useApiResource } from '@/lib/use-api-resource';

type BasePageData = {
  base: AdminFishingBaseDetail;
  activeFish: AdminFish[];
};

export default function AdminFishingBasePage() {
  const { id: baseId } = useParams<{ id: string }>();
  const loadBase = useCallback(
    async (signal: AbortSignal): Promise<BasePageData> => {
      const [base, activeFish] = await Promise.all([
        getAdminFishingBase(baseId, signal),
        listAdminFish('active', signal),
      ]);
      return { base, activeFish };
    },
    [baseId],
  );
  const { state, reload } = useApiResource(loadBase, 'Не удалось загрузить рыболовную базу.');

  return (
    <>
      <nav className={styles.sectionNav}>
        <Link className={styles.backLink} href="/admin/catalog/bases">
          ← Все базы
        </Link>
      </nav>

      {state.kind === 'loading' ? (
        <p className={styles.message} aria-live="polite">
          Загружаем базу и локации…
        </p>
      ) : null}

      {state.kind === 'not-found' ? (
        <div className={styles.message}>
          <h1 className={styles.panelTitle}>База не найдена</h1>
          <Link className={styles.link} href="/admin/catalog/bases">
            Вернуться к списку
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
        <BaseEditor
          base={state.data.base}
          activeFish={state.data.activeFish}
          reload={reload}
          key={`${state.data.base.id}:${state.data.base.updatedAt}:${state.data.base.fish.length}`}
        />
      ) : null}
    </>
  );
}

function BaseEditor({
  base,
  activeFish,
  reload,
}: {
  base: AdminFishingBaseDetail;
  activeFish: AdminFish[];
  reload: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(base.name);
  const [isActive, setIsActive] = useState(base.isActive);
  const [baseNameError, setBaseNameError] = useState<string | null>(null);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [baseSuccess, setBaseSuccess] = useState<string | null>(null);
  const [isSavingBase, setIsSavingBase] = useState(false);

  const [locationName, setLocationName] = useState('');
  const [locationNumber, setLocationNumber] = useState('');
  const [locationNameError, setLocationNameError] = useState<string | null>(null);
  const [locationNumberError, setLocationNumberError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationSuccess, setLocationSuccess] = useState<string | null>(null);
  const [isCreatingLocation, setIsCreatingLocation] = useState(false);

  const [selectedFishId, setSelectedFishId] = useState('');
  const [relationError, setRelationError] = useState<string | null>(null);
  const [isAddingFish, setIsAddingFish] = useState(false);
  const [removingFishId, setRemovingFishId] = useState<string | null>(null);

  const availableFish = useMemo(() => {
    const relatedIds = new Set(base.fish.map((fish) => fish.id));
    return activeFish.filter((fish) => !relatedIds.has(fish.id));
  }, [activeFish, base.fish]);

  async function handleAddFish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isAddingFish || !base.isActive) return;
    setRelationError(null);
    if (!selectedFishId) {
      setRelationError('Выберите рыбу.');
      return;
    }

    setIsAddingFish(true);
    try {
      await addFishToFishingBase(base.id, selectedFishId);
      setSelectedFishId('');
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      if (isApiError(error) && error.status === 403) {
        setRelationError('Административные права недоступны.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_FISH_ALREADY_EXISTS') {
        setRelationError('Эта рыба уже связана с базой.');
      } else if (
        isApiError(error) &&
        ['FISHING_BASE_INACTIVE', 'FISH_INACTIVE'].includes(error.code ?? '')
      ) {
        setRelationError('Добавление возможно только для активной базы и активной рыбы.');
      } else {
        setRelationError(getApiErrorMessage(error, 'Не удалось добавить рыбу к базе.'));
      }
    } finally {
      setIsAddingFish(false);
    }
  }

  async function handleRemoveFish(fishId: string, fishName: string) {
    if (removingFishId !== null || !window.confirm(`Убрать рыбу «${fishName}» с этой базы?`))
      return;

    setRelationError(null);
    setRemovingFishId(fishId);
    try {
      await removeFishFromFishingBase(base.id, fishId);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }
      if (isApiError(error) && error.status === 403) {
        setRelationError('Административные права недоступны.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_FISH_NOT_FOUND') {
        setRelationError('Связь уже отсутствует. Обновите список.');
      } else {
        setRelationError(getApiErrorMessage(error, 'Не удалось убрать рыбу с базы.'));
      }
    } finally {
      setRemovingFishId(null);
    }
  }

  async function handleSaveBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSavingBase) {
      return;
    }

    const trimmedName = name.trim();
    const update: UpdateFishingBaseInput = {};
    setBaseNameError(null);
    setBaseError(null);
    setBaseSuccess(null);

    if (trimmedName.length === 0) {
      setBaseNameError('Введите название базы.');
      return;
    }

    if (trimmedName !== base.name) {
      update.name = trimmedName;
    }

    if (isActive !== base.isActive) {
      update.isActive = isActive;
    }

    if (Object.keys(update).length === 0) {
      setBaseError('Нет изменений для сохранения.');
      return;
    }

    setIsSavingBase(true);

    try {
      await updateFishingBase(base.id, update);
      setBaseSuccess('Изменения сохранены.');
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setBaseError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_NAME_ALREADY_EXISTS') {
        setBaseNameError('База с таким названием уже существует.');
      } else if (isApiError(error) && error.fieldErrors.name?.[0]) {
        setBaseNameError(error.fieldErrors.name[0]);
      } else {
        setBaseError(getApiErrorMessage(error, 'Не удалось сохранить базу.'));
      }
    } finally {
      setIsSavingBase(false);
    }
  }

  async function handleCreateLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreatingLocation || !base.isActive) {
      return;
    }

    const trimmedName = locationName.trim();
    const parsedNumber = Number(locationNumber);
    setLocationNameError(null);
    setLocationNumberError(null);
    setLocationError(null);
    setLocationSuccess(null);

    if (trimmedName.length === 0) {
      setLocationNameError('Введите название локации.');
    }

    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      setLocationNumberError('Номер должен быть целым числом не меньше 1.');
    }

    if (trimmedName.length === 0 || !Number.isInteger(parsedNumber) || parsedNumber < 1) {
      return;
    }

    setIsCreatingLocation(true);

    try {
      const created = await createLocation(base.id, { name: trimmedName, number: parsedNumber });
      setLocationName('');
      setLocationNumber('');
      setLocationSuccess(`Локация №${created.number} «${created.name}» создана.`);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setLocationError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'LOCATION_NUMBER_ALREADY_EXISTS') {
        setLocationNumberError('На этой базе уже есть локация с таким номером.');
      } else if (isApiError(error) && error.code === 'LOCATION_NAME_ALREADY_EXISTS') {
        setLocationNameError('На этой базе уже есть локация с таким названием.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_INACTIVE') {
        setLocationError('Сначала активируйте рыболовную базу.');
      } else {
        setLocationNameError(isApiError(error) ? (error.fieldErrors.name?.[0] ?? null) : null);
        setLocationNumberError(isApiError(error) ? (error.fieldErrors.number?.[0] ?? null) : null);

        if (
          !isApiError(error) ||
          (!error.fieldErrors.name?.[0] && !error.fieldErrors.number?.[0])
        ) {
          setLocationError(getApiErrorMessage(error, 'Не удалось создать локацию.'));
        }
      }
    } finally {
      setIsCreatingLocation(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Рыболовная база</p>
        <h1 className={styles.title}>{base.name}</h1>
        <p className={styles.subtitle}>
          Статус:{' '}
          <span
            className={`${styles.status} ${
              base.isActive ? styles.activeStatus : styles.inactiveStatus
            }`}
          >
            {base.isActive ? 'Активна' : 'Неактивна'}
          </span>
        </p>
      </header>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Настройки базы</h2>
        <form className={styles.form} onSubmit={handleSaveBase} noValidate>
          {baseSuccess ? (
            <p className={`${styles.message} ${styles.successMessage}`} role="status">
              {baseSuccess}
            </p>
          ) : null}
          {baseError ? (
            <p className={styles.formError} role="alert">
              {baseError}
            </p>
          ) : null}
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="edit-base-name">
                Название
              </label>
              <input
                className={styles.input}
                id="edit-base-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setBaseNameError(null);
                }}
                maxLength={128}
                aria-invalid={baseNameError ? 'true' : undefined}
                required
              />
              {baseNameError ? <p className={styles.fieldError}>{baseNameError}</p> : null}
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Публичная видимость</span>
              <label className={styles.checkboxLabel}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                />
                База активна
              </label>
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isSavingBase}>
              {isSavingBase ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить локацию</h2>
        {!base.isActive ? (
          <p className={`${styles.message} ${styles.warningMessage}`}>
            Создание локаций запрещено, пока база неактивна.
          </p>
        ) : null}
        <form className={styles.form} onSubmit={handleCreateLocation} noValidate>
          {locationSuccess ? (
            <p className={`${styles.message} ${styles.successMessage}`} role="status">
              {locationSuccess}
            </p>
          ) : null}
          {locationError ? (
            <p className={styles.formError} role="alert">
              {locationError}
            </p>
          ) : null}
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="location-number">
                Номер
              </label>
              <input
                className={styles.input}
                id="location-number"
                type="number"
                min="1"
                step="1"
                value={locationNumber}
                onChange={(event) => {
                  setLocationNumber(event.target.value);
                  setLocationNumberError(null);
                }}
                disabled={!base.isActive || isCreatingLocation}
                aria-invalid={locationNumberError ? 'true' : undefined}
                required
              />
              {locationNumberError ? (
                <p className={styles.fieldError}>{locationNumberError}</p>
              ) : null}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="location-name">
                Название
              </label>
              <input
                className={styles.input}
                id="location-name"
                value={locationName}
                onChange={(event) => {
                  setLocationName(event.target.value);
                  setLocationNameError(null);
                }}
                maxLength={128}
                disabled={!base.isActive || isCreatingLocation}
                aria-invalid={locationNameError ? 'true' : undefined}
                required
              />
              {locationNameError ? <p className={styles.fieldError}>{locationNameError}</p> : null}
            </div>
          </div>
          <div className={styles.actions}>
            <button
              className={styles.button}
              type="submit"
              disabled={!base.isActive || isCreatingLocation}
            >
              {isCreatingLocation ? 'Создаём…' : 'Создать локацию'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Локации</h2>
        {base.locations.length === 0 ? (
          <p className={styles.muted}>Локации ещё не созданы.</p>
        ) : (
          <ul className={styles.list}>
            {base.locations.map((location) => (
              <li className={styles.listItem} key={location.id}>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>
                    <span className={styles.locationNumber}>{location.number}</span>
                    {location.name}
                  </p>
                </div>
                <div className={styles.inlineActions}>
                  <span
                    className={`${styles.status} ${
                      location.isActive ? styles.activeStatus : styles.inactiveStatus
                    }`}
                  >
                    {location.isActive ? 'Активна' : 'Неактивна'}
                  </span>
                  <Link className={styles.link} href={`/admin/catalog/locations/${location.id}`}>
                    Управлять
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить рыбу к базе</h2>
        {!base.isActive ? (
          <p className={`${styles.message} ${styles.warningMessage}`}>
            Добавление доступно только для активной базы.
          </p>
        ) : null}
        {relationError ? (
          <p className={styles.formError} role="alert">
            {relationError}
          </p>
        ) : null}
        <form className={styles.form} onSubmit={handleAddFish}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="base-fish">
              Активная рыба
            </label>
            <select
              className={styles.select}
              id="base-fish"
              value={selectedFishId}
              onChange={(event) => {
                setSelectedFishId(event.target.value);
                setRelationError(null);
              }}
              disabled={!base.isActive || isAddingFish || availableFish.length === 0}
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
              disabled={!base.isActive || isAddingFish || availableFish.length === 0}
            >
              {isAddingFish ? 'Добавляем…' : 'Добавить рыбу'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Рыбы базы</h2>
        <p className={styles.muted}>Связь действует для всех локаций базы.</p>
        {base.fish.length === 0 ? (
          <p className={styles.muted}>Связи с рыбами ещё не добавлены.</p>
        ) : (
          <ul className={styles.list}>
            {base.fish.map((fish) => (
              <li className={styles.listItem} key={fish.id}>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>{fish.name}</p>
                  <p className={styles.metadata}>
                    Связь создана: {formatDate(fish.relationCreatedAt)}
                  </p>
                </div>
                <div className={styles.inlineActions}>
                  <span
                    className={`${styles.status} ${fish.isActive ? styles.activeStatus : styles.inactiveStatus}`}
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
