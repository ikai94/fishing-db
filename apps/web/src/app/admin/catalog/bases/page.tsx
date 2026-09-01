'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useMemo, useState } from 'react';
import styles from '../../../catalog.module.css';
import { createFishingBase, listAdminFishingBases } from '@/lib/admin-catalog-api';
import { getApiErrorMessage, isApiError } from '@/lib/api-client';
import { filterCatalogItems } from '@/lib/catalog-search';
import { useApiResource } from '@/lib/use-api-resource';

export default function AdminFishingBasesPage() {
  const router = useRouter();
  const loadBases = useCallback((signal: AbortSignal) => listAdminFishingBases('all', signal), []);
  const { state, reload } = useApiResource(
    loadBases,
    'Не удалось загрузить административный список баз.',
  );
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const visibleBases = useMemo(
    () => (state.kind === 'ready' ? filterCatalogItems(state.data, searchQuery) : []),
    [searchQuery, state],
  );

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const trimmedName = name.trim();
    setNameError(null);
    setFormError(null);
    setSuccessMessage(null);

    if (trimmedName.length === 0) {
      setNameError('Введите название базы.');
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await createFishingBase({ name: trimmedName });
      setName('');
      setSuccessMessage(`База «${created.name}» создана.`);
      reload();
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        return;
      }

      if (isApiError(error) && error.status === 403) {
        setFormError('Административные права недоступны. Обновите страницу.');
      } else if (isApiError(error) && error.code === 'FISHING_BASE_NAME_ALREADY_EXISTS') {
        setNameError('База с таким названием уже существует.');
      } else if (isApiError(error) && error.fieldErrors.name?.[0]) {
        setNameError(error.fieldErrors.name[0]);
      } else {
        setFormError(getApiErrorMessage(error, 'Не удалось создать базу. Попробуйте ещё раз.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Административный каталог</p>
        <h1 className={styles.title}>Рыболовные базы</h1>
        <p className={styles.subtitle}>Неактивные базы остаются в каталоге, но скрыты публично.</p>
      </header>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Добавить базу</h2>
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
            <label className={styles.label} htmlFor="base-name">
              Название
            </label>
            <input
              className={styles.input}
              id="base-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              maxLength={128}
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? 'base-name-error' : undefined}
              required
            />
            {nameError ? (
              <p className={styles.fieldError} id="base-name-error">
                {nameError}
              </p>
            ) : null}
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Создаём…' : 'Создать базу'}
            </button>
          </div>
        </form>
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Все базы</h2>

        {state.kind === 'ready' && state.data.length > 0 ? (
          <div className={styles.compactSearchField}>
            <label className={styles.label} htmlFor="admin-base-search">
              Найти базу
            </label>
            <input
              className={styles.input}
              id="admin-base-search"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Название базы"
            />
          </div>
        ) : null}

        {state.kind === 'loading' ? (
          <p className={styles.muted} aria-live="polite">
            Загружаем базы…
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
          <p className={styles.muted}>Базы ещё не созданы.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 && visibleBases.length === 0 ? (
          <p className={styles.muted}>Баз с таким названием не найдено.</p>
        ) : null}

        {state.kind === 'ready' && visibleBases.length > 0 ? (
          <ul className={styles.list}>
            {visibleBases.map((base) => (
              <li className={styles.listItem} key={base.id}>
                <div className={styles.itemMain}>
                  <p className={styles.itemName}>{base.name}</p>
                  <p className={styles.metadata}>Обновлено: {formatDate(base.updatedAt)}</p>
                </div>
                <div className={styles.inlineActions}>
                  <span
                    className={`${styles.status} ${
                      base.isActive ? styles.activeStatus : styles.inactiveStatus
                    }`}
                  >
                    {base.isActive ? 'Активна' : 'Неактивна'}
                  </span>
                  <Link className={styles.link} href={`/admin/catalog/bases/${base.id}`}>
                    Управлять
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
