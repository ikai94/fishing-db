'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useState } from 'react';
import styles from '../../../catalog.module.css';
import {
  type AdminScreenAnchor,
  createScreenAnchor,
  listAdminScreenAnchors,
  updateScreenAnchor,
} from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { useApiResource } from '@/lib/use-api-resource';

export default function AdminScreenAnchorsPage() {
  const loadAnchors = useCallback(
    (signal: AbortSignal) => listAdminScreenAnchors('all', signal),
    [],
  );
  const { state, reload } = useApiResource(loadAnchors, 'Не удалось загрузить ориентиры.');

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Администрирование</p>
        <h1 className={styles.title}>Ориентиры экрана</h1>
        <p className={styles.subtitle}>
          Подсказки для ввода позиции. Отчёт хранит исходный текст, а не ссылку на эту запись.
        </p>
      </header>
      {state.kind === 'loading' ? (
        <p className={styles.message} aria-live="polite">
          Загружаем ориентиры…
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
      {state.kind === 'ready' ? <AnchorManager anchors={state.data} reload={reload} /> : null}
    </>
  );
}

function AnchorManager({ anchors, reload }: { anchors: AdminScreenAnchor[]; reload: () => void }) {
  const router = useRouter();
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    setCreateError(null);
    if (!name) {
      setCreateError('Введите название ориентира.');
      return;
    }
    setIsCreating(true);
    try {
      await createScreenAnchor({ name });
      setNewName('');
      reload();
    } catch (error) {
      if (handleAuthorization(error, router)) return;
      setCreateError(anchorError(error, 'Не удалось создать ориентир.'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить ориентир</h2>
        <form className={styles.form} onSubmit={handleCreate} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-screen-anchor">
              Название
            </label>
            <input
              className={styles.input}
              id="new-screen-anchor"
              value={newName}
              maxLength={128}
              onChange={(event) => {
                setNewName(event.target.value);
                setCreateError(null);
              }}
              aria-invalid={createError ? 'true' : undefined}
              required
            />
            {createError ? <p className={styles.fieldError}>{createError}</p> : null}
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isCreating}>
              {isCreating ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Все ориентиры</h2>
        {anchors.length === 0 ? (
          <p className={styles.muted}>Ориентиры ещё не созданы.</p>
        ) : (
          <div className={styles.editorList}>
            {anchors.map((anchor) => (
              <AnchorEditor
                anchor={anchor}
                reload={reload}
                key={`${anchor.id}:${anchor.updatedAt}`}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AnchorEditor({ anchor, reload }: { anchor: AdminScreenAnchor; reload: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(anchor.name);
  const [isActive, setIsActive] = useState(anchor.isActive);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    setError(null);
    if (!normalizedName) {
      setError('Введите название ориентира.');
      return;
    }
    const update = {
      ...(normalizedName === anchor.name ? {} : { name: normalizedName }),
      ...(isActive === anchor.isActive ? {} : { isActive }),
    };
    if (Object.keys(update).length === 0) {
      setError('Нет изменений для сохранения.');
      return;
    }
    setIsSaving(true);
    try {
      await updateScreenAnchor(anchor.id, update);
      reload();
    } catch (saveError) {
      if (handleAuthorization(saveError, router)) return;
      setError(anchorError(saveError, 'Не удалось сохранить ориентир.'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className={styles.editorRow} onSubmit={handleSave}>
      <div className={styles.editorHeader}>
        <span
          className={`${styles.status} ${anchor.isActive ? styles.activeStatus : styles.inactiveStatus}`}
        >
          {anchor.isActive ? 'Активен' : 'Неактивен'}
        </span>
        <span className={styles.metadata}>Создан: {formatDate(anchor.createdAt)}</span>
      </div>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`anchor-${anchor.id}`}>
            Название
          </label>
          <input
            className={styles.input}
            id={`anchor-${anchor.id}`}
            value={name}
            maxLength={128}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Публичная подсказка</span>
          <label className={styles.checkboxLabel}>
            <input
              className={styles.checkbox}
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Ориентир активен
          </label>
        </div>
      </div>
      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={isSaving}>
          {isSaving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}

function handleAuthorization(error: unknown, router: ReturnType<typeof useRouter>): boolean {
  if (isApiError(error) && error.status === 401) {
    router.replace('/login');
    return true;
  }
  return false;
}

function anchorError(error: unknown, fallback: string): string {
  if (isApiError(error) && error.status === 403) return 'Административные права недоступны.';
  if (isApiError(error) && error.code === 'SCREEN_ANCHOR_NAME_ALREADY_EXISTS')
    return 'Ориентир с таким названием уже существует.';
  return getApiErrorMessage(error, fallback);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
