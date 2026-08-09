'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useState } from 'react';
import styles from '../../../catalog.module.css';
import {
  type AdminFish,
  createFish,
  listAdminFish,
  type UpdateFishInput,
  updateFish,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { useApiResource } from '@/lib/use-api-resource';

export default function AdminFishPage() {
  const router = useRouter();
  const loadFish = useCallback((signal: AbortSignal) => listAdminFish('all', signal), []);
  const { state, reload } = useApiResource(
    loadFish,
    'Не удалось загрузить административный список рыб.',
  );
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
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
    setFormError(null);
    setSuccessMessage(null);

    if (!trimmedName) {
      setNameError('Введите название рыбы.');
      return;
    }

    setIsCreating(true);

    try {
      const created = await createFish({ name: trimmedName });
      setName('');
      setSuccessMessage(`Рыба «${created.name}» создана.`);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'FISH_NAME_ALREADY_EXISTS') {
        setNameError('Рыба с таким названием уже существует.');
      } else if (isApiError(error) && error.fieldErrors.name?.[0]) {
        setNameError(error.fieldErrors.name[0]);
      } else {
        setFormError(getApiErrorMessage(error, 'Не удалось создать рыбу.'));
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Административный каталог</p>
        <h1 className={styles.title}>Рыбы</h1>
        <p className={styles.subtitle}>
          Рыбы являются глобальными сущностями. Вес и статистика в этот каталог не входят.
        </p>
      </header>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить рыбу</h2>
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
          <div className={styles.field}>
            <label className={styles.label} htmlFor="fish-name">
              Название
            </label>
            <input
              className={styles.input}
              id="fish-name"
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
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isCreating}>
              {isCreating ? 'Создаём…' : 'Создать рыбу'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Все рыбы</h2>
        {state.kind === 'loading' ? (
          <p className={styles.muted} aria-live="polite">
            Загружаем рыб…
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
          <p className={styles.muted}>Рыбы ещё не созданы.</p>
        ) : null}
        {state.kind === 'ready' && state.data.length > 0 ? (
          <div className={styles.editorList}>
            {state.data.map((fish) => (
              <FishEditor fish={fish} reload={reload} key={`${fish.id}:${fish.updatedAt}`} />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function FishEditor({ fish, reload }: { fish: AdminFish; reload: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(fish.name);
  const [isActive, setIsActive] = useState(fish.isActive);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSaving) {
      return;
    }

    const trimmedName = name.trim();
    const update: UpdateFishInput = {};
    setNameError(null);
    setFormError(null);

    if (!trimmedName) {
      setNameError('Введите название рыбы.');
      return;
    }

    if (trimmedName !== fish.name) {
      update.name = trimmedName;
    }

    if (isActive !== fish.isActive) {
      update.isActive = isActive;
    }

    if (Object.keys(update).length === 0) {
      setFormError('Нет изменений для сохранения.');
      return;
    }

    setIsSaving(true);

    try {
      await updateFish(fish.id, update);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'FISH_NAME_ALREADY_EXISTS') {
        setNameError('Рыба с таким названием уже существует.');
      } else if (isApiError(error) && error.fieldErrors.name?.[0]) {
        setNameError(error.fieldErrors.name[0]);
      } else {
        setFormError(getApiErrorMessage(error, 'Не удалось сохранить рыбу.'));
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className={styles.editorRow}>
      <div className={styles.editorHeader}>
        <div>
          <h3 className={styles.itemName}>{fish.name}</h3>
          <p className={styles.metadata}>Обновлено: {formatDate(fish.updatedAt)}</p>
        </div>
        <span
          className={`${styles.status} ${fish.isActive ? styles.activeStatus : styles.inactiveStatus}`}
        >
          {fish.isActive ? 'Активна' : 'Неактивна'}
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
            <label className={styles.label} htmlFor={`fish-name-${fish.id}`}>
              Название
            </label>
            <input
              className={styles.input}
              id={`fish-name-${fish.id}`}
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
            <span className={styles.label}>Публичная видимость</span>
            <label className={styles.checkboxLabel}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              Рыба активна
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

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
