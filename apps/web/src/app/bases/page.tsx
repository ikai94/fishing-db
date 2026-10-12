'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import styles from '../bases-locations.module.css';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { BaseNotebookLink } from '@/components/base-notebook-link';
import { getCurrentUser } from '@/lib/auth-api';
import { listFishingBases } from '@/lib/catalog-api';
import { useApiResource } from '@/lib/use-api-resource';

/** Публичный список баз дополняется приватной навигацией только для действующего ADMIN. */
export default function FishingBasesPage() {
  const loadBases = useCallback((signal: AbortSignal) => listFishingBases(signal), []);
  const { state, reload } = useApiResource(
    loadBases,
    'Не удалось загрузить список рыболовных баз. Попробуйте ещё раз.',
  );
  // Проверяем доступ один раз для всего списка; гостю и при ошибке остаётся обычный каталог.
  const loadUser = useCallback((signal: AbortSignal) => getCurrentUser(signal), []);
  const { state: userState } = useApiResource(loadUser, 'Не удалось проверить доступ к блокноту.');
  const notebookAllowed =
    userState.kind === 'ready' && userState.data.role === 'ADMIN' && !userState.data.isBanned;

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon}>
              <ShellIcon name="bases" />
            </span>
            <h1 className={styles.title} id="bases-title">
              Базы и локации
            </h1>
          </div>
          <p className={styles.subtitle}>Активные базы, их локации и виды рыб.</p>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Загружаем базы…
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <div className={`${styles.statusMessage} ${styles.errorMessage}`} role="alert">
            <p>{state.message}</p>
            <button className={styles.secondaryButton} type="button" onClick={reload}>
              Повторить
            </button>
          </div>
        ) : null}

        {state.kind === 'not-found' ? (
          <p className={styles.statusMessage}>Каталог баз пока недоступен.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length === 0 ? (
          <p className={styles.statusMessage}>В каталоге пока нет активных рыболовных баз.</p>
        ) : null}

        {state.kind === 'ready' && state.data.length > 0 ? (
          <div
            aria-label="Таблица рыболовных баз"
            className={styles.tableRegion}
            role="region"
            tabIndex={0}
          >
            <table className={styles.catalogTable} aria-labelledby="bases-title">
              <caption className={styles.visuallyHidden}>
                Рыболовные базы, число активных локаций и рыб
              </caption>
              <thead>
                <tr>
                  <th scope="col">№</th>
                  <th scope="col">База</th>
                  <th className={styles.numericCell} scope="col">
                    Локаций
                  </th>
                  <th className={styles.numericCell} scope="col">
                    Рыб
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.data.map((base, index) => (
                  <tr key={base.id}>
                    <td className={styles.rowNumber}>{index + 1}</td>
                    <td>
                      <Link className={styles.entityLink} href={`/bases/${base.id}`}>
                        {base.name}
                      </Link>
                      <BaseNotebookLink baseId={base.id} allowed={notebookAllowed} />
                    </td>
                    <td className={styles.numericCell}>{base.locationsCount}</td>
                    <td className={styles.numericCell}>{base.fishCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </ApplicationShell>
  );
}
