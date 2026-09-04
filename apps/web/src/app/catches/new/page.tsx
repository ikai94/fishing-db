'use client';

import Link from 'next/link';
import { useState } from 'react';
import catchStyles from '../../catch-reports.module.css';
import styles from './page.module.css';
import { CatchReportForm } from '../_components/catch-report-form';
import { NotebookCatchEntry } from '../_components/notebook-catch-entry';
import { ApplicationShell } from '@/components/application-shell/application-shell';
import { ShellIcon } from '@/components/application-shell/shell-icon';
import { useRequiredUser } from '@/lib/use-required-user';

type EntryMode = 'notebook' | 'manual';

export default function NewCatchReportPage() {
  const { state, reload } = useRequiredUser();
  const [entryMode, setEntryMode] = useState<EntryMode>('notebook');

  return (
    <ApplicationShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <div>
            <div className={styles.titleRow}>
              <span className={styles.titleIcon}>
                <ShellIcon name="addCatch" />
              </span>
              <h1 className={styles.title}>Добавить рыбу</h1>
            </div>
            <p className={styles.subtitle}>
              Автор определяется текущей сессией. После публикации улов будет доступен всем.
            </p>
          </div>
          <nav className={styles.headerActions} aria-label="Навигация по уловам">
            <Link className={styles.secondaryLink} href="/catches">
              Все уловы
            </Link>
            <Link className={styles.secondaryLink} href="/my/catches">
              Мои уловы
            </Link>
          </nav>
        </header>

        {state.kind === 'loading' ? (
          <p className={styles.statusMessage} aria-live="polite">
            Проверяем аккаунт…
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

        {state.kind === 'ready' ? (
          <div className={`${styles.entryContent} ${catchStyles.entryV1}`}>
            {state.user.isBanned ? (
              <div className={`${styles.statusMessage} ${styles.warningMessage}`} role="status">
                <h2 className={styles.messageTitle}>Публикация недоступна</h2>
                <p>
                  Аккаунт заблокирован. Распознать и проверить запись можно, но сохранить её нельзя.
                </p>
              </div>
            ) : (
              <div className={styles.modeSwitch} role="group" aria-label="Способ добавления">
                <button
                  aria-controls="notebook-entry-pane"
                  aria-pressed={entryMode === 'notebook'}
                  className={`${styles.modeButton} ${entryMode === 'notebook' ? styles.modeButtonActive : ''}`}
                  id="notebook-entry-mode"
                  type="button"
                  onClick={() => setEntryMode('notebook')}
                >
                  Из блокнота
                </button>
                <button
                  aria-controls="manual-entry-pane"
                  aria-pressed={entryMode === 'manual'}
                  className={`${styles.modeButton} ${entryMode === 'manual' ? styles.modeButtonActive : ''}`}
                  id="manual-entry-mode"
                  type="button"
                  onClick={() => setEntryMode('manual')}
                >
                  Вручную
                </button>
              </div>
            )}

            <section
              aria-labelledby={state.user.isBanned ? undefined : 'notebook-entry-mode'}
              aria-label={state.user.isBanned ? 'Из блокнота' : undefined}
              className={styles.modePane}
              hidden={!state.user.isBanned && entryMode !== 'notebook'}
              id="notebook-entry-pane"
            >
              <NotebookCatchEntry canSave={!state.user.isBanned} />
            </section>

            {!state.user.isBanned ? (
              <section
                aria-labelledby="manual-entry-mode"
                className={styles.modePane}
                hidden={entryMode !== 'manual'}
                id="manual-entry-pane"
              >
                <CatchReportForm />
              </section>
            ) : (
              <Link className={styles.archiveLink} href="/my/catches">
                Открыть мои уловы
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </ApplicationShell>
  );
}
