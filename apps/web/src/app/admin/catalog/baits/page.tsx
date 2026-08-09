'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useState } from 'react';
import styles from '../../../catalog.module.css';
import {
  type AdminBait,
  createBait,
  listAdminBaits,
  type UpdateBaitInput,
  updateBait,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import type { BaitType } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

export default function AdminBaitsPage() {
  const router = useRouter();
  const loadBaits = useCallback((signal: AbortSignal) => listAdminBaits('all', signal), []);
  const { state, reload } = useApiResource(
    loadBaits,
    'Не удалось загрузить административный список наживок и приманок.',
  );
  const [name, setName] = useState('');
  const [type, setType] = useState<BaitType | ''>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreating) {
      return;
    }

    const trimmedName = name.trim();
    setNameError(null);
    setTypeError(null);
    setFormError(null);
    setSuccessMessage(null);

    if (!trimmedName) {
      setNameError('Введите название.');
    }

    if (!type) {
      setTypeError('Выберите тип.');
    }

    if (!trimmedName || !type) {
      return;
    }

    setIsCreating(true);

    try {
      const created = await createBait({ name: trimmedName, type });
      setName('');
      setType('');
      setSuccessMessage(`«${created.name}» добавлено в каталог.`);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'BAIT_NAME_ALREADY_EXISTS') {
        setNameError('Наживка или приманка с таким названием уже существует.');
      } else {
        setNameError(isApiError(error) ? (error.fieldErrors.name?.[0] ?? null) : null);
        setTypeError(isApiError(error) ? (error.fieldErrors.type?.[0] ?? null) : null);

        if (!isApiError(error) || (!error.fieldErrors.name?.[0] && !error.fieldErrors.type?.[0])) {
          setFormError(getApiErrorMessage(error, 'Не удалось добавить запись в каталог.'));
        }
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Административный каталог</p>
        <h1 className={styles.title}>Наживки и приманки</h1>
        <p className={styles.subtitle}>
          Тип обязателен. Связи с рыбами появятся только из будущих отчётов об уловах.
        </p>
      </header>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить запись</h2>
        <form className={styles.form} onSubmit={handleCreate} noValidate>
          {successMessage ? (
            <p className={`${styles.message} ${styles.successMessage}`} role="status">
              {successMessage}
            </p>
          ) : null}
          {formError ? (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          ) : null}
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bait-name">
                Название
              </label>
              <input
                className={styles.input}
                id="bait-name"
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
            <div className={styles.field}>
              <label className={styles.label} htmlFor="bait-type">
                Тип
              </label>
              <select
                className={styles.select}
                id="bait-type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as BaitType | '');
                  setTypeError(null);
                }}
                aria-invalid={typeError ? 'true' : undefined}
                required
              >
                <option value="">Выберите тип</option>
                <option value="BAIT">Наживка</option>
                <option value="LURE">Искусственная приманка</option>
              </select>
              {typeError ? <p className={styles.fieldError}>{typeError}</p> : null}
            </div>
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isCreating}>
              {isCreating ? 'Добавляем…' : 'Добавить'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Все записи</h2>
        {state.kind === 'loading' ? (
          <p className={styles.muted} aria-live="polite">
            Загружаем каталог…
          </p>
        ) : null}
        {state.kind === 'error' ? (
          <div className={`${styles.message} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}
        {state.kind === 'not-found' || (state.kind === 'ready' && state.data.length === 0) ? (
          <p className={styles.muted}>Наживки и приманки ещё не созданы.</p>
        ) : null}
        {state.kind === 'ready' && state.data.length > 0 ? (
          <div className={styles.editorList}>
            {state.data.map((bait) => (
              <BaitEditor bait={bait} reload={reload} key={`${bait.id}:${bait.updatedAt}`} />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function BaitEditor({ bait, reload }: { bait: AdminBait; reload: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(bait.name);
  const [type, setType] = useState<BaitType>(bait.type);
  const [isActive, setIsActive] = useState(bait.isActive);
  const [nameError, setNameError] = useState<string | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    const trimmedName = name.trim();
    const update: UpdateBaitInput = {};
    setNameError(null);
    setTypeError(null);
    setFormError(null);

    if (!trimmedName) {
      setNameError('Введите название.');
      return;
    }

    if (trimmedName !== bait.name) {
      update.name = trimmedName;
    }

    if (type !== bait.type) {
      update.type = type;
    }

    if (isActive !== bait.isActive) {
      update.isActive = isActive;
    }

    if (Object.keys(update).length === 0) {
      setFormError('Нет изменений для сохранения.');
      return;
    }

    setIsSaving(true);

    try {
      await updateBait(bait.id, update);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'BAIT_NAME_ALREADY_EXISTS') {
        setNameError('Наживка или приманка с таким названием уже существует.');
      } else {
        setNameError(isApiError(error) ? (error.fieldErrors.name?.[0] ?? null) : null);
        setTypeError(isApiError(error) ? (error.fieldErrors.type?.[0] ?? null) : null);

        if (!isApiError(error) || (!error.fieldErrors.name?.[0] && !error.fieldErrors.type?.[0])) {
          setFormError(getApiErrorMessage(error, 'Не удалось сохранить запись.'));
        }
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className={styles.editorRow}>
      <div className={styles.editorHeader}>
        <div>
          <h3 className={styles.itemName}>{bait.name}</h3>
          <p className={styles.metadata}>
            {baitTypeLabel(bait.type)} · обновлено {formatDate(bait.updatedAt)}
          </p>
        </div>
        <span
          className={`${styles.status} ${bait.isActive ? styles.activeStatus : styles.inactiveStatus}`}
        >
          {bait.isActive ? 'Активна' : 'Неактивна'}
        </span>
      </div>
      <form className={styles.form} onSubmit={handleSave} noValidate>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`bait-name-${bait.id}`}>
              Название
            </label>
            <input
              className={styles.input}
              id={`bait-name-${bait.id}`}
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
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`bait-type-${bait.id}`}>
              Тип
            </label>
            <select
              className={styles.select}
              id={`bait-type-${bait.id}`}
              value={type}
              onChange={(event) => {
                setType(event.target.value as BaitType);
                setTypeError(null);
              }}
              aria-invalid={typeError ? 'true' : undefined}
            >
              <option value="BAIT">Наживка</option>
              <option value="LURE">Искусственная приманка</option>
            </select>
            {typeError ? <p className={styles.fieldError}>{typeError}</p> : null}
          </div>
          <div className={styles.fieldWide}>
            <label className={styles.checkboxLabel}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              Запись активна
            </label>
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.button} type="submit" disabled={isSaving}>
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </article>
  );
}

function baitTypeLabel(type: BaitType): string {
  return type === 'BAIT' ? 'Наживка' : 'Искусственная приманка';
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
